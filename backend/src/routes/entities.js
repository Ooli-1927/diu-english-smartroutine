import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  bind,
  deleteMany,
  deleteOne,
  findMany,
  findOne,
  insertOne,
  nowIso,
  updateMany,
  updateOne,
} from '../db.js';
import { hashPassword, requireAuth, requireRole } from '../auth.js';
import { studentOut, teacherOut } from '../shape.js';
import { STUDENT_INITIAL_PASSWORD, teacherInitialPassword } from '../initialPasswords.js';

export const entitiesRouter = Router();

const adminOnly = requireRole('super_admin');

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

/* ------------------------------- batches ------------------------------- */

entitiesRouter.get('/batches', requireAuth, async (_req, res, next) => {
  try {
    res.json(await findMany('batches', {}, { sort: { created_at: 1, name: 1 } }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.post('/batches', adminOnly, async (req, res, next) => {
  try {
    const { name, session } = req.body || {};
    if (!name || !session) return badRequest(res, 'name and session are required');
    const id = req.body.id || randomUUID();
    await insertOne('batches', {
      id,
      name: bind(name),
      session: bind(session),
      created_at: nowIso(),
    });
    res.status(201).json(await findOne('batches', { id }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.put('/batches/:id', adminOnly, async (req, res, next) => {
  try {
    const existing = await findOne('batches', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Batch not found' });
    const { name = existing.name, session = existing.session } = req.body || {};
    await updateOne(
      'batches',
      { id: req.params.id },
      { $set: { name: bind(name), session: bind(session) } },
    );
    res.json(await findOne('batches', { id: req.params.id }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.delete('/batches/:id', adminOnly, async (req, res, next) => {
  try {
    const batchId = req.params.id;
    await deleteMany('students', { batch_id: batchId });
    await deleteMany('timetable_entries', { batch_id: batchId });
    await deleteOne('batches', { id: batchId });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------- courses ------------------------------- */

entitiesRouter.get('/courses', requireAuth, async (_req, res, next) => {
  try {
    res.json(await findMany('courses', {}, { sort: { code: 1 } }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.post('/courses', adminOnly, async (req, res, next) => {
  try {
    const { code, title } = req.body || {};
    if (!code || !title) return badRequest(res, 'code and title are required');
    const id = req.body.id || randomUUID();
    await insertOne('courses', {
      id,
      code: bind(code),
      title: bind(title),
    });
    res.status(201).json(await findOne('courses', { id }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.put('/courses/:id', adminOnly, async (req, res, next) => {
  try {
    const existing = await findOne('courses', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Course not found' });
    const { code = existing.code, title = existing.title } = req.body || {};
    await updateOne(
      'courses',
      { id: req.params.id },
      { $set: { code: bind(code), title: bind(title) } },
    );
    res.json(await findOne('courses', { id: req.params.id }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.delete('/courses/:id', adminOnly, async (req, res, next) => {
  try {
    const existing = await findOne('courses', { id: req.params.id });
    if (existing?.code) {
      await deleteMany('timetable_entries', { course_code: existing.code });
    }
    await deleteOne('courses', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* -------------------------------- rooms -------------------------------- */

entitiesRouter.get('/rooms', requireAuth, async (_req, res, next) => {
  try {
    res.json(await findMany('rooms', {}, { sort: { name: 1 } }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.post('/rooms', adminOnly, async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) return badRequest(res, 'name is required');
    const id = req.body.id || name;
    await insertOne('rooms', { id: bind(id), name: bind(name) });
    res.status(201).json(await findOne('rooms', { id }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.put('/rooms/:id', adminOnly, async (req, res, next) => {
  try {
    const existing = await findOne('rooms', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Room not found' });
    await updateOne(
      'rooms',
      { id: req.params.id },
      { $set: { name: bind(req.body?.name || existing.name) } },
    );
    res.json(await findOne('rooms', { id: req.params.id }));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.delete('/rooms/:id', adminOnly, async (req, res, next) => {
  try {
    const roomId = req.params.id;
    await updateMany(
      'timetable_entries',
      { room_id: roomId },
      { $set: { room_id: null, updated_at: nowIso() } },
    );
    await deleteMany('room_presence', { room_id: roomId });
    await deleteOne('rooms', { id: roomId });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------- teachers ------------------------------ */

entitiesRouter.get('/teachers', requireAuth, async (_req, res, next) => {
  try {
    const rows = await findMany('teachers', {}, { sort: { name: 1 } });
    res.json(rows.map(teacherOut));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.post('/teachers', adminOnly, async (req, res, next) => {
  try {
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
    await insertOne('teachers', {
      id,
      name: bind(name),
      initial: upper,
      designation: bind(designation),
      phone: bind(req.body.phone),
      email: bind(req.body.email),
      home_department: bind(home_department || 'English'),
      profile_pic: bind(req.body.profile_pic),
      password_hash: hashPassword(plain),
      has_changed_password: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    res.status(201).json(teacherOut(await findOne('teachers', { id })));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.put('/teachers/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await findOne('teachers', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Teacher not found' });

    const isAdmin = req.session.role === 'super_admin';
    const isSelf = req.session.teacherInitial === existing.initial;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: 'You can only edit your own profile' });
    }

    const body = req.body || {};
    const $set = {
      name: bind(body.name ?? existing.name),
      designation: bind(body.designation ?? existing.designation),
      phone: bind(body.phone ?? existing.phone),
      email: bind(body.email ?? existing.email),
      home_department: bind(body.home_department ?? existing.home_department),
      profile_pic: bind(body.profile_pic ?? existing.profile_pic),
      updated_at: nowIso(),
    };

    if (isAdmin && body.password) {
      $set.password_hash = hashPassword(body.password);
      $set.has_changed_password = false;
    }

    await updateOne('teachers', { id: req.params.id }, { $set });
    res.json(teacherOut(await findOne('teachers', { id: req.params.id })));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.delete('/teachers/:id', adminOnly, async (req, res, next) => {
  try {
    const existing = await findOne('teachers', { id: req.params.id });
    if (existing?.initial) {
      await deleteMany('timetable_entries', { teacher_initial: existing.initial });
      await deleteMany('appointment_slots', { teacher_initial: existing.initial });
      await deleteMany('appointments', { teacher_initial: existing.initial });
    }
    await deleteOne('teachers', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/* ------------------------------- students ------------------------------ */

entitiesRouter.get('/students', adminOnly, async (req, res, next) => {
  try {
    const { batch_id: batchId } = req.query;
    const rows = batchId
      ? await findMany('students', { batch_id: batchId }, { sort: { student_id: 1 } })
      : await findMany('students', {}, { sort: { student_id: 1 } });
    res.json(rows.map(studentOut));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.post('/students', adminOnly, async (req, res, next) => {
  try {
    const { student_id: studentId, name, batch_id: batchId } = req.body || {};
    if (!studentId || !name || !batchId) {
      return badRequest(res, 'student_id, name and batch_id are required');
    }
    if (!(await findOne('batches', { id: batchId }))) {
      return badRequest(res, 'batch_id does not exist');
    }
    const plain =
      req.body.password && String(req.body.password).trim()
        ? String(req.body.password).trim()
        : STUDENT_INITIAL_PASSWORD;
    const id = req.body.id || randomUUID();
    await insertOne('students', {
      id,
      student_id: bind(studentId),
      name: bind(name),
      batch_id: bind(batchId),
      section: bind(req.body.section ? String(req.body.section).trim().toUpperCase() : null),
      email: bind(req.body.email),
      phone: bind(req.body.phone),
      profile_pic: bind(req.body.profile_pic),
      password_hash: hashPassword(plain),
      has_changed_password: false,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    res.status(201).json(studentOut(await findOne('students', { id })));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.put('/students/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await findOne('students', { id: req.params.id });
    if (!existing) return res.status(404).json({ error: 'Student not found' });

    const isAdmin = req.session.role === 'super_admin';
    const isSelf = req.session.role === 'student' && req.session.id === existing.id;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ error: 'You can only edit your own profile' });
    }

    const body = req.body || {};
    if (isSelf && !isAdmin) {
      await updateOne(
        'students',
        { id: req.params.id },
        {
          $set: {
            profile_pic: bind(
              body.profile_pic !== undefined ? body.profile_pic : existing.profile_pic,
            ),
            phone: bind(body.phone !== undefined ? body.phone : existing.phone),
            updated_at: nowIso(),
          },
        },
      );
      return res.json(studentOut(await findOne('students', { id: req.params.id })));
    }

    const $set = {
      student_id: bind(body.student_id ?? existing.student_id),
      name: bind(body.name ?? existing.name),
      batch_id: bind(body.batch_id ?? existing.batch_id),
      section: bind(
        body.section !== undefined
          ? body.section
            ? String(body.section).trim().toUpperCase()
            : null
          : existing.section,
      ),
      email: bind(body.email ?? existing.email),
      phone: bind(body.phone ?? existing.phone),
      profile_pic: bind(
        body.profile_pic !== undefined ? body.profile_pic : existing.profile_pic,
      ),
      updated_at: nowIso(),
    };
    if (body.password) {
      $set.password_hash = hashPassword(body.password);
      $set.has_changed_password = false;
    }
    await updateOne('students', { id: req.params.id }, { $set });
    res.json(studentOut(await findOne('students', { id: req.params.id })));
  } catch (e) {
    next(e);
  }
});

entitiesRouter.delete('/students/:id', adminOnly, async (req, res, next) => {
  try {
    await deleteOne('students', { id: req.params.id });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
