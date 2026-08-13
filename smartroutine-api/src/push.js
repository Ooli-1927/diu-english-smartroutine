import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import { all, bind, get, run } from './db.js';

let configured = false;

/** Call once at server boot. Missing VAPID keys → push stays off (API still works). */
export function initWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:admin@localhost').trim();

  if (!publicKey || !privateKey || publicKey.includes('your-') || privateKey.includes('your-')) {
    console.warn('Web Push: VAPID keys unset — browser push disabled (inbox polling still works)');
    configured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export function isPushConfigured() {
  return configured;
}

export function getVapidPublicKey() {
  if (!configured) return null;
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

/** Map notification recipient → user ids that may have push subscriptions. */
function userIdsForRecipient(recipientType, recipientId) {
  if (!recipientId) return [];

  if (recipientType === 'student') {
    const batch = get('SELECT id FROM batches WHERE id = ?', [recipientId]);
    if (batch) {
      return all('SELECT id FROM students WHERE batch_id = ?', [recipientId]).map((r) => r.id);
    }
    const student = get('SELECT id FROM students WHERE id = ? OR student_id = ?', [
      recipientId,
      recipientId,
    ]);
    return student ? [student.id] : [];
  }

  if (recipientType === 'teacher') {
    const teacher = get('SELECT id FROM teachers WHERE initial = ? OR id = ?', [
      recipientId,
      recipientId,
    ]);
    return teacher ? [teacher.id] : [];
  }

  if (recipientType === 'super_admin') {
    const admin = get('SELECT id FROM admins WHERE id = ?', [recipientId]);
    if (admin) return [admin.id];
    return all('SELECT id FROM admins').map((r) => r.id);
  }

  return [];
}

function inboxPath(recipientType) {
  if (recipientType === 'teacher') return '/teacher/notifications';
  if (recipientType === 'super_admin') return '/admin/notices';
  return '/student/notifications';
}

/**
 * Upsert a browser PushSubscription for the authenticated user.
 * Endpoint is unique — re-login on another account moves the subscription.
 */
export function savePushSubscription(session, subscription) {
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    const err = new Error('Invalid push subscription');
    err.status = 400;
    throw err;
  }

  const existing = get('SELECT id FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
  if (existing) {
    run(
      `UPDATE push_subscriptions
       SET user_id = ?, user_role = ?, p256dh = ?, auth = ?
       WHERE endpoint = ?`,
      [bind(session.id), bind(session.role), bind(p256dh), bind(auth), endpoint],
    );
    return existing.id;
  }

  const id = randomUUID();
  run(
    `INSERT INTO push_subscriptions (id, user_id, user_role, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, bind(session.id), bind(session.role), endpoint, bind(p256dh), bind(auth)],
  );
  return id;
}

export function removePushSubscription(session, endpoint) {
  if (endpoint) {
    run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [
      String(endpoint),
      session.id,
    ]);
    return;
  }
  run('DELETE FROM push_subscriptions WHERE user_id = ?', [session.id]);
}

/** Fan-out Web Push for the same audience rules as in-app + email notices. */
export async function sendPushForNotification({ type, title, body, recipientType, recipientId }) {
  if (!configured) return;

  const userIds = userIdsForRecipient(recipientType, recipientId);
  if (!userIds.length) return;

  const placeholders = userIds.map(() => '?').join(',');
  const subs = all(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`,
    userIds,
  );
  if (!subs.length) return;

  const plainBody = String(body || '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 180);

  const payload = JSON.stringify({
    title: title || 'DIU SmartRoutine',
    body: plainBody || 'You have a new update',
    type: type || 'notice',
    url: inboxPath(recipientType),
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        );
      } catch (err) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          run('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
        } else {
          console.warn('Web Push send failed:', err?.message || err);
        }
      }
    }),
  );
}
