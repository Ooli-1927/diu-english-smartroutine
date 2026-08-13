import type { DayCode, Room, TimetableEntry } from './types';
import { conflictsWith, type ConflictCandidate } from './conflicts';
import { DAYS, formatTime } from './constants';

export interface Suggestion {
  id: string;
  kind: 'room' | 'online' | 'slot';
  label: string;
  detail: string;
  patch: Partial<TimetableEntry>;
}

interface Slot {
  start: string;
  end: string;
}

const MAX_ROOM_SWAPS = 3;
const MAX_SLOT_MOVES = 4;

const isLab = (room: Room) => /lab/i.test(room.name);

/** The periods the routine actually uses, so a fix never invents a new time. */
export function timetableSlots(entries: TimetableEntry[]): Slot[] {
  const seen = new Map<string, Slot>();
  for (const e of entries) {
    seen.set(`${e.start_time}|${e.end_time}`, { start: e.start_time, end: e.end_time });
  }
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}

const resolves = (candidate: ConflictCandidate, entries: TimetableEntry[]) =>
  conflictsWith(candidate, entries).length === 0;

/** Sessionals stay in labs, lectures stay out of them, and the same floor comes first. */
function roomPreference(entry: TimetableEntry, rooms: Room[]): Room[] {
  const wantsLab = entry.type === 'Sessional';
  const floor = String(entry.room_id || '').charAt(0);
  return [...rooms].sort((a, b) => {
    const labA = isLab(a) === wantsLab ? 0 : 1;
    const labB = isLab(b) === wantsLab ? 0 : 1;
    if (labA !== labB) return labA - labB;
    const floorA = String(a.id).charAt(0) === floor ? 0 : 1;
    const floorB = String(b.id).charAt(0) === floor ? 0 : 1;
    return floorA - floorB || a.id.localeCompare(b.id);
  });
}

/**
 * Every change that would leave this class clash-free, cheapest first:
 * 1. swap the room (same day/period)
 * 2. run online (frees the room)
 * 3. move to another free period (optionally with a new room)
 */
export function suggestFixes(
  entry: TimetableEntry,
  entries: TimetableEntry[],
  rooms: Room[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const pool = roomPreference(entry, rooms);

  // Room swap is the cheapest fix for a room clash and never moves the class.
  for (const room of pool) {
    if (suggestions.length >= MAX_ROOM_SWAPS) break;
    if (room.id === entry.room_id) continue;
    if (!resolves({ ...entry, room_id: room.id }, entries)) continue;
    const sameFloor = String(room.id).charAt(0) === String(entry.room_id || '').charAt(0);
    suggestions.push({
      id: `room-${room.id}`,
      kind: 'room',
      label: `Move to room ${room.name}`,
      detail: sameFloor
        ? 'Same day, same period, same floor'
        : 'Same day and period — different floor',
      patch: { room_id: room.id },
    });
  }

  if (
    entry.room_id &&
    entry.mode !== 'Online' &&
    resolves({ ...entry, room_id: null, mode: 'Online' }, entries)
  ) {
    suggestions.push({
      id: 'online',
      kind: 'online',
      label: 'Run this class online',
      detail: 'Keeps the time and frees the room',
      patch: { room_id: null, mode: 'Online' },
    });
  }

  // Prefer same day first so the batch's week shape stays intact.
  const days = [entry.day, ...DAYS.filter((d) => d !== entry.day)] as DayCode[];
  const slots = timetableSlots(entries);
  let moves = 0;

  for (const day of days) {
    for (const slot of slots) {
      if (moves >= MAX_SLOT_MOVES) break;
      if (day === entry.day && slot.start === entry.start_time) continue;

      const moved = { ...entry, day, start_time: slot.start, end_time: slot.end };
      const when = `${day} ${formatTime(slot.start)}–${formatTime(slot.end)}`;
      const sameDay = day === entry.day;

      if (resolves(moved, entries)) {
        suggestions.push({
          id: `slot-${day}-${slot.start}`,
          kind: 'slot',
          label: `Move to ${when}`,
          detail: entry.room_id
            ? `${sameDay ? 'Same day' : 'New day'} · keeps room ${entry.room_id}`
            : sameDay
              ? 'Same day · different period'
              : 'Different day and period',
          patch: { day, start_time: slot.start, end_time: slot.end },
        });
        moves += 1;
        continue;
      }

      // Period free for batch/teacher but this room is busy — offer a free room too.
      const room = pool.find(
        (r) => r.id !== entry.room_id && resolves({ ...moved, room_id: r.id }, entries),
      );
      if (room) {
        suggestions.push({
          id: `slot-${day}-${slot.start}-${room.id}`,
          kind: 'slot',
          label: `Move to ${when}`,
          detail: `In room ${room.name}`,
          patch: { day, start_time: slot.start, end_time: slot.end, room_id: room.id },
        });
        moves += 1;
      }
    }
    if (moves >= MAX_SLOT_MOVES) break;
  }

  return suggestions;
}

/**
 * Every clash-free day+period this class can move to. Used by the teacher
 * reschedule UI so only safe options are offered — never a free-text time.
 */
export function listRescheduleOptions(
  entry: TimetableEntry,
  entries: TimetableEntry[],
  rooms: Room[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const pool = roomPreference(entry, rooms);
  const slots = timetableSlots(entries);
  const online = entry.mode === 'Online';

  for (const day of DAYS) {
    for (const slot of slots) {
      if (day === entry.day && slot.start === entry.start_time.slice(0, 5)) continue;

      const when = `${day} ${formatTime(slot.start)}–${formatTime(slot.end)}`;
      const moved: ConflictCandidate = {
        ...entry,
        day,
        start_time: slot.start,
        end_time: slot.end,
        ...(online ? { room_id: null } : {}),
      };

      if (resolves(moved, entries)) {
        suggestions.push({
          id: `slot-${day}-${slot.start}`,
          kind: 'slot',
          label: when,
          detail: online
            ? 'Online · no room needed'
            : entry.room_id
              ? `Keeps room ${entry.room_id}`
              : 'No room assigned',
          patch: {
            day,
            start_time: slot.start,
            end_time: slot.end,
            ...(online ? { room_id: null, mode: 'Online' } : {}),
          },
        });
        continue;
      }

      if (online) continue;

      // Same period is free for teacher/batch but this room is busy — offer a free room.
      const room = pool.find((r) => resolves({ ...moved, room_id: r.id }, entries));
      if (room) {
        suggestions.push({
          id: `slot-${day}-${slot.start}-${room.id}`,
          kind: 'slot',
          label: when,
          detail: `Room ${room.name}`,
          patch: { day, start_time: slot.start, end_time: slot.end, room_id: room.id },
        });
      }
    }
  }

  return suggestions;
}

/** Rooms free for this class's current day/period (teacher/batch already hold the slot). */
export function listFreeRooms(
  entry: TimetableEntry,
  entries: TimetableEntry[],
  rooms: Room[],
): Room[] {
  return roomPreference(entry, rooms).filter((r) =>
    resolves({ ...entry, room_id: r.id }, entries),
  );
}
