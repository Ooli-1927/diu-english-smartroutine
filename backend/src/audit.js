import { randomUUID, createHash } from 'node:crypto';
import { bind, insertOne, nowIso } from './db.js';

export async function recordAudit({
  session,
  action,
  entityType,
  entityId,
  summary,
  before,
  after,
  meta,
}) {
  try {
    const id = randomUUID();
    await insertOne('audit_events', {
      id,
      actor_role: bind(session?.role || null),
      actor_id: bind(session?.id || session?.teacherInitial || session?.studentId || null),
      actor_name: bind(session?.name || session?.username || null),
      action: bind(action),
      entity_type: bind(entityType || null),
      entity_id: bind(entityId || null),
      summary: bind(summary || action),
      before_json: before ? JSON.stringify(before) : null,
      after_json: after ? JSON.stringify(after) : null,
      meta_json: meta ? JSON.stringify(meta) : null,
      created_at: nowIso(),
    });
  } catch (err) {
    console.warn('[audit]', err.message);
  }
}

export function fingerprintConflict(c) {
  return createHash('sha1')
    .update(`${c.kind}|${c.resource}|${c.day || ''}|${c.start_time || ''}|${c.message || ''}`)
    .digest('hex')
    .slice(0, 16);
}
