import { createEvents, type EventAttributes } from 'ics';
import { formatTime } from './constants';
import type {
  Batch,
  Course,
  DayCode,
  Room,
  Teacher,
  TimetableEntry,
} from './types';

const JS_WEEKDAY: Record<DayCode, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const RRULE_BYDAY: Record<DayCode, string> = {
  Sun: 'SU',
  Mon: 'MO',
  Tue: 'TU',
  Wed: 'WE',
  Thu: 'TH',
  Fri: 'FR',
  Sat: 'SA',
};

export type CalendarLookup = {
  courseByCode: (code: string) => Course | undefined;
  teacherByInitial: (initial: string) => Teacher | undefined;
  batchById: (id: string) => Batch | undefined;
  roomById: (id: string | null | undefined) => Room | undefined;
};

function parseHm(raw: string): { hour: number; minute: number } {
  const t = formatTime(raw);
  const [h, m] = t.split(':').map((n) => Number(n));
  return {
    hour: Number.isFinite(h) ? h : 0,
    minute: Number.isFinite(m) ? m : 0,
  };
}

/** Next calendar date (local) that falls on the given routine day code. */
export function nextOccurrenceOfDay(day: DayCode, from = new Date()): Date {
  const target = JS_WEEKDAY[day];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const delta = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  return d;
}

function toDateArray(date: Date, time: string): [number, number, number, number, number] {
  const { hour, minute } = parseHm(time);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), hour, minute];
}

function sanitizeFilename(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'routine';
}

function locationFor(entry: TimetableEntry, lookup: CalendarLookup): string {
  if (entry.mode === 'Online') return 'Online';
  const room = lookup.roomById(entry.room_id);
  return room?.name || entry.room_id || 'TBA';
}

function descriptionFor(
  entry: TimetableEntry,
  audience: 'student' | 'teacher',
  lookup: CalendarLookup,
): string {
  const parts: string[] = [];
  if (audience === 'student') {
    const teacher = lookup.teacherByInitial(entry.teacher_initial);
    parts.push(
      teacher
        ? `Teacher: ${teacher.name} (${teacher.initial})`
        : `Teacher: ${entry.teacher_initial}`,
    );
  } else {
    const batch = lookup.batchById(entry.batch_id);
    parts.push(
      batch
        ? `Batch: ${batch.name}${batch.session ? ` · ${batch.session}` : ''}`
        : `Batch: ${entry.batch_id}`,
    );
  }
  if (entry.group_name) parts.push(`Group: ${entry.group_name}`);
  parts.push(`Type: ${entry.type} · Mode: ${entry.mode}`);
  return parts.join('\n');
}

/**
 * Build a weekly recurring .ics calendar for active (non-cancelled) classes.
 * No UNTIL — semester end dates are not in the data model.
 */
export function buildRoutineIcs(
  entries: TimetableEntry[],
  audience: 'student' | 'teacher',
  lookup: CalendarLookup,
): string {
  const active = entries.filter((e) => !e.is_cancelled && e.day && e.start_time && e.end_time);
  const events: EventAttributes[] = active.map((entry) => {
    const when = nextOccurrenceOfDay(entry.day);
    const course = lookup.courseByCode(entry.course_code);
    const title = course
      ? `${course.code} · ${course.title}`
      : entry.course_code;

    return {
      start: toDateArray(when, entry.start_time),
      end: toDateArray(when, entry.end_time),
      startInputType: 'local',
      endInputType: 'local',
      title,
      description: descriptionFor(entry, audience, lookup),
      location: locationFor(entry, lookup),
      uid: `${entry.id}@smartroutine.diu`,
      productId: 'DIU SmartRoutine',
      calName: 'DIU SmartRoutine',
      status: 'CONFIRMED',
      busyStatus: 'BUSY',
      recurrenceRule: `FREQ=WEEKLY;BYDAY=${RRULE_BYDAY[entry.day]}`,
      categories: ['Class', entry.type],
    };
  });

  if (!events.length) {
    throw new Error('No active classes to export');
  }

  const { error, value } = createEvents(events, {
    productId: 'DIU SmartRoutine',
    calName: 'DIU SmartRoutine',
  });

  if (error || !value) {
    throw error || new Error('Could not build calendar file');
  }
  return value;
}

export function downloadRoutineIcs(filenameBase: string, icsText: string) {
  const name = `routine-${sanitizeFilename(filenameBase)}.ics`;
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportRoutineToCalendar(
  entries: TimetableEntry[],
  audience: 'student' | 'teacher',
  filenameBase: string,
  lookup: CalendarLookup,
) {
  const icsText = buildRoutineIcs(entries, audience, lookup);
  downloadRoutineIcs(filenameBase, icsText);
}
