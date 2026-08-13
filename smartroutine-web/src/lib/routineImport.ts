import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ClassMode, ClassType, Course, DayCode, Room, TimetableEntry } from './types';
import type { StoreState } from './store';
import { DAYS } from './constants';
import { ROUTINE_JSON_END, ROUTINE_JSON_START, type RoutinePdfRow } from './pdf';

GlobalWorkerOptions.workerSrc = pdfWorker;

export type ImportDraft = Omit<TimetableEntry, 'id'>;

export type ParsedRoutine = {
  drafts: ImportDraft[];
  courseTitles: Map<string, string>;
};

const DAY_SET = new Set<string>(DAYS);
const TYPE_SET = new Set(['Lecture', 'Tutorial', 'Sessional', 'Online']);
const MODE_SET = new Set(['Onsite', 'Online', 'Offline']);

function asDay(v: string): DayCode | null {
  const d = v.trim();
  return DAY_SET.has(d) ? (d as DayCode) : null;
}

function asType(v: string | undefined): ClassType {
  const t = (v || 'Lecture').trim();
  return TYPE_SET.has(t) ? (t as ClassType) : 'Lecture';
}

function asMode(v: string | undefined): ClassMode {
  const m = (v || 'Onsite').trim();
  return MODE_SET.has(m) ? (m as ClassMode) : 'Onsite';
}

function normalizeTime(t: string): string {
  const m = String(t || '')
    .trim()
    .match(/(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function fromPdfRow(e: RoutinePdfRow | Record<string, unknown>): ImportDraft {
  const r = e as RoutinePdfRow & Record<string, unknown>;
  return {
    day: String(r.day) as DayCode,
    batch_id: String(r.batch_id || r.batch || ''),
    teacher_initial: String(r.teacher_initial || r.teacher || '').toUpperCase(),
    course_code: String(r.course_code || r.code || '').trim(),
    type: asType(String(r.type || 'Lecture')),
    mode: asMode(String(r.mode || 'Onsite')),
    start_time: normalizeTime(String(r.start_time || r.start || '')),
    end_time: normalizeTime(String(r.end_time || r.end || '')),
    room_id: (r.room_id as string) || (r.room_name as string) || (r.room as string) || null,
    group_name: (r.group_name as string) || (r.group as string) || null,
    is_cancelled: Boolean(r.is_cancelled),
    cancellation_reason: (r.cancellation_reason as string) || null,
  };
}

async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lineMap = new Map<number, string[]>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str) continue;
      const y = Math.round(('transform' in item ? item.transform[5] : 0) as number);
      const row = lineMap.get(y) || [];
      row.push(item.str);
      lineMap.set(y, row);
    }
    const sorted = [...lineMap.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, words] of sorted) parts.push(words.join(' '));
    parts.push('\n');
  }
  return parts.join('\n');
}

function parseEmbeddedJson(text: string): ParsedRoutine | null {
  const start = text.indexOf(ROUTINE_JSON_START);
  const end = text.indexOf(ROUTINE_JSON_END);
  if (start < 0 || end < 0 || end <= start) return null;
  const raw = text.slice(start + ROUTINE_JSON_START.length, end).replace(/\s+/g, ' ').trim();
  try {
    const json = JSON.parse(raw) as { entries?: RoutinePdfRow[] } | RoutinePdfRow[];
    const list = Array.isArray(json) ? json : json.entries || [];
    const courseTitles = new Map<string, string>();
    for (const e of list) {
      if (e.course_code && e.course_title) courseTitles.set(e.course_code, e.course_title);
    }
    return { drafts: list.map((e) => fromPdfRow(e)), courseTitles };
  } catch {
    return null;
  }
}

/** Parse the visible export table when embedded JSON is missing. */
function parseTableText(text: string): ImportDraft[] {
  const rows: ImportDraft[] = [];
  const lineRe =
    /^(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\s+(.+?)\s+([A-Z]{1,6}\s?\d{2,4})\s+.*?([A-Z]{1,6})\s+(Lecture|Tutorial|Sessional|Online)\s+(Onsite|Online|Offline)\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s+(\S.*?)(?:\s+(G\d+|Cancelled|Active))?/i;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(lineRe);
    if (m) {
      const roomToken = m[9].replace(/\s+(Active|Cancelled)$/i, '').trim();
      const groupMatch = trimmed.match(/\b(G\d+)\b/i);
      rows.push({
        day: m[1] as DayCode,
        batch_id: m[2].trim(),
        course_code: m[3].replace(/\s+/g, ' ').trim(),
        teacher_initial: m[4].toUpperCase(),
        type: asType(m[5]),
        mode: asMode(m[6]),
        start_time: normalizeTime(m[7]),
        end_time: normalizeTime(m[8]),
        room_id: /online/i.test(roomToken) ? null : roomToken,
        group_name: groupMatch?.[1] || null,
        is_cancelled: /cancelled/i.test(trimmed),
        cancellation_reason: null,
      });
      continue;
    }

    // Loose pattern: Day Code Teacher HH:MM-HH:MM Room Batch?
    const loose = trimmed.match(
      /^(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\b.*?([A-Z]{1,6}\s?\d{2,4}).*?\b([A-Z]{2,6})\b.*?(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})(?:.*?(\d{3,4}(?:\s*\([^)]+\))?))?/i,
    );
    if (loose && asDay(loose[1])) {
      rows.push({
        day: loose[1] as DayCode,
        batch_id: '',
        course_code: loose[2].replace(/\s+/g, ' ').trim(),
        teacher_initial: loose[3].toUpperCase(),
        type: /lab|sessional/i.test(trimmed) ? 'Sessional' : 'Lecture',
        mode: /online/i.test(trimmed) ? 'Online' : 'Onsite',
        start_time: normalizeTime(loose[4]),
        end_time: normalizeTime(loose[5]),
        room_id: loose[6] || null,
        group_name: trimmed.match(/\b(G\d+)\b/i)?.[1] || null,
        is_cancelled: false,
        cancellation_reason: null,
      });
    }
  }
  return rows;
}

function parseJsonText(text: string): ImportDraft[] {
  const json = JSON.parse(text) as {
    entries?: Array<Record<string, unknown>>;
  };
  const list = json.entries || (Array.isArray(json) ? json : []);
  return (list as Array<Record<string, unknown>>).map((e) => fromPdfRow(e));
}

function parseCsvText(text: string): ImportDraft[] {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const start = /day/i.test(lines[0]) ? 1 : 0;
  const rows: ImportDraft[] = [];
  for (const line of lines.slice(start)) {
    const cols = line.split(',').map((x) => x.trim());
    const [
      d,
      batch_id,
      teacher_initial,
      course_code,
      type,
      mode,
      startTime,
      endTime,
      room_id,
      group,
      is_cancelled,
      cancellation_reason,
    ] = cols;
    if (!d || !asDay(d)) continue;
    rows.push({
      day: d as DayCode,
      batch_id,
      teacher_initial: (teacher_initial || '').toUpperCase(),
      course_code,
      type: asType(type),
      mode: asMode(mode),
      start_time: normalizeTime(startTime),
      end_time: normalizeTime(endTime),
      room_id: room_id || null,
      group_name: group || null,
      is_cancelled: is_cancelled === 'true',
      cancellation_reason: cancellation_reason || null,
    });
  }
  return rows;
}

export async function parseRoutineFile(file: File): Promise<ParsedRoutine> {
  const emptyTitles = new Map<string, string>();
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    const text = await extractPdfText(file);
    const embedded = parseEmbeddedJson(text);
    if (embedded?.drafts.length) return embedded;
    const table = parseTableText(text);
    if (!table.length) {
      throw new Error(
        'Could not read class rows from this PDF. Prefer a PDF exported from this Timetable page (PDF button), or import JSON/CSV.',
      );
    }
    return { drafts: table, courseTitles: emptyTitles };
  }

  const text = await file.text();
  if (name.endsWith('.json')) {
    const drafts = parseJsonText(text);
    const courseTitles = new Map<string, string>();
    try {
      const json = JSON.parse(text) as { entries?: Array<{ course_code?: string; course_title?: string }> };
      for (const e of json.entries || []) {
        if (e.course_code && e.course_title) courseTitles.set(e.course_code, e.course_title);
      }
    } catch {
      /* ignore */
    }
    return { drafts, courseTitles };
  }
  return { drafts: parseCsvText(text), courseTitles: emptyTitles };
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveBatchId(store: StoreState, token: string): string | null {
  const t = token.trim();
  if (!t) return null;
  const byId = store.batches.find((b) => b.id === t || normKey(b.id) === normKey(t));
  if (byId) return byId.id;
  const byName = store.batches.find(
    (b) => normKey(b.name) === normKey(t) || normKey(b.name).includes(normKey(t)),
  );
  if (byName) return byName.id;
  // "7th Batch" / "7th"
  const m = t.match(/(\d+)(st|nd|rd|th)?/i);
  if (m) {
    const hit = store.batches.find(
      (b) => b.id.toLowerCase().startsWith(m[1]) || normKey(b.name).startsWith(m[1]),
    );
    if (hit) return hit.id;
  }
  if (/^msc$/i.test(t)) {
    const msc = store.batches.find((b) => /msc/i.test(b.id) || /msc/i.test(b.name));
    if (msc) return msc.id;
  }
  return null;
}

function resolveRoomId(store: StoreState, token: string | null, mode: ClassMode): string | null {
  if (!token || mode === 'Online' || /^online$/i.test(token)) return null;
  const t = token.trim();
  const byId = store.rooms.find((r) => r.id === t || normKey(r.id) === normKey(t));
  if (byId) return byId.id;
  const byName = store.rooms.find(
    (r) => normKey(r.name) === normKey(t) || normKey(r.name).startsWith(normKey(t.split('(')[0])),
  );
  if (byName) return byName.id;
  // extract leading digits e.g. "2701 (LAB)" → 2701
  const digits = t.match(/(\d{3,4})/);
  if (digits) {
    const hit = store.rooms.find((r) => r.id === digits[1] || r.name.startsWith(digits[1]));
    if (hit) return hit.id;
  }
  return t; // keep as candidate id for auto-create
}

export type ResolveResult = {
  entries: ImportDraft[];
  createdCourses: Course[];
  createdRooms: Room[];
  rejected: Array<{ row: number; reason: string }>;
};

/**
 * Map PDF/CSV tokens onto live batch / teacher / room / course IDs.
 * Missing courses & rooms are queued for auto-create; unknown teachers/batches are rejected.
 */
export function resolveRoutineImport(
  store: StoreState,
  drafts: ImportDraft[],
  extras?: { courseTitles?: Map<string, string> },
): ResolveResult {
  const createdCourses: Course[] = [];
  const createdRooms: Room[] = [];
  const courseCodes = new Set(store.courses.map((c) => c.code));
  const roomIds = new Set(store.rooms.map((r) => r.id));
  const teacherSet = new Set(store.teachers.map((t) => t.initial.toUpperCase()));
  const entries: ImportDraft[] = [];
  const rejected: Array<{ row: number; reason: string }> = [];

  drafts.forEach((raw, index) => {
    const batch_id = resolveBatchId(store, raw.batch_id);
    if (!batch_id) {
      rejected.push({
        row: index + 1,
        reason: `unknown batch "${raw.batch_id || '(empty)'}" — add the batch first`,
      });
      return;
    }
    const teacher_initial = (raw.teacher_initial || '').toUpperCase();
    if (!teacherSet.has(teacher_initial)) {
      rejected.push({
        row: index + 1,
        reason: `unknown teacher "${teacher_initial}" — add the teacher first`,
      });
      return;
    }
    if (!raw.course_code || !raw.start_time || !raw.end_time || !asDay(raw.day)) {
      rejected.push({ row: index + 1, reason: 'missing day, course or time' });
      return;
    }

    const course_code = raw.course_code.replace(/\s+/g, ' ').trim();
    if (!courseCodes.has(course_code)) {
      const title =
        extras?.courseTitles?.get(course_code) ||
        course_code;
      const course: Course = { id: course_code, code: course_code, title };
      createdCourses.push(course);
      courseCodes.add(course_code);
    }

    let room_id = resolveRoomId(store, raw.room_id, raw.mode);
    if (room_id && !roomIds.has(room_id)) {
      const name = String(raw.room_id || room_id);
      const id = name.match(/(\d{3,4})/)?.[1] || room_id;
      if (!roomIds.has(id)) {
        createdRooms.push({ id, name: name.includes(id) ? name : id });
        roomIds.add(id);
      }
      room_id = id;
    }

    entries.push({
      ...raw,
      batch_id,
      teacher_initial,
      course_code,
      room_id,
      group_name: raw.group_name || null,
      type: asType(raw.type),
      mode: asMode(raw.mode),
    });
  });

  return { entries, createdCourses, createdRooms, rejected };
}
