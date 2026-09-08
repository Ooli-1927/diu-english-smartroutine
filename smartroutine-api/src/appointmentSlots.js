import { all, bind, get } from './db.js';

export const SLOT_DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const JS_DAY_TO_CODE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function weekdayFromDate(isoDate) {
  const raw = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return JS_DAY_TO_CODE[d.getDay()];
}

function isoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function normalizeClock(value) {
  const t = String(value || '').trim();
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const hh = String(Math.min(23, Number(m[1]))).padStart(2, '0');
  const mm = String(Math.min(59, Number(m[2]))).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function timeToMinutes(value) {
  const t = normalizeClock(value);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function slotCovers(slot, date, time) {
  if (!slot || weekdayFromDate(date) !== slot.day) return false;
  const t = timeToMinutes(time);
  const start = timeToMinutes(slot.start_time);
  const end = timeToMinutes(slot.end_time);
  if (t == null || start == null || end == null) return false;
  return t >= start && t < end;
}

export function teacherSlots(teacherInitial, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? `SELECT * FROM appointment_slots
       WHERE teacher_initial = ? AND is_active = 1
       ORDER BY CASE day
         WHEN 'Sat' THEN 0 WHEN 'Sun' THEN 1 WHEN 'Mon' THEN 2 WHEN 'Tue' THEN 3
         WHEN 'Wed' THEN 4 WHEN 'Thu' THEN 5 ELSE 6 END, start_time`
    : `SELECT * FROM appointment_slots
       WHERE teacher_initial = ?
       ORDER BY CASE day
         WHEN 'Sat' THEN 0 WHEN 'Sun' THEN 1 WHEN 'Mon' THEN 2 WHEN 'Tue' THEN 3
         WHEN 'Wed' THEN 4 WHEN 'Thu' THEN 5 ELSE 6 END, start_time`;
  return all(sql, [bind(teacherInitial)]);
}

export function matchingSlot(teacherInitial, date, time) {
  return teacherSlots(teacherInitial, { activeOnly: true }).find((s) => slotCovers(s, date, time)) || null;
}

export function slotOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    teacher_initial: row.teacher_initial,
    day: row.day,
    start_time: normalizeClock(row.start_time),
    end_time: normalizeClock(row.end_time),
    location: row.location || '',
    note: row.note || '',
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function existingBooking(teacherInitial, date, time, exceptId = null) {
  const rows = all(
    `SELECT id FROM appointments
     WHERE teacher_initial = ? AND date = ? AND time = ?
       AND status IN ('pending', 'accepted')`,
    [bind(teacherInitial), bind(date), bind(normalizeClock(time))],
  );
  return rows.find((r) => r.id !== exceptId) || null;
}

export function upcomingWindows(slots, { daysAhead = 21 } = {}) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const out = [];
  for (let i = 0; i < daysAhead; i += 1) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const day = JS_DAY_TO_CODE[d.getDay()];
    const iso = isoLocal(d);
    for (const slot of slots) {
      if (slot.is_active === 0 || slot.is_active === false) continue;
      if (slot.day !== day) continue;
      out.push({
        slot_id: slot.id,
        teacher_initial: slot.teacher_initial,
        date: iso,
        day,
        start_time: normalizeClock(slot.start_time),
        end_time: normalizeClock(slot.end_time),
        location: slot.location || '',
        note: slot.note || '',
      });
    }
  }
  return out;
}

export function getTeacher(initial) {
  return get(
    'SELECT initial, name, email FROM teachers WHERE lower(initial) = lower(?)',
    [String(initial || '').trim()],
  );
}
