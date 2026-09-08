import type { DayCode } from './types';

export const DAYS: DayCode[] = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const TIME_SLOTS = [
  '08:30 - 10:00',
  '10:00 - 11:30',
  '11:30 - 01:00',
  '01:00 - 02:30',
  '02:30 - 04:00',
] as const;

export const MORNING_SLOTS = TIME_SLOTS.slice(0, 3);
export const AFTERNOON_SLOTS = TIME_SLOTS.slice(3);

export const CLASS_TYPES = ['Lecture', 'Tutorial', 'Sessional', 'Online'] as const;
export const CLASS_MODES = ['Onsite', 'Online', 'Offline'] as const;

export const SESSION_KEY = 'diu_auth_session';
/** Bumped when offline credential seeding changed (invalidates old localStorage with hardcoded demos). */
export const LOCAL_DATA_KEY = 'diu_local_data_v3';

export function todayDay(): DayCode {
  const map: DayCode[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return map[new Date().getDay()];
}

export function formatTime(t: string): string {
  if (!t) return '';
  return t.length >= 5 ? t.slice(0, 5) : t;
}

export function parseSlot(slot: string): { start: string; end: string } {
  const [start, end] = slot.split(' - ').map((s) => s.trim());
  return { start: normalizeTime(start), end: normalizeTime(end) };
}

function normalizeTime(t: string): string {
  // Convert 01:00 style afternoon labels to 24h for comparison where needed
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h)) return t;
  // Heuristic: slots after noon written as 01/02 → add 12 if hour < 8
  if (h > 0 && h < 8) return `${String(h + 12).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return `${String(h).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;
}

export function timesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = toMinutes(aStart);
  const ae = toMinutes(aEnd);
  const bs = toMinutes(bStart);
  const be = toMinutes(bEnd);
  return as < be && bs < ae;
}

function toMinutes(t: string): number {
  const n = normalizeTime(formatTime(t));
  const [h, m] = n.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
