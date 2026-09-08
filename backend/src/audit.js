import { randomUUID, createHash } from 'node:crypto';
import { bind, run } from './db.js';

export function recordAudit({
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
    run(
      `INSERT INTO audit_events
        (id, actor_role, actor_id, actor_name, action, entity_type, entity_id, summary, before_json, after_json, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        bind(session?.role || null),
        bind(session?.id || session?.teacherInitial || session?.studentId || null),
        bind(session?.name || session?.username || null),
        bind(action),
        bind(entityType || null),
        bind(entityId || null),
        bind(summary || action),
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        meta ? JSON.stringify(meta) : null,
      ],
    );
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
