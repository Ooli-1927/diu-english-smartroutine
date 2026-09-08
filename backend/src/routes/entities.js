import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { all, bind, get, run } from '../db.js';
import { hashPassword, requireAuth, requireRole } from '../auth.js';
import { studentOut, teacherOut } from '../shape.js';
import { STUDENT_INITIAL_PASSWORD, teacherInitialPassword } from '../initialPasswords.js';

export const entitiesRouter = Router();

const adminOnly = requireRole('super_admin');

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

/* ------------------------------- batches ------------------------------- */

entitiesRouter.get('/batches', requireAuth, (_req, res) => {
  res.json(all('SELECT * FROM batches ORDER BY rowid'));
});

entitiesRouter.post('/batches', adminOnly, (req, res) => {
  const { name, session } = req.body || {};
  if (!name || !session) return badRequest(res, 'name and session are required');
  const id = req.body.id || randomUUID();
  run('INSERT INTO batches (id, name, session) VALUES (?, ?, ?)', [id, bind(name), bind(session)]);
  res.status(201).json(get('SELECT * FROM batches WHERE id = ?', [id]));
});

entitiesRouter.put('/batches/:id', adminOnly, (req, res) => {
  const existing = get('SELECT * FROM batches WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Batch not found' });
  const { name = existing.name, session = existing.session } = req.body || {};
  run('UPDATE batches SET name = ?, session = ? WHERE id = ?', [
    bind(name),
    bind(session),
    req.params.id,
  ]);
  res.json(get('SELECT * FROM batches WHERE id = ?', [req.params.id]));
});

entitiesRouter.delete('/batches/:id', adminOnly, (req, res) => {
  run('DELETE FROM batches WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* ------------------------------- courses ------------------------------- */

entitiesRouter.get('/courses', requireAuth, (_req, res) => {
  res.json(all('SELECT * FROM courses ORDER BY code'));
});

entitiesRouter.post('/courses', adminOnly, (req, res) => {
  const { code, title } = req.body || {};
  if (!code || !title) return badRequest(res, 'code and title are required');
  const id = req.body.id || randomUUID();
  run('INSERT INTO courses (id, code, title) VALUES (?, ?, ?)', [id, bind(code), bind(title)]);
  res.status(201).json(get('SELECT * FROM courses WHERE id = ?', [id]));
});

entitiesRouter.put('/courses/:id', adminOnly, (req, res) => {
  const existing = get('SELECT * FROM courses WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Course not found' });
  const { code = existing.code, title = existing.title } = req.body || {};
  run('UPDATE courses SET code = ?, title = ? WHERE id = ?', [
    bind(code),
    bind(title),
    req.params.id,
  ]);
  res.json(get('SELECT * FROM courses WHERE id = ?', [req.params.id]));
});

entitiesRouter.delete('/courses/:id', adminOnly, (req, res) => {
  run('DELETE FROM courses WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* -------------------------------- rooms -------------------------------- */

entitiesRouter.get('/rooms', requireAuth, (_req, res) => {
  res.json(all('SELECT * FROM rooms ORDER BY name'));
});

entitiesRouter.post('/rooms', adminOnly, (req, res) => {
  const { name } = req.body || {};
  if (!name) return badRequest(res, 'name is required');
  const id = req.body.id || name;
  run('INSERT INTO rooms (id, name) VALUES (?, ?)', [bind(id), bind(name)]);
  res.status(201).json(get('SELECT * FROM rooms WHERE id = ?', [id]));
});

entitiesRouter.put('/rooms/:id', adminOnly, (req, res) => {
  const existing = get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Room not found' });
  run('UPDATE rooms SET name = ? WHERE id = ?', [
    bind(req.body?.name || existing.name),
    req.params.id,
  ]);
  res.json(get('SELECT * FROM rooms WHERE id = ?', [req.params.id]));
});

entitiesRouter.delete('/rooms/:id', adminOnly, (req, res) => {
  run('DELETE FROM rooms WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* ------------------------------- teachers ------------------------------ */

entitiesRouter.get('/teachers', requireAuth, (_req, res) => {
  res.json(all('SELECT * FROM teachers ORDER BY name').map(teacherOut));
});

entitiesRouter.post('/teachers', adminOnly, (req, res) => {
  const { name, initial, designation, home_department } = req.body || {};
  if (!name || !initial || !designation) {
    return badRequest(res, 'name, initial and designation are required');
  }
  const id = req.body.id || randomUUID();
  const upper = String(initial).toUpperCase();
  const plain =
    req.body.password && String(req.body.password).trim()
      ? String(req.body.password).trim()
      : teacherInitialPassword(upper);
  run(
    `INSERT INTO teachers (id, name, initial, designation, phone, email, home_department, profile_pic, password_hash, has_changed_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      bind(name),
      upper,
      bind(designation),
      bind(req.body.phone),
      bind(req.body.email),
      bind(home_department || 'English'),
      bind(req.body.profile_pic),
      hashPassword(plain),
    ],
  );
  res.status(201).json(teacherOut(get('SELECT * FROM teachers WHERE id = ?', [id])));
});

entitiesRouter.put('/teachers/:id', requireAuth, (req, res) => {
  const existing = get('SELECT * FROM teachers WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Teacher not found' });

  const isAdmin = req.session.role === 'super_admin';
  const isSelf = req.session.teacherInitial === existing.initial;
  if (!isAdmin && !isSelf) {
    return res.status(403).json({ error: 'You can only edit your own profile' });
  }

  const body = req.body || {};
  run(
    `UPDATE teachers SET name = ?, designation = ?, phone = ?, email = ?, home_department = ?, profile_pic = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      bind(body.name ?? existing.name),
      bind(body.designation ?? existing.designation),
      bind(body.phone ?? existing.phone),
      bind(body.email ?? existing.email),
      bind(body.home_department ?? existing.home_department),
      bind(body.profile_pic ?? existing.profile_pic),
      req.params.id,
    ],
  );

  if (isAdmin && body.password) {
    run('UPDATE teachers SET password_hash = ?, has_changed_password = 0 WHERE id = ?', [
      hashPassword(body.password),
      req.params.id,
    ]);
  }

  res.json(teacherOut(get('SELECT * FROM teachers WHERE id = ?', [req.params.id])));
});

entitiesRouter.delete('/teachers/:id', adminOnly, (req, res) => {
  run('DELETE FROM teachers WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

/* ------------------------------- students ------------------------------ */

entitiesRouter.get('/students', adminOnly, (req, res) => {
  const { batch_id: batchId } = req.query;
  const rows = batchId
    ? all('SELECT * FROM students WHERE batch_id = ? ORDER BY student_id', [batchId])
    : all('SELECT * FROM students ORDER BY student_id');
  res.json(rows.map(studentOut));
});

entitiesRouter.post('/students', adminOnly, (req, res) => {
  const { student_id: studentId, name, batch_id: batchId } = req.body || {};
  if (!studentId || !name || !batchId) {
    return badRequest(res, 'student_id, name and batch_id are required');
  }
  if (!get('SELECT id FROM batches WHERE id = ?', [batchId])) {
    return badRequest(res, 'batch_id does not exist');
  }
  const plain =
    req.body.password && String(req.body.password).trim()
      ? String(req.body.password).trim()
      : STUDENT_INITIAL_PASSWORD;
  const id = req.body.id || randomUUID();
  run(
    `INSERT INTO students (id, student_id, name, batch_id, section, email, phone, profile_pic, password_hash, has_changed_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      bind(studentId),
      bind(name),
      bind(batchId),
      bind(req.body.section ? String(req.body.section).trim().toUpperCase() : null),
      bind(req.body.email),
      bind(req.body.phone),
      bind(req.body.profile_pic),
      hashPassword(plain),
    ],
  );
  res.status(201).json(studentOut(get('SELECT * FROM students WHERE id = ?', [id])));
});

entitiesRouter.put('/students/:id', requireAuth, (req, res) => {
  const existing = get('SELECT * FROM students WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  const isAdmin = req.session.role === 'super_admin';
  const isSelf = req.session.role === 'student' && req.session.id === existing.id;
  if (!isAdmin && !isSelf) {
    return res.status(403).json({ error: 'You can only edit your own profile' });
  }

  const body = req.body || {};
  if (isSelf && !isAdmin) {
    run(
      `UPDATE students SET profile_pic = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [
        bind(body.profile_pic !== undefined ? body.profile_pic : existing.profile_pic),
        bind(body.phone !== undefined ? body.phone : existing.phone),
        req.params.id,
      ],
    );
    return res.json(studentOut(get('SELECT * FROM students WHERE id = ?', [req.params.id])));
  }

  run(
    `UPDATE students SET student_id = ?, name = ?, batch_id = ?, section = ?, email = ?, phone = ?, profile_pic = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      bind(body.student_id ?? existing.student_id),
      bind(body.name ?? existing.name),
      bind(body.batch_id ?? existing.batch_id),
      bind(
        body.section !== undefined
          ? body.section
            ? String(body.section).trim().toUpperCase()
            : null
          : existing.section,
      ),
      bind(body.email ?? existing.email),
      bind(body.phone ?? existing.phone),
      bind(body.profile_pic !== undefined ? body.profile_pic : existing.profile_pic),
      req.params.id,
    ],
  );
  if (body.password) {
    run('UPDATE students SET password_hash = ?, has_changed_password = 0 WHERE id = ?', [
      hashPassword(body.password),
      req.params.id,
    ]);
  }
  res.json(studentOut(get('SELECT * FROM students WHERE id = ?', [req.params.id])));
});

entitiesRouter.delete('/students/:id', adminOnly, (req, res) => {
  run('DELETE FROM students WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});
