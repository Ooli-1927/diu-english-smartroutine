import type { DayCode, TimetableEntry } from './types';
import { DAYS } from './constants';
import { ApiError } from './api';

export type ConflictKind = 'room' | 'teacher' | 'batch';

export interface Conflict {
  kind: ConflictKind;
  day: DayCode;
  start_time: string;
  end_time: string;
  resource: string;
  message: string;
  entries: TimetableEntry[];
}

/** A draft class (no id yet) can be checked with the same rules as a saved one. */
export type ConflictCandidate = Omit<TimetableEntry, 'id'> & { id?: string };

const overlaps = (a: ConflictCandidate, b: ConflictCandidate) =>
  a.day === b.day && a.start_time < b.end_time && a.end_time > b.start_time;

/** Parallel lab groups of one batch are intentional, so only same/unsplit groups clash. */
function sameAudience(a: ConflictCandidate, b: ConflictCandidate) {
  if (a.batch_id !== b.batch_id) return false;
  if (a.group_name && b.group_name) return a.group_name === b.group_name;
  return true;
}

function pairKind(a: ConflictCandidate, b: ConflictCandidate): ConflictKind | null {
  if (a.room_id && b.room_id && a.room_id === b.room_id) return 'room';
  if (a.teacher_initial === b.teacher_initial) return 'teacher';
  if (sameAudience(a, b)) return 'batch';
  return null;
}

const describe = (e: ConflictCandidate) =>
  `${e.batch_id} ${e.course_code}${e.group_name ? ` (${e.group_name})` : ''}`;

function reason(kind: ConflictKind, a: ConflictCandidate, b: ConflictCandidate) {
  if (kind === 'room') return `Room ${a.room_id} is booked twice: ${describe(a)} and ${describe(b)}`;
  if (kind === 'teacher')
    return `${a.teacher_initial} is in two classes at once: ${describe(a)} and ${describe(b)}`;
  return `${a.batch_id} has two classes at once: ${a.course_code} and ${b.course_code}`;
}

const resourceOf = (kind: ConflictKind, e: ConflictCandidate) =>
  kind === 'room' ? e.room_id || '' : kind === 'teacher' ? e.teacher_initial : e.batch_id;

/** Everything a draft or edited class would clash with. */
export function conflictsWith(
  candidate: ConflictCandidate,
  entries: TimetableEntry[],
): Conflict[] {
  if (candidate.is_cancelled || !candidate.day || !candidate.start_time || !candidate.end_time) {
    return [];
  }
  const found: Conflict[] = [];
  for (const other of entries) {
    if (candidate.id && other.id === candidate.id) continue;
    if (other.is_cancelled || !overlaps(candidate, other)) continue;
    const kind = pairKind(candidate, other);
    if (!kind) continue;
    found.push({
      kind,
      day: candidate.day,
      start_time: candidate.start_time,
      end_time: candidate.end_time,
      resource: resourceOf(kind, candidate),
      message: reason(kind, candidate, other),
      entries: [other],
    });
  }
  return found;
}

/** Audit of the whole routine, one item per clashing pair. */
export function findConflicts(entries: TimetableEntry[]): Conflict[] {
  const list = entries.filter((e) => !e.is_cancelled);
  const conflicts: Conflict[] = [];

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!overlaps(a, b)) continue;
      const kind = pairKind(a, b);
      if (!kind) continue;
      conflicts.push({
        kind,
        day: a.day,
        start_time: a.start_time < b.start_time ? a.start_time : b.start_time,
        end_time: a.end_time > b.end_time ? a.end_time : b.end_time,
        resource: resourceOf(kind, a),
        message: reason(kind, a, b),
        entries: [a, b],
      });
    }
  }

  return conflicts.sort(
    (a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.start_time.localeCompare(b.start_time),
  );
}

export function summarizeConflicts(conflicts: Conflict[]) {
  return {
    total: conflicts.length,
    room: conflicts.filter((c) => c.kind === 'room').length,
    teacher: conflicts.filter((c) => c.kind === 'teacher').length,
    batch: conflicts.filter((c) => c.kind === 'batch').length,
  };
}

/** Ids of every class taking part in a conflict, for badging cards in a list. */
export function conflictingEntryIds(conflicts: Conflict[]): Set<string> {
  const ids = new Set<string>();
  for (const c of conflicts) for (const e of c.entries) ids.add(e.id);
  return ids;
}

/** Thrown in offline modes so every backend refuses a clash the same way. */
export class ConflictError extends Error {
  conflicts: Conflict[];

  constructor(conflicts: Conflict[]) {
    super(
      `This class clashes with ${conflicts.length} existing ${
        conflicts.length === 1 ? 'class' : 'classes'
      }`,
    );
    this.name = 'ConflictError';
    this.conflicts = conflicts;
  }
}

/** Reads clash details out of either a local or a server-side rejection. */
export function conflictMessages(err: unknown): string[] | null {
  if (err instanceof ConflictError) return err.conflicts.map((c) => c.message);
  if (err instanceof ApiError && err.status === 409) return err.conflicts.map((c) => c.message);
  return null;
}

export function conflictLabel(kind: ConflictKind) {
  if (kind === 'room') return 'Room clash';
  if (kind === 'teacher') return 'Teacher clash';
  return 'Batch clash';
}
