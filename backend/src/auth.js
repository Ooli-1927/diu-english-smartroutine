import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { caseInsensitive, findOne, nowIso, updateOne } from './db.js';

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
export async function authenticateCredentials(usernameOrEmail, password) {
  const login = String(usernameOrEmail || '').trim();
  if (!login || !password) return null;

  const admin = await findOne('admins', caseInsensitive('username', login));
  if (admin && bcrypt.compareSync(password, admin.password_hash)) {
    if (admin.type === 'super_admin') {
      return { role: 'super_admin', id: admin.id, name: 'Super Admin', username: admin.username };
    }
    const teacher = await findOne('teachers', { initial: admin.teacher_initial });
    return {
      role: 'teacher_admin',
      id: teacher?.id || admin.id,
      name: teacher?.name || admin.username,
      username: admin.username,
      email: teacher?.email || null,
      teacherInitial: admin.teacher_initial,
    };
  }

  const teacher =
    (await findOne('teachers', caseInsensitive('email', login))) ||
    (await findOne('teachers', caseInsensitive('initial', login)));
  if (teacher?.password_hash && bcrypt.compareSync(password, teacher.password_hash)) {
    return {
      role: 'teacher',
      id: teacher.id,
      name: teacher.name,
      email: teacher.email,
      teacherInitial: teacher.initial,
    };
  }

  const student =
    (await findOne('students', caseInsensitive('email', login))) ||
    (await findOne('students', caseInsensitive('student_id', login)));
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
export async function enrichSession(session) {
  if (!session) return null;
  const out = { ...session };
  if (session.role === 'student') {
    const row = await findOne('students', { id: session.id }, { projection: { profile_pic: 1 } });
    out.profilePic = row?.profile_pic || null;
  } else if (session.role === 'teacher' || session.role === 'teacher_admin') {
    const row = session.teacherInitial
      ? await findOne('teachers', { initial: session.teacherInitial }, { projection: { profile_pic: 1 } })
      : await findOne('teachers', { id: session.id }, { projection: { profile_pic: 1 } });
    out.profilePic = row?.profile_pic || null;
  } else if (session.role === 'super_admin') {
    const row = await findOne('admins', { id: session.id }, { projection: { profile_pic: 1 } });
    out.profilePic = row?.profile_pic || null;
  }
  return out;
}

export async function updateOwnProfilePic(session, profilePic) {
  if (profilePic != null && typeof profilePic === 'string' && profilePic.length > 900_000) {
    throw Object.assign(new Error('Image is too large — try a smaller photo'), { status: 400 });
  }
  if (session.role === 'student') {
    await updateOne(
      'students',
      { id: session.id },
      { $set: { profile_pic: profilePic, updated_at: nowIso() } },
    );
    return;
  }
  if (session.role === 'teacher' || session.role === 'teacher_admin') {
    const filter = session.teacherInitial
      ? { initial: session.teacherInitial }
      : { id: session.id };
    await updateOne('teachers', filter, { $set: { profile_pic: profilePic, updated_at: nowIso() } });
    return;
  }
  if (session.role === 'super_admin') {
    await updateOne('admins', { id: session.id }, { $set: { profile_pic: profilePic } });
    return;
  }
  throw Object.assign(new Error('Unsupported role'), { status: 400 });
}

export async function changeOwnPassword(session, currentPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    throw Object.assign(new Error('New password must be at least 6 characters'), { status: 400 });
  }

  const table =
    session.role === 'student'
      ? 'students'
      : session.role === 'super_admin'
        ? 'admins'
        : 'teachers';
  const row = await findOne(table, { id: session.id });
  if (!row) throw Object.assign(new Error('Account not found'), { status: 404 });

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
    await updateOne('admins', { id: session.id }, { $set: { password_hash: hashed } });
  } else {
    await updateOne(table, { id: session.id }, {
      $set: { password_hash: hashed, has_changed_password: true, updated_at: nowIso() },
    });
  }
  return true;
}

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, HASH_ROUNDS);
}
