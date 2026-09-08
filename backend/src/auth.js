import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { get, run } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'smartroutine-dev-secret-change-me';
const TOKEN_TTL = process.env.JWT_TTL || '12h';
const HASH_ROUNDS = 10;

export function signToken(session) {
  return jwt.sign(session, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    delete payload.iat;
    delete payload.exp;
    return payload;
  } catch {
    return null;
  }
}

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  req.session = token ? verifyToken(token) : null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: 'You do not have access to this action' });
    }
    next();
  };
}

/** Login order mirrors the Flutter app: admin -> teacher -> student. */
export function authenticateCredentials(usernameOrEmail, password) {
  const login = String(usernameOrEmail || '').trim();
  if (!login || !password) return null;

  const admin = get('SELECT * FROM admins WHERE lower(username) = lower(?)', [login]);
  if (admin && bcrypt.compareSync(password, admin.password_hash)) {
    if (admin.type === 'super_admin') {
      return { role: 'super_admin', id: admin.id, name: 'Super Admin', username: admin.username };
    }
    const teacher = get('SELECT * FROM teachers WHERE initial = ?', [admin.teacher_initial]);
    return {
      role: 'teacher_admin',
      id: teacher?.id || admin.id,
      name: teacher?.name || admin.username,
      username: admin.username,
      email: teacher?.email || null,
      teacherInitial: admin.teacher_initial,
    };
  }

  const teacher = get(
    'SELECT * FROM teachers WHERE lower(email) = lower(?) OR lower(initial) = lower(?)',
    [login, login],
  );
  if (teacher?.password_hash && bcrypt.compareSync(password, teacher.password_hash)) {
    return {
      role: 'teacher',
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      teacherInitial: teacher.initial,
    };
  }

  const student = get(
    'SELECT * FROM students WHERE lower(email) = lower(?) OR lower(student_id) = lower(?)',
    [login, login],
  );
  if (student?.password_hash && bcrypt.compareSync(password, student.password_hash)) {
    return {
      role: 'student',
      id: student.id,
      name: student.name,
      email: student.email,
      studentId: student.student_id,
      batchId: student.batch_id,
      section: student.section || null,
    };
  }

  return null;
}

/** Attach profile photos for the client without putting large blobs into the JWT. */
export function enrichSession(session) {
  if (!session) return null;
  const out = { ...session };
  if (session.role === 'student') {
    const row = get('SELECT profile_pic FROM students WHERE id = ?', [session.id]);
    out.profilePic = row?.profile_pic || null;
  } else if (session.role === 'teacher' || session.role === 'teacher_admin') {
    const row = session.teacherInitial
      ? get('SELECT profile_pic FROM teachers WHERE initial = ?', [session.teacherInitial])
      : get('SELECT profile_pic FROM teachers WHERE id = ?', [session.id]);
    out.profilePic = row?.profile_pic || null;
  } else if (session.role === 'super_admin') {
    const row = get('SELECT profile_pic FROM admins WHERE id = ?', [session.id]);
    out.profilePic = row?.profile_pic || null;
  }
  return out;
}

export function updateOwnProfilePic(session, profilePic) {
  if (profilePic != null && typeof profilePic === 'string' && profilePic.length > 900_000) {
    throw Object.assign(new Error('Image is too large — try a smaller photo'), { status: 400 });
  }
  if (session.role === 'student') {
    run('UPDATE students SET profile_pic = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      profilePic,
      session.id,
    ]);
    return;
  }
  if (session.role === 'teacher' || session.role === 'teacher_admin') {
    if (session.teacherInitial) {
      run(
        'UPDATE teachers SET profile_pic = ?, updated_at = CURRENT_TIMESTAMP WHERE initial = ?',
        [profilePic, session.teacherInitial],
      );
    } else {
      run('UPDATE teachers SET profile_pic = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        profilePic,
        session.id,
      ]);
    }
    return;
  }
  if (session.role === 'super_admin') {
    run('UPDATE admins SET profile_pic = ? WHERE id = ?', [profilePic, session.id]);
    return;
  }
  throw Object.assign(new Error('Unsupported role'), { status: 400 });
}

export function changeOwnPassword(session, currentPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    throw Object.assign(new Error('New password must be at least 6 characters'), { status: 400 });
  }

  const table =
    session.role === 'student'
      ? 'students'
      : session.role === 'super_admin'
        ? 'admins'
        : 'teachers';
  const row = get(`SELECT * FROM ${table} WHERE id = ?`, [session.id]);
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });

  // Students and teachers may change the department-issued password only once.
  if (table !== 'admins' && row.has_changed_password) {
    throw Object.assign(
      new Error('Password already changed once. Ask the Chairman to reset it.'),
      { status: 403 },
    );
  }

  if (!row.password_hash || !bcrypt.compareSync(currentPassword || '', row.password_hash)) {
    throw Object.assign(new Error('Current password is incorrect'), { status: 400 });
  }

  const hashed = bcrypt.hashSync(newPassword, HASH_ROUNDS);
  if (table === 'admins') {
    run('UPDATE admins SET password_hash = ? WHERE id = ?', [hashed, session.id]);
  } else {
    run(
      `UPDATE ${table} SET password_hash = ?, has_changed_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [hashed, session.id],
    );
  }
  return true;
}

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, HASH_ROUNDS);
}
