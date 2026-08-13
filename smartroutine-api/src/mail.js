import { createTransport } from 'nodemailer';
import { resolveMx } from 'node:dns/promises';
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const OUTBOX_DIR = join(DATA_DIR, 'mail-outbox');
const OUTBOX_FILE = join(OUTBOX_DIR, 'sent.jsonl');
const SMTP_FILE = join(DATA_DIR, 'mail-smtp.json');

const BRAND = process.env.MAIL_FROM_NAME || 'DIU SmartRoutine';
const DEPT = 'Department of English';
const REPLY_TO_ENV = process.env.MAIL_REPLY_TO || '';
const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const PUBLIC_APP =
  process.env.PUBLIC_APP_URL ||
  (APP_URL.includes('localhost') || APP_URL.includes('127.0.0.1') ? '' : APP_URL);

const FAKE_DOMAINS = new Set(
  (process.env.MAIL_SKIP_DOMAINS || 'diu.demo,example.com,test.com,localhost,diu.local')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
);
const ALLOW_DEMO = process.env.MAIL_ALLOW_DEMO === '1';
const CONCURRENCY = Math.max(1, Number(process.env.MAIL_CONCURRENCY || 3));

let smtpTransport = null;
let transportMode = 'none';
let readyPromise = null;
let fileSmtp = loadSmtpFile();
const mxCache = new Map();

const queue = [];
let active = 0;
const recent = [];

function loadSmtpFile() {
  try {
    if (!existsSync(SMTP_FILE)) return null;
    const raw = JSON.parse(readFileSync(SMTP_FILE, 'utf8'));
    if (!raw?.user || !raw?.pass) return null;
    return {
      user: String(raw.user).trim(),
      // Gmail App Passwords are often pasted with spaces — strip them.
      pass: String(raw.pass).replace(/\s+/g, ''),
      from: String(raw.from || raw.user).trim(),
      fromName: String(raw.fromName || BRAND).trim(),
      service: String(raw.service || 'gmail').trim(),
      host: raw.host ? String(raw.host).trim() : '',
      port: raw.port ? Number(raw.port) : 587,
    };
  } catch {
    return null;
  }
}

function smtpIdentity() {
  return (fileSmtp?.user || process.env.SMTP_USER || '').trim().toLowerCase();
}

function fromAddr() {
  // Gmail/Google Workspace: From MUST match the authenticated mailbox.
  // A mismatched From (e.g. noreply@diu…) fails SPF/alignment → Spam.
  const auth = smtpIdentity();
  if (auth) return auth;
  return (
    process.env.MAIL_FROM ||
    fileSmtp?.from ||
    'noreply@english.diu.edu.bd'
  );
}

function fromName() {
  return process.env.MAIL_FROM_NAME || fileSmtp?.fromName || BRAND;
}

function replyTo() {
  return REPLY_TO_ENV || fromAddr();
}

function mailDomain() {
  return (fromAddr().split('@')[1] || 'english.diu.edu.bd').toLowerCase();
}

function pushRecent(entry) {
  recent.unshift(entry);
  if (recent.length > 50) recent.length = 50;
}

function logOutbox(entry) {
  try {
    if (!existsSync(OUTBOX_DIR)) mkdirSync(OUTBOX_DIR, { recursive: true });
    appendFileSync(OUTBOX_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn('[mail] outbox write failed:', err.message);
  }
}

function hasSmtp() {
  return Boolean(
    process.env.SMTP_HOST ||
      process.env.SMTP_URL ||
      (process.env.SMTP_USER && process.env.SMTP_PASS) ||
      process.env.RESEND_API_KEY ||
      process.env.BREVO_API_KEY ||
      fileSmtp,
  );
}

export function isMailConfigured() {
  return true;
}

export function mailStatus() {
  return {
    configured: true,
    professional: hasSmtp(),
    mode: transportMode || (hasSmtp() ? 'smtp' : 'auto'),
    from: `${fromName()} <${fromAddr()}>`,
    smtpSaved: Boolean(fileSmtp),
    smtpUser: fileSmtp?.user || process.env.SMTP_USER || null,
    queue: queue.length,
    active,
    recent: recent.slice(0, 20),
    tip: hasSmtp()
      ? 'SMTP active. Recipients: open Spam mail → “Report not spam”, then Gmail → Create filter for this From → Never send it to Spam. Code cannot force Inbox on every provider.'
      : 'Add a Gmail App Password on Chairman → Profile (required for Inbox delivery). Without SMTP, fallback relays often land in Spam.',
  };
}

export function saveSmtpConfig({ user, pass, from, fromName: name, service, host, port }) {
  const mailbox = String(user || '').trim();
  const next = {
    user: mailbox,
    pass: String(pass || '').replace(/\s+/g, ''),
    // Always send as the authenticated user (aliases need Google Workspace setup).
    from: mailbox || String(from || '').trim(),
    fromName: String(name || BRAND).trim(),
    service: String(service || 'gmail').trim(),
    host: host ? String(host).trim() : 'smtp.gmail.com',
    port: port ? Number(port) : 587,
  };
  if (!next.user || !next.pass) {
    throw new Error('Gmail address and App Password are required');
  }
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SMTP_FILE, JSON.stringify(next, null, 2), 'utf8');
  fileSmtp = next;
  resetTransport();
  return mailStatus();
}

export function clearSmtpConfig() {
  try {
    if (existsSync(SMTP_FILE)) unlinkSync(SMTP_FILE);
  } catch {
    /* ignore */
  }
  fileSmtp = null;
  resetTransport();
  return mailStatus();
}

function resetTransport() {
  if (smtpTransport) {
    try {
      smtpTransport.close();
    } catch {
      /* ignore */
    }
  }
  smtpTransport = null;
  readyPromise = null;
  transportMode = 'none';
}

async function ensureSmtp() {
  if (smtpTransport) return smtpTransport;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (process.env.RESEND_API_KEY || process.env.BREVO_API_KEY) {
      transportMode = process.env.RESEND_API_KEY ? 'resend' : 'brevo';
      return null;
    }
    if (process.env.SMTP_URL) {
      smtpTransport = createTransport(process.env.SMTP_URL);
      transportMode = 'smtp-url';
    } else if (process.env.SMTP_HOST) {
      smtpTransport = createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === '1' || Number(process.env.SMTP_PORT) === 465,
        auth:
          process.env.SMTP_USER && process.env.SMTP_PASS
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        pool: true,
        maxConnections: CONCURRENCY,
      });
      transportMode = 'smtp';
    } else if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      smtpTransport = createTransport({
        service: process.env.SMTP_SERVICE || 'gmail',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        pool: true,
        maxConnections: CONCURRENCY,
      });
      transportMode = process.env.SMTP_SERVICE || 'gmail';
    } else if (fileSmtp) {
      if (fileSmtp.host) {
        smtpTransport = createTransport({
          host: fileSmtp.host,
          port: fileSmtp.port || 587,
          secure: fileSmtp.port === 465,
          auth: { user: fileSmtp.user, pass: fileSmtp.pass },
          pool: true,
          maxConnections: CONCURRENCY,
        });
        transportMode = 'smtp-file';
      } else {
        smtpTransport = createTransport({
          service: fileSmtp.service || 'gmail',
          auth: { user: fileSmtp.user, pass: fileSmtp.pass },
          pool: true,
          maxConnections: CONCURRENCY,
        });
        transportMode = fileSmtp.service || 'gmail';
      }
    } else {
      transportMode = 'auto';
      console.log('[mail] No SMTP yet — trying MX, then clean relay');
    }

    if (smtpTransport) {
      try {
        await smtpTransport.verify();
        console.log(`[mail] Professional SMTP ready (${transportMode}) as ${fromAddr()}`);
      } catch (err) {
        console.warn('[mail] SMTP verify warning:', err.message);
      }
    }
    return smtpTransport;
  })();

  return readyPromise;
}

export function isDeliverableAddress(email) {
  if (!email || typeof email !== 'string') return false;
  const addr = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return false;
  const domain = addr.split('@')[1];
  if (!ALLOW_DEMO && FAKE_DOMAINS.has(domain)) return false;
  return true;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detailsRowsHtml(details) {
  if (!Array.isArray(details) || !details.length) return '';
  const rows = details
    .filter((d) => d && d.label)
    .map(
      (d) => `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e2eeea;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#5f7a74;width:34%;vertical-align:top;">${escapeHtml(d.label)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2eeea;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#12201c;font-weight:600;vertical-align:top;">${escapeHtml(d.value)}</td>
        </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;border:1px solid #d7e4df;border-radius:8px;overflow:hidden;background:#f8fbfa;">
      <tr><td colspan="2" style="padding:12px 14px;background:#eef6f5;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#0a2540;font-weight:700;">Class details</td></tr>
      ${rows}
    </table>`;
}

function buildBodies({ title, body, ctaLabel, ctaPath, details }) {
  const brand = fromName();
  const hasPublicLink = Boolean(PUBLIC_APP);
  const link = hasPublicLink
    ? `${PUBLIC_APP}${ctaPath?.startsWith('/') ? ctaPath : `/${ctaPath || ''}`}`
    : '';
  const detailLines =
    Array.isArray(details) && details.length
      ? ['', 'Class details:', ...details.map((d) => `${d.label}: ${d.value}`)]
      : [];

  const textLines = [
    brand,
    DEPT,
    'Daffodil International University',
    '',
    title,
    '',
    body,
    ...detailLines,
    '',
  ];
  if (hasPublicLink) {
    textLines.push(`${ctaLabel || 'Open SmartRoutine'}: ${link}`, '');
  } else {
    textLines.push('Open the SmartRoutine web app on your device to see full details.', '');
  }
  textLines.push(
    '—',
    'You received this because you are enrolled in DIU SmartRoutine.',
    'Daffodil International University · Department of English',
    'If this was unexpected, ignore this message or contact your department office.',
  );
  const text = textLines.join('\n');

  const ctaHtml = hasPublicLink
    ? `<a href="${escapeHtml(link)}" style="display:inline-block;background:#0b3d91;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600;">${escapeHtml(ctaLabel || 'Open SmartRoutine')}</a>`
    : `<p style="margin:0;padding:12px 14px;background:#eef6f5;border-radius:8px;color:#334641;font-size:14px;">Open <strong>SmartRoutine</strong> on your computer or phone to view details.</p>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#e8f0ee;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#12201c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e8f0ee;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #c9dbd6;">
        <tr>
          <td style="background:#0a2540;padding:22px 28px;">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9db7e8;margin-bottom:6px;">${escapeHtml(DEPT)}</div>
            <div style="font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;">${escapeHtml(brand)}</div>
            <div style="margin-top:6px;font-size:12px;color:#c5e4e5;">Daffodil International University</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5f7a74;">Routine update</p>
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0b3d3a;font-weight:700;">${escapeHtml(title)}</h1>
            <div style="height:2px;width:48px;background:#0b3d91;margin-bottom:18px;"></div>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#334641;white-space:pre-wrap;">${escapeHtml(body)}</p>
            ${detailsRowsHtml(details)}
            ${ctaHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;background:#f4f8f7;border-top:1px solid #d7e4df;font-size:12px;line-height:1.55;color:#6a7c77;">
            ${escapeHtml(DEPT)} · Daffodil International University<br/>
            Class routine notice for enrolled students and teachers · ${escapeHtml(DEPT)}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { text, html, link };
}

async function mxHostFor(email) {
  const domain = email.split('@')[1].toLowerCase();
  if (mxCache.has(domain)) return mxCache.get(domain);
  const records = await resolveMx(domain);
  records.sort((a, b) => a.priority - b.priority);
  const host = records[0]?.exchange;
  if (!host) throw new Error(`No MX for ${domain}`);
  mxCache.set(domain, host);
  return host;
}

/** Transactional SMTP: avoid List-* headers (Gmail often treats them as bulk → Spam/Promotions). */
function mailHeadersSmtp(id) {
  return {
    'X-Entity-Ref-ID': id,
    'Auto-Submitted': 'auto-generated',
  };
}

/** Unauthenticated MX path only — keep unsubscribe hints for relay reputation. */
function mailHeadersMx(id, domain) {
  const unsubMailto = `mailto:${fromAddr()}?subject=${encodeURIComponent('Unsubscribe routine notices')}`;
  return {
    'X-Entity-Ref-ID': id,
    'List-Id': `"DIU SmartRoutine" <routine.${domain}>`,
    'List-Unsubscribe': `<${unsubMailto}>`,
  };
}

async function deliverViaMx(job, subject, text, html, id) {
  const host = await mxHostFor(job.to);
  const domain = mailDomain();
  const transport = createTransport({
    host,
    port: Number(process.env.MAIL_MX_PORT || 25),
    secure: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 20000,
    name: domain,
  });

  try {
    const sent = await transport.sendMail({
      from: `"${fromName()}" <${fromAddr()}>`,
      to: job.to,
      replyTo: replyTo(),
      subject,
      text,
      html,
      messageId: `<${id}@${domain}>`,
      headers: mailHeadersMx(id, domain),
    });
    return { messageId: sent.messageId || id, mode: 'mx', providerMessage: `mx:${host}` };
  } finally {
    transport.close();
  }
}

async function deliverViaResend(job, subject, text, html, id) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName()} <${fromAddr()}>`,
      to: [job.to],
      subject,
      html,
      text,
      headers: { 'X-Entity-Ref-ID': id },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Resend failed (${res.status})`);
  return { messageId: data.id || id, mode: 'resend', providerMessage: 'resend' };
}

async function deliverViaBrevo(job, subject, text, html, id) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: fromName(), email: fromAddr() },
      to: [{ email: job.to }],
      subject,
      htmlContent: html,
      textContent: text,
      headers: { 'X-Entity-Ref-ID': id },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `Brevo failed (${res.status})`);
  return { messageId: data.messageId || id, mode: 'brevo', providerMessage: 'brevo' };
}

/**
 * Last-resort relay: readable plain notice only (no HTML dump / multi-field table).
 * Sender still shows FormSubmit — only used when SMTP is not configured.
 */
async function deliverViaCleanHttp(job, subject, text, id) {
  const endpoint = `https://formsubmit.co/ajax/${encodeURIComponent(job.to)}`;
  const publicOrigin = process.env.MAIL_PUBLIC_ORIGIN || 'https://english.diu.edu.bd';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: publicOrigin,
      Referer: `${publicOrigin}/routine`,
    },
    body: JSON.stringify({
      _subject: subject,
      _template: 'basic',
      _captcha: 'false',
      _honey: '',
      _replyto: replyTo(),
      Message: text,
    }),
  });
  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = { message: raw };
  }
  const ok =
    res.ok &&
    (data?.success === true ||
      data?.success === 'true' ||
      /success|confirm|activat/i.test(String(data?.message || '')));
  if (!ok) throw new Error(data?.message || `HTTP mail failed (${res.status})`);
  return {
    messageId: `<${id}@${mailDomain()}>`,
    mode: 'http-clean',
    needsConfirm: /activat|confirm/i.test(String(data?.message || '')),
    providerMessage: data?.message || 'sent',
  };
}

function normalizeSubject(raw) {
  const s = String(raw || 'Routine update').replace(/^\s*\[ENG\]\s*/i, '').trim();
  // Clean readable subject — avoid spammy ALL-CAPS / bracket prefixes
  return s.length > 140 ? `${s.slice(0, 137)}...` : s;
}

async function deliver(job) {
  await ensureSmtp();
  const id = randomUUID();
  const { text, html } = buildBodies(job);
  const subject = normalizeSubject(job.subject);
  const smtpReady = Boolean(smtpTransport || process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);

  const errors = [];
  let info = null;

  try {
    if (process.env.RESEND_API_KEY) {
      info = await deliverViaResend(job, subject, text, html, id);
    } else if (process.env.BREVO_API_KEY) {
      info = await deliverViaBrevo(job, subject, text, html, id);
    } else if (smtpTransport) {
      const addr = fromAddr();
      const sent = await smtpTransport.sendMail({
        from: `"${fromName()}" <${addr}>`,
        sender: addr,
        envelope: { from: addr, to: [job.to] },
        to: job.to,
        replyTo: replyTo(),
        subject,
        text,
        html,
        // Let nodemailer/Gmail set Message-ID (aligned with DKIM) — custom IDs hurt Inbox.
        headers: mailHeadersSmtp(id),
        date: new Date(),
      });
      info = { messageId: sent.messageId || id, mode: transportMode, providerMessage: 'smtp' };
    }
  } catch (err) {
    errors.push(err.message);
  }

  // When real SMTP is configured, never fall back to raw MX / FormSubmit —
  // those paths almost always land in Spam and hurt trust.
  if (!info && !smtpReady && process.env.MAIL_MX_DISABLED !== '1') {
    try {
      info = await deliverViaMx(job, subject, text, html, id);
    } catch (err) {
      errors.push(`mx: ${err.message}`);
    }
  }

  if (!info && !smtpReady && process.env.MAIL_HTTP_DISABLED !== '1') {
    try {
      info = await deliverViaCleanHttp(job, subject, text, id);
    } catch (err) {
      errors.push(`http: ${err.message}`);
    }
  }

  if (!info) {
    throw new Error(
      errors.join(' | ') ||
        (smtpReady
          ? 'SMTP send failed — check Gmail App Password / From address on Chairman â†’ Profile'
          : 'All mail transports failed'),
    );
  }

  transportMode = info.mode || transportMode;
  const entry = {
    at: new Date().toISOString(),
    id,
    to: job.to,
    subject,
    mode: info.mode,
    messageId: info.messageId,
    ok: true,
    needsConfirm: Boolean(info.needsConfirm),
    note: info.needsConfirm
      ? 'First-time address — click Confirm once in inbox/spam'
      : info.providerMessage,
  };
  pushRecent(entry);
  logOutbox(entry);
  console.log(`[mail:${info.mode}] â†’ ${job.to} | ${subject}`);
  return entry;
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const job = queue.shift();
    active += 1;
    deliver(job)
      .catch((err) => {
        const entry = {
          at: new Date().toISOString(),
          to: job.to,
          subject: job.subject,
          ok: false,
          error: err.message,
          mode: transportMode,
        };
        pushRecent(entry);
        logOutbox(entry);
        console.warn(`[mail] failed â†’ ${job.to}:`, err.message);
      })
      .finally(() => {
        active -= 1;
        setTimeout(pump, 250);
      });
  }
}

export function queueMail({ to, subject, title, body, ctaLabel, ctaPath, category, details }) {
  if (!isDeliverableAddress(to)) {
    pushRecent({
      at: new Date().toISOString(),
      to,
      subject,
      ok: false,
      skipped: true,
      reason: 'undeliverable-or-demo-address',
    });
    return { queued: false, reason: 'skipped' };
  }

  queue.push({
    to: to.trim(),
    subject: String(subject || title || 'Update'),
    title: String(title || subject || 'Update'),
    body: String(body || ''),
    details: Array.isArray(details) ? details : undefined,
    ctaLabel,
    ctaPath,
    category,
  });
  setImmediate(pump);
  return { queued: true };
}

export function queueMails(jobs) {
  let n = 0;
  for (const job of jobs) {
    if (queueMail(job).queued) n += 1;
  }
  return n;
}

export async function sendTestMail(to) {
  await ensureSmtp();
  return deliver({
    to,
    subject: 'Routine notice test · DIU SmartRoutine',
    title: 'SmartRoutine is connected',
    body: 'This is a professional test notice from DIU SmartRoutine.\n\nClass cancellations, reschedules, room changes, and appointment updates will arrive in this format with full course, teacher, and room details.',
    details: [
      { label: 'Course code', value: 'ENG 101' },
      { label: 'Course name', value: 'SmartRoutine orientation (sample)' },
      { label: 'Teacher', value: 'Sample Teacher · Lecturer (ST)' },
      { label: 'Day', value: 'Sun' },
      { label: 'Time', value: '10:15 – 11:10' },
      { label: 'Classroom', value: 'R-101' },
    ],
    ctaLabel: 'Open SmartRoutine',
    ctaPath: '/',
    category: 'test',
  });
}

void ensureSmtp().catch(() => {});
