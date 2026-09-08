/**
 * Parse DIU Summer routine Excel → update seed.json timetable with section letters.
 * Usage: node scripts/import-summer-excel.mjs "path/to/file.xlsx"
 */
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const seedPath = join(root, 'backend', 'data', 'seed.json');
const excelPath = process.argv[2];

if (!excelPath) {
  console.error('Usage: node scripts/import-summer-excel.mjs <excel-path>');
  process.exit(1);
}

const DAY_MAP = {
  saturday: 'Sat',
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

/** Header row 1 slots → [start, end] HH:MM (24h). */
const SLOTS = [
  ['08:30', '10:00'],
  ['10:00', '11:30'],
  ['11:30', '13:00'],
  ['13:00', '14:30'],
  ['14:30', '16:00'],
  ['16:00', '17:30'],
];

function normalizeCourse(raw) {
  let s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  // Fix missing closing paren: ENG 0232-24(61A
  if (/\(\d{2}[A-Z]?$/.test(s)) s += ')';
  return s;
}

/** ENG 0231-34(58A) → { course, batch, section } */
function parseCell(raw) {
  const s = normalizeCourse(raw);
  if (!s) return null;

  const m = s.match(/^(.+?)\((\d{2}|RETAKE)([A-Z]?)\)\s*$/i);
  if (m) {
    return {
      course_code: m[1].trim().replace(/\s+/g, ' '),
      batch_id: m[2].toUpperCase() === 'RETAKE' ? 'RETAKE' : m[2],
      section: m[3] ? m[3].toUpperCase() : null,
    };
  }

  // Odd combined cells without clean batch tag
  if (/RETAKE/i.test(s)) {
    return { course_code: s.replace(/\(RETAKE\)/i, '').trim() || s, batch_id: 'RETAKE', section: null };
  }
  return null;
}

function padRoom(id) {
  return String(id || '').trim();
}

const wb = XLSX.readFile(excelPath);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
const knownTeachers = new Set((seed.teachers || []).map((t) => String(t.initial).toUpperCase()));
const knownBatches = new Set((seed.batches || []).map((b) => String(b.id)));
const courseByCode = new Map((seed.courses || []).map((c) => [c.code, c]));
const roomById = new Map((seed.rooms || []).map((r) => [String(r.id), r]));

const entries = [];
const skipped = [];
const sectionsByBatch = new Map();
let currentDay = null;

for (let ri = 3; ri < rows.length; ri += 1) {
  const row = rows[ri];
  if (!row || !row.length) continue;

  const dayCell = String(row[0] || '').trim();
  if (dayCell && DAY_MAP[dayCell.toLowerCase()]) {
    currentDay = DAY_MAP[dayCell.toLowerCase()];
  }
  if (!currentDay) continue;

  const roomId = padRoom(row[1]);
  if (!roomId || !/^\d/.test(roomId) && !/^[A-Za-z0-9]+$/.test(roomId)) continue;
  if (/^day$/i.test(roomId)) continue;

  if (!roomById.has(roomId)) {
    roomById.set(roomId, { id: roomId, name: roomId });
  }

  for (let si = 0; si < SLOTS.length; si += 1) {
    const codeCol = 2 + si * 2;
    const intCol = 3 + si * 2;
    const cell = String(row[codeCol] || '').trim();
    const initial = String(row[intCol] || '')
      .trim()
      .toUpperCase();
    if (!cell) continue;

    const parsed = parseCell(cell);
    if (!parsed) {
      skipped.push({ day: currentDay, room: roomId, cell, reason: 'unparsed' });
      continue;
    }
    if (!knownBatches.has(parsed.batch_id)) {
      skipped.push({ day: currentDay, room: roomId, cell, reason: `unknown batch ${parsed.batch_id}` });
      continue;
    }
    if (!initial || !knownTeachers.has(initial)) {
      skipped.push({
        day: currentDay,
        room: roomId,
        cell,
        reason: `unknown teacher ${initial || '(empty)'}`,
      });
      continue;
    }

    if (!courseByCode.has(parsed.course_code)) {
      courseByCode.set(parsed.course_code, {
        code: parsed.course_code,
        title: parsed.course_code,
      });
    }

    if (parsed.section) {
      const set = sectionsByBatch.get(parsed.batch_id) || new Set();
      set.add(parsed.section);
      sectionsByBatch.set(parsed.batch_id, set);
    }

    const [start, end] = SLOTS[si];
    entries.push({
      day: currentDay,
      batch_id: parsed.batch_id,
      teacher_initial: initial,
      course_code: parsed.course_code,
      type: 'Lecture',
      section: parsed.section,
      group: parsed.section,
      room_id: roomId,
      mode: 'Onsite',
      start,
      end,
      is_cancelled: false,
    });
  }
}

/** Deduplicate identical slots (same day/batch/section/course/teacher/time/room). */
const seen = new Set();
const unique = [];
for (const e of entries) {
  const key = [
    e.day,
    e.batch_id,
    e.section || '',
    e.course_code,
    e.teacher_initial,
    e.start,
    e.end,
    e.room_id,
  ].join('|');
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(e);
}

/** Assign demo students a real section for their batch (cycle A,B,C…). */
const students = (seed.students || []).map((s, i) => {
  const secs = [...(sectionsByBatch.get(String(s.batch_id)) || new Set(['A']))].sort();
  const section = secs[i % secs.length] || 'A';
  return { ...s, section };
});

const stamp = new Date().toISOString();
seed.meta = {
  ...seed.meta,
  version: '3.1.0-diu-summer-2026-sections',
  updated_at: stamp,
  term: seed.meta?.term || 'Summer 2026',
  source_files: [
    ...(seed.meta?.source_files || []).filter((f) => !/Summer 2026/i.test(f)),
    'Summer 2026 ( V- 0.4) (1) (1).xlsx',
  ],
};

seed.courses = [...courseByCode.values()].sort((a, b) => a.code.localeCompare(b.code));
seed.rooms = [...roomById.values()].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
seed.timetable = unique;
seed.students = students;

copyFileSync(seedPath, `${seedPath}.bak-pre-section`);
writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');

console.log('Wrote', seedPath);
console.log('entries', unique.length, '(raw', entries.length, ')');
console.log('courses', seed.courses.length, 'rooms', seed.rooms.length, 'students', students.length);
console.log('sections by batch:');
for (const [b, set] of [...sectionsByBatch.entries()].sort()) {
  console.log(' ', b, [...set].sort().join(''));
}
console.log('skipped', skipped.length);
if (skipped.length) {
  const reasons = {};
  for (const s of skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  console.log(reasons);
  console.log('sample skipped:', skipped.slice(0, 8));
}
