import { Router } from 'express';
import { all, get } from '../db.js';
import { entryOut, studentOut, teacherOut } from '../shape.js';
import { requireAuth } from '../auth.js';

export const bootstrapRouter = Router();

/** Single payload the web client needs to render every portal. */
bootstrapRouter.get('/bootstrap', requireAuth, (req, res) => {
  const isAdmin = req.session.role === 'super_admin';
  const students = isAdmin
    ? all('SELECT * FROM students ORDER BY student_id').map(studentOut)
    : req.session.role === 'student'
      ? [studentOut(get('SELECT * FROM students WHERE id = ?', [req.session.id]))].filter(Boolean)
      : [];

  res.json({
    source: 'api',
    meta: get('SELECT * FROM app_metadata LIMIT 1') || null,
    teachers: all('SELECT * FROM teachers ORDER BY name').map(teacherOut),
    batches: all('SELECT * FROM batches ORDER BY rowid'),
    courses: all('SELECT * FROM courses ORDER BY code'),
    rooms: all('SELECT * FROM rooms ORDER BY name'),
    students,
    timetable: all('SELECT * FROM timetable_entries').map(entryOut),
  });
});
