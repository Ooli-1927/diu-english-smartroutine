import { randomUUID } from 'node:crypto';
import webpush from 'web-push';
import {
  bind,
  caseInsensitive,
  deleteOne,
  deleteMany,
  findMany,
  findOne,
  insertOne,
  updateOne,
} from './db.js';

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
async function userIdsForRecipient(recipientType, recipientId) {
  if (!recipientId) return [];

  if (recipientType === 'student') {
    if (String(recipientId).includes(':')) {
      const [batchId, section] = String(recipientId).split(':');
      const students = await findMany('students', {
        batch_id: batchId,
        ...caseInsensitive('section', section),
      });
      return students.map((r) => r.id);
    }
    const batch = await findOne('batches', { id: recipientId });
    if (batch) {
      const students = await findMany('students', { batch_id: recipientId });
      return students.map((r) => r.id);
    }
    const student = await findOne('students', {
      $or: [{ id: recipientId }, { student_id: recipientId }],
    });
    return student ? [student.id] : [];
  }

  if (recipientType === 'teacher') {
    const teacher = await findOne('teachers', {
      $or: [{ initial: recipientId }, { id: recipientId }],
    });
    return teacher ? [teacher.id] : [];
  }

  if (recipientType === 'super_admin') {
    const admin = await findOne('admins', { id: recipientId });
    if (admin) return [admin.id];
    const admins = await findMany('admins', {});
    return admins.map((r) => r.id);
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
export async function savePushSubscription(session, subscription) {
  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    const err = new Error('Invalid push subscription');
    err.status = 400;
    throw err;
  }

  const existing = await findOne('push_subscriptions', { endpoint });
  if (existing) {
    await updateOne(
      'push_subscriptions',
      { endpoint },
      {
        $set: {
          user_id: bind(session.id),
          user_role: bind(session.role),
          p256dh: bind(p256dh),
          auth: bind(auth),
        },
      },
    );
    return existing.id;
  }

  const id = randomUUID();
  await insertOne('push_subscriptions', {
    id,
    user_id: bind(session.id),
    user_role: bind(session.role),
    endpoint,
    p256dh: bind(p256dh),
    auth: bind(auth),
  });
  return id;
}

export async function removePushSubscription(session, endpoint) {
  if (endpoint) {
    await deleteMany('push_subscriptions', {
      endpoint: String(endpoint),
      user_id: session.id,
    });
    return;
  }
  await deleteMany('push_subscriptions', { user_id: session.id });
}

/** Fan-out Web Push for the same audience rules as in-app + email notices. */
export async function sendPushForNotification({ type, title, body, recipientType, recipientId }) {
  if (!configured) return;

  const userIds = await userIdsForRecipient(recipientType, recipientId);
  if (!userIds.length) return;

  const subs = await findMany('push_subscriptions', { user_id: { $in: userIds } });
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
          await deleteOne('push_subscriptions', { id: sub.id });
        } else {
          console.warn('Web Push send failed:', err?.message || err);
        }
      }
    }),
  );
}
