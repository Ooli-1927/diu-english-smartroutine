import { Router } from 'express';
import { findMany, findOne } from '../db.js';
import { entryOut, studentOut, teacherOut } from '../shape.js';
import { requireAuth } from '../auth.js';

export const bootstrapRouter = Router();

/** Single payload the web client needs to render every portal. */
bootstrapRouter.get('/bootstrap', requireAuth, async (req, res, next) => {
  try {
    const isAdmin = req.session.role === 'super_admin';
    let students = [];
    if (isAdmin) {
      students = (await findMany('students', {}, { sort: { student_id: 1 } })).map(studentOut);
    } else if (req.session.role === 'student') {
      const self = await findOne('students', { id: req.session.id });
      students = self ? [studentOut(self)] : [];
    }

    res.json({
      source: 'api',
      meta: (await findOne('app_metadata', {})) || null,
      teachers: (await findMany('teachers', {}, { sort: { name: 1 } })).map(teacherOut),
      batches: await findMany('batches', {}, { sort: { created_at: 1, name: 1 } }),
      courses: await findMany('courses', {}, { sort: { code: 1 } }),
      rooms: await findMany('rooms', {}, { sort: { name: 1 } }),
      students,
      timetable: (await findMany('timetable_entries', {})).map(entryOut),
    });
  } catch (err) {
    next(err);
  }
});
