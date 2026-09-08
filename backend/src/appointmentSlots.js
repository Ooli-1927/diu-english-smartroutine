import { findMany, findOne, caseInsensitive } from './db.js';

export const SLOT_DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const JS_DAY_TO_CODE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 };

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

export async function teacherSlots(teacherInitial, { activeOnly = false } = {}) {
  const filter = { teacher_initial: teacherInitial };
  if (activeOnly) filter.is_active = { $ne: false };
  const rows = await findMany('appointment_slots', filter);
  return rows.sort((a, b) => {
    const d = (DAY_ORDER[a.day] ?? 9) - (DAY_ORDER[b.day] ?? 9);
    if (d) return d;
    return String(a.start_time).localeCompare(String(b.start_time));
  });
}

export async function matchingSlot(teacherInitial, date, time) {
  const slots = await teacherSlots(teacherInitial, { activeOnly: true });
  return slots.find((s) => slotCovers(s, date, time)) || null;
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
    is_active: row.is_active !== false && row.is_active !== 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function existingBooking(teacherInitial, date, time, exceptId = null) {
  const rows = await findMany('appointments', {
    teacher_initial: teacherInitial,
    date,
    time: normalizeClock(time),
    status: { $in: ['pending', 'accepted'] },
  });
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

export async function getTeacher(initial) {
  return findOne('teachers', caseInsensitive('initial', String(initial || '').trim()), {
    projection: { initial: 1, name: 1, email: 1 },
  });
}
