/**
 * Compare Downloads source files vs current seed.json / data.json.
 * Does not write seed — audit only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import mammoth from 'mammoth';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOADS = 'C:/Users/GIGRBYTE/Downloads';

const FACULTY = path.join(DOWNLOADS, 'Faculty List (1).docx');
const COURSES = path.join(DOWNLOADS, 'COURSE LIST.docx');
const XLSX_PATH = path.join(DOWNLOADS, 'Summer 2026 ( V- 0.4) (1).xlsx');
const SEED = path.join(ROOT, 'smartroutine-api/data/seed.json');
const PUBLIC = path.join(ROOT, 'smartroutine-web/public/data/data.json');

// Reuse parsers by dynamic import of the import script helpers via copy of key logic
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Inline minimal copies from import-diu-summer.mjs
const DAY_MAP = {
  saturday: 'Sat', sunday: 'Sun', monday: 'Mon', tuesday: 'Tue',
  wednesday: 'Wed', thursday: 'Thu', friday: 'Fri',
};
const SLOTS = [
  { start: '08:30', end: '10:00' },
  { start: '10:00', end: '11:30' },
  { start: '11:30', end: '13:00' },
  { start: '13:00', end: '14:30' },
  { start: '14:30', end: '16:00' },
  { start: '16:00', end: '17:30' },
];

function cleanEmail(raw) {
  if (!raw) return null;
  const matches = String(raw).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!matches?.length) return null;
  return (matches.find((e) => /diu\.edu\.bd|daffodilvarsity/i.test(e)) || matches[0]).toLowerCase();
}
function cleanPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, ' ').trim().split(/\s+/)[0];
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('880')) return `+${digits}`;
  if (digits.startsWith('0')) return `+88${digits}`;
  return `+880${digits}`;
}
function isSerial(line) { return /^\d{1,2}$/.test(line); }

function parseFacultyText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const skip = new Set(['SL', 'Name', 'ID', 'Designation', 'Email', 'Cell']);
  const teachers = [];
  let i = 0;
  while (i < lines.length) {
    if (!isSerial(lines[i])) { i += 1; continue; }
    const sl = lines[i++];
    const name = lines[i++] || '';
    let initial = '', empId = '', designation = 'Faculty', email = null, phone = null;
    const block = [];
    while (i < lines.length && !isSerial(lines[i])) block.push(lines[i++]);
    for (const tok of block) {
      if (skip.has(tok)) continue;
      if (/^[A-Z]{2,5}$/.test(tok) && !initial) { initial = tok; continue; }
      if (/^\d{6,}$/.test(tok) && !empId) { empId = tok; continue; }
      if (/@/.test(tok) && !email) { email = cleanEmail(tok); continue; }
      if (/\d{8,}/.test(tok.replace(/[-\s]/g, '')) && !phone) { phone = cleanPhone(tok); continue; }
      if (/Professor|Lecturer|Assistant|Associate|Dean|Head|Faculty|Contractual|Part Time|Needed|JMC/i.test(tok)) {
        if (!/^needed$/i.test(tok)) designation = tok;
      }
    }
    if (!name || name.length < 3) continue;
    if (/Professor|Lecturer|Assistant|Associate|Dean|Head|Faculty|@/i.test(name) && !/^(Dr\.|Mr\.|Ms\.|Professor A|Professor Dr)/i.test(name)) continue;
    if (!initial || /^needed$/i.test(initial)) {
      initial = name.replace(/^(Dr\.|Mr\.|Ms\.|Professor|Prof\.)\s*/i, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
      if (!initial) continue;
    }
    teachers.push({ id: empId || `T${String(sl).padStart(3, '0')}`, name: name.replace(/\s+/g, ' ').trim(), initial, designation: designation || 'Faculty', phone, email: email || `${initial.toLowerCase()}.eng@diu.demo`, home_department: 'English' });
  }
  const seen = new Set();
  return teachers.filter((t) => { if (seen.has(t.initial)) return false; seen.add(t.initial); return true; });
}

function normalizeCourseCode(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (/\(\d{2}[A-G]$/i.test(s)) s += ')';
  return s;
}
function parseOffering(raw) {
  const s = normalizeCourseCode(raw);
  if (!s) return null;
  let m = s.match(/^(.+?)\((\d{2})([A-G])\)$/i);
  if (m) return { course_code: m[1].trim(), batch_id: m[2], group: m[3].toUpperCase() };
  m = s.match(/^(.+?)\((RETAKE|Retake)\)$/i);
  if (m) return { course_code: m[1].trim(), batch_id: 'RETAKE', group: null };
  if (/retake/i.test(s) || /\+/.test(s)) return { course_code: s, batch_id: 'RETAKE', group: null };
  return { course_code: s, batch_id: 'MISC', group: null };
}

function parseTimetable(xlsxPath) {
  const wb = XLSX.readFile(xlsxPath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const rawSlots = [];
  let currentDay = null;
  for (let r = 3; r < rows.length; r += 1) {
    const row = rows[r];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const dayCell = String(row[0] || '').trim();
    if (dayCell && DAY_MAP[dayCell.toLowerCase()]) currentDay = DAY_MAP[dayCell.toLowerCase()];
    if (!currentDay) continue;
    const room = String(row[1] ?? '').trim();
    if (!room) continue;
    for (let s = 0; s < 6; s += 1) {
      const code = normalizeCourseCode(row[2 + s * 2]);
      const teacher = String(row[3 + s * 2] || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!code || !teacher) continue;
      const offering = parseOffering(code);
      if (!offering) continue;
      rawSlots.push({ day: currentDay, room_id: room, teacher_initial: teacher, course_code: offering.course_code, batch_id: offering.batch_id, group: offering.group, slotIndex: s, start: SLOTS[s].start, end: SLOTS[s].end });
    }
  }
  rawSlots.sort((a, b) => a.day.localeCompare(b.day) || a.room_id.localeCompare(b.room_id) || a.slotIndex - b.slotIndex || a.course_code.localeCompare(b.course_code));
  const merged = [];
  for (const slot of rawSlots) {
    const prev = merged[merged.length - 1];
    const same = prev && prev.day === slot.day && prev.room_id === slot.room_id && prev.teacher_initial === slot.teacher_initial && prev.course_code === slot.course_code && prev.batch_id === slot.batch_id && prev.group === slot.group && prev.slotIndex + 1 === slot.slotIndex && prev.end === slot.start;
    if (same) { prev.end = slot.end; prev.slotIndex = slot.slotIndex; }
    else merged.push({ ...slot });
  }
  return merged.map(({ slotIndex, ...e }) => e);
}

function parseCourseList(text) {
  const codes = new Set();
  const titles = new Map();
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const m = line.match(/^(ENG|GED)\s*[\d\-]+(?:\s*\([^)]+\))?/i) || line.match(/^([A-Z]{2,4}\s*\d{2,4}(?:-\d{2})?)/);
    // Also: CODE TITLE patterns
    let cm = line.match(/^((?:ENG|GED)\s[\d\-]+)\s+(.+)$/i);
    if (cm) {
      const code = cm[1].replace(/\s+/g, ' ').trim();
      codes.add(code);
      titles.set(code, cm[2].trim());
      continue;
    }
    cm = line.match(/^((?:ENG|GED)\s?[\d\-]+)/i);
    if (cm) codes.add(cm[1].replace(/\s+/g, ' ').trim());
  }
  return { codes, titles };
}

function entryKey(e) {
  return [e.day, e.batch_id, e.teacher_initial, e.course_code, e.group || '', e.room_id || '', e.start, e.end].join('|');
}

async function main() {
  const report = { files: {}, faculty: {}, courses: {}, timetable: {}, mismatches: [] };

  for (const [label, p] of [['faculty', FACULTY], ['courses', COURSES], ['xlsx', XLSX_PATH]]) {
    report.files[label] = { path: p, exists: fs.existsSync(p), bytes: fs.existsSync(p) ? fs.statSync(p).size : 0 };
  }

  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  const pub = JSON.parse(fs.readFileSync(PUBLIC, 'utf8'));

  const facultyText = (await mammoth.extractRawText({ path: FACULTY })).value;
  let fromDoc = parseFacultyText(facultyText);
  // Apply same force fixes as import script
  const force = {
    BB: { designation: 'Professor', email: 'drbinoy@daffodilvarsity.edu.bd' },
    LS: { email: 'liza.eng@diu.edu.bd' },
    EHE: { email: 'headenglish@daffodilvarsity.edu.bd', designation: 'Assistant Professor and Head' },
    MBU: { email: 'burhan.eng@diu.demo', name: 'Md. Burhan Uddin' },
    UF: { designation: 'Part-time Faculty (JMC)', name: 'Umme Faria' },
  };
  fromDoc = fromDoc.map((t) => ({ ...t, ...(force[t.initial] || {}) }));

  const seedTeachers = seed.teachers || [];
  const seedByInit = new Map(seedTeachers.map((t) => [t.initial, t]));
  const docByInit = new Map(fromDoc.map((t) => [t.initial, t]));

  const missingInSeed = [...docByInit.keys()].filter((k) => !seedByInit.has(k));
  const extraInSeed = [...seedByInit.keys()].filter((k) => !docByInit.has(k));
  const nameDiffs = [];
  for (const [init, docT] of docByInit) {
    const s = seedByInit.get(init);
    if (!s) continue;
    if (s.name !== docT.name) nameDiffs.push({ initial: init, seed: s.name, doc: docT.name });
  }

  report.faculty = {
    fromDoc: fromDoc.length,
    inSeed: seedTeachers.length,
    inPublic: (pub.teachers || []).length,
    missingInSeed,
    extraInSeedGuestOrOnlyTimetable: extraInSeed,
    nameDiffs: nameDiffs.slice(0, 20),
    nameDiffCount: nameDiffs.length,
  };

  const courseText = (await mammoth.extractRawText({ path: COURSES })).value;
  const { codes: courseDocCodes } = parseCourseList(courseText);
  const seedCourseCodes = new Set((seed.courses || []).map((c) => c.code));
  const tt = parseTimetable(XLSX_PATH);
  const ttCodes = new Set(tt.map((e) => e.course_code));
  const seedTt = seed.timetable || [];
  const seedTtKeys = new Set(seedTt.map(entryKey));
  const freshKeys = new Set(tt.map(entryKey));

  const missingEntries = [...freshKeys].filter((k) => !seedTtKeys.has(k));
  const extraEntries = [...seedTtKeys].filter((k) => !freshKeys.has(k));

  const teachersInTtNotInSeed = [...new Set(tt.map((e) => e.teacher_initial))].filter((i) => !seedByInit.has(i));
  const teachersInTtNotInDoc = [...new Set(tt.map((e) => e.teacher_initial))].filter((i) => !docByInit.has(i));

  report.courses = {
    codesParsedFromCourseDoc: courseDocCodes.size,
    coursesInSeed: seedCourseCodes.size,
    codesInTimetable: ttCodes.size,
    timetableCodesMissingFromSeedCourses: [...ttCodes].filter((c) => !seedCourseCodes.has(c)).slice(0, 30),
  };

  report.timetable = {
    fromXlsxMerged: tt.length,
    inSeed: seedTt.length,
    inPublic: (pub.timetable || []).length,
    missingInSeed: missingEntries.length,
    extraInSeed: extraEntries.length,
    sampleMissing: missingEntries.slice(0, 15),
    sampleExtra: extraEntries.slice(0, 15),
    teachersInTimetableNotInFacultyDoc: teachersInTtNotInDoc,
    teachersInTimetableNotInSeed: teachersInTtNotInSeed,
    seedEqualsPublicTeachers: seedTeachers.length === (pub.teachers || []).length,
    seedEqualsPublicTimetable: seedTt.length === (pub.timetable || []).length,
  };

  // Raw sheet stats
  const wb = XLSX.readFile(XLSX_PATH);
  report.xlsxMeta = {
    sheetNames: wb.SheetNames,
    usedSheet: wb.SheetNames[0],
  };

  const outPath = path.join(ROOT, 'scripts/_audit_source_vs_seed.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log('\nWrote', outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
