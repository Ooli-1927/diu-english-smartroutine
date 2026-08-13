/**
 * Build seed.json from DIU English source files:
 * - Faculty List.docx
 * - COURSE LIST.docx
 * - Summer 2026 ( V- 0.4).xlsx
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import mammoth from 'mammoth';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWNLOADS = 'a:/Downloads';
const OUT = path.join(ROOT, 'smartroutine-api/data/seed.json');
const PUBLIC_OUT = path.join(ROOT, 'smartroutine-web/public/data/data.json');

const DAY_MAP = {
  saturday: 'Sat',
  sunday: 'Sun',
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
};

const SLOTS = [
  { start: '08:30', end: '10:00' },
  { start: '10:00', end: '11:30' },
  { start: '11:30', end: '13:00' },
  { start: '13:00', end: '14:30' },
  { start: '14:30', end: '16:00' },
  { start: '16:00', end: '17:30' },
];

const COURSE_TITLES = {
  'ENG 0232-01': 'Basic English Grammar',
  'ENG 0232-02': 'Linguistic and Literary Terminology',
  'GED 0611-05': 'Computer Fundamentals',
  'ENG 0232-03': 'Listening and Speaking Skills',
  'ENG 0232-04': 'Introduction to Poetry',
  'ENG 0232-06': 'Reading and Writing Skills',
  'GED 0031-07': 'Presentation Skill Development',
  'GED 0031-08': 'Art of Living',
  'ENG 0232-09': 'Introduction to Fiction and Non-Fiction',
  'GED 0222-10': 'History of the Emergence of Bangladesh',
  'ENG 0232-11': 'Introduction to Drama',
  'ENG 0232-12': 'Old and Middle English Literature',
  'ENG 0232-13': 'Introduction to Linguistics',
  'GED 0232-14': 'Bangla Language and Literature',
  'GED 0222-15': 'Bangladesh Studies',
  'ENG 0232-16': 'Introduction to Phonetics and Phonology',
  'ENG 0232-17': 'Romantic Poetry',
  'ENG 0232-18': 'Classics in Translation',
  'ENG 0232-19': 'Elizabethan and Jacobean Literature',
  'ENG 0232-21': 'Introduction to American Literature',
  'ENG 0232-22': '17th and 18th Century English Literature',
  'ENG 0232-23': 'Introduction to Morphosyntax / Literature in Film and Media',
  'ENG 0232-24': 'Translation Studies',
  'ENG 0232-25': 'Nineteenth Century Novel and Drama / Translation Studies',
  'ENG 0231-29': 'Introduction to Psycholinguistics',
  'GED 0231-30': 'Introduction to Journalism',
  'ENG 0232-31': 'Shakespeare: Comedy and Tragedy',
  'ENG 0232-32': 'Twentieth Century Novel and Drama',
  'ENG 0232-33': 'Twentieth Century Poetry',
  'ENG 0231-34': 'Introduction to ELT',
  'ENG 0232-26': 'Special / Retake Course',
  'ENG 314': 'ENG 314 (Retake)',
  'ENG 221': 'ENG 221 (Retake)',
  'ENG 332': 'ENG 332 (Retake)',
  'ENG (223+ ENG 0231-14)': 'Combined Retake (ENG 223 + ENG 0231-14)',
};

function cleanPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, ' ').trim().split(/\s+/)[0];
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('880')) return `+${digits}`;
  if (digits.startsWith('0')) return `+88${digits}`;
  return `+880${digits}`;
}

function cleanEmail(raw) {
  if (!raw) return null;
  const matches = String(raw).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!matches?.length) return null;
  // Prefer diu.edu.bd / daffodilvarsity
  const pref =
    matches.find((e) => /diu\.edu\.bd|daffodilvarsity/i.test(e)) || matches[0];
  return pref.toLowerCase();
}

function isSerial(line) {
  return /^\d{1,2}$/.test(line);
}

function parseFacultyText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const skip = new Set(['SL', 'Name', 'ID', 'Designation', 'Email', 'Cell']);
  const teachers = [];
  let i = 0;
  while (i < lines.length) {
    if (!isSerial(lines[i])) {
      i += 1;
      continue;
    }
    const sl = lines[i++];
    const name = lines[i++] || '';
    let initial = '';
    let empId = '';
    let designation = 'Faculty';
    let email = null;
    let phone = null;

    const block = [];
    while (i < lines.length && !isSerial(lines[i])) {
      block.push(lines[i++]);
    }

    for (const tok of block) {
      if (skip.has(tok)) continue;
      if (/^[A-Z]{2,5}$/.test(tok) && !initial) {
        initial = tok;
        continue;
      }
      if (/^\d{6,}$/.test(tok) && !empId) {
        empId = tok;
        continue;
      }
      if (/@/.test(tok) && !email) {
        email = cleanEmail(tok);
        continue;
      }
      if (/\d{8,}/.test(tok.replace(/[-\s]/g, '')) && !phone) {
        phone = cleanPhone(tok);
        continue;
      }
      if (
        /Professor|Lecturer|Assistant|Associate|Dean|Head|Faculty|Contractual|Part Time|Needed|JMC/i.test(
          tok,
        )
      ) {
        if (!/^needed$/i.test(tok)) designation = tok;
      }
    }

    if (!name || name.length < 3) continue;
    if (/Professor|Lecturer|Assistant|Associate|Dean|Head|Faculty|@/i.test(name) && !/^(Dr\.|Mr\.|Ms\.|Professor A|Professor Dr)/i.test(name)) {
      // Skip rows where designation/email was mistaken for a name
      continue;
    }
    if (!initial || /^needed$/i.test(initial)) {
      initial = name
        .replace(/^(Dr\.|Mr\.|Ms\.|Professor|Prof\.)\s*/i, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join('')
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 4)
        .toUpperCase();
      if (!initial) continue;
    }

    teachers.push({
      id: empId || `T${String(sl).padStart(3, '0')}`,
      name: name.replace(/\s+/g, ' ').trim(),
      initial,
      designation: designation || 'Faculty',
      phone,
      email: email || `${initial.toLowerCase()}.eng@diu.demo`,
      home_department: 'English',
      profile_pic: null,
    });
  }

  const seen = new Set();
  return teachers.filter((t) => {
    if (seen.has(t.initial)) return false;
    seen.add(t.initial);
    return true;
  });
}

function normalizeCourseCode(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Fix truncated section paren: ENG 0232-24(61A
  if (/\(\d{2}[A-G]$/i.test(s)) s += ')';
  return s;
}

function parseOffering(raw) {
  const s = normalizeCourseCode(raw);
  if (!s) return null;

  let m = s.match(/^(.+?)\((\d{2})([A-G])\)$/i);
  if (m) {
    return {
      course_code: m[1].trim(),
      batch_id: m[2],
      group: m[3].toUpperCase(),
      retake: false,
    };
  }

  m = s.match(/^(.+?)\((RETAKE|Retake)\)$/i);
  if (m) {
    return {
      course_code: m[1].trim(),
      batch_id: 'RETAKE',
      group: null,
      retake: true,
    };
  }

  if (/retake/i.test(s) || /\+/.test(s)) {
    return {
      course_code: s,
      batch_id: 'RETAKE',
      group: null,
      retake: true,
    };
  }

  return {
    course_code: s,
    batch_id: 'MISC',
    group: null,
    retake: false,
  };
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
    if (dayCell && DAY_MAP[dayCell.toLowerCase()]) {
      currentDay = DAY_MAP[dayCell.toLowerCase()];
    }
    if (!currentDay) continue;

    const room = String(row[1] ?? '').trim();
    if (!room) continue;

    for (let s = 0; s < 6; s += 1) {
      const codeCol = 2 + s * 2;
      const intCol = 3 + s * 2;
      const code = normalizeCourseCode(row[codeCol]);
      const teacher = String(row[intCol] || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      if (!code || !teacher) continue;

      const offering = parseOffering(code);
      if (!offering) continue;

      rawSlots.push({
        day: currentDay,
        room_id: room,
        teacher_initial: teacher,
        course_code: offering.course_code,
        batch_id: offering.batch_id,
        group: offering.group,
        slotIndex: s,
        start: SLOTS[s].start,
        end: SLOTS[s].end,
      });
    }
  }

  // Merge consecutive identical offerings in same room
  rawSlots.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      a.room_id.localeCompare(b.room_id) ||
      a.slotIndex - b.slotIndex ||
      a.course_code.localeCompare(b.course_code),
  );

  const merged = [];
  for (const slot of rawSlots) {
    const prev = merged[merged.length - 1];
    const same =
      prev &&
      prev.day === slot.day &&
      prev.room_id === slot.room_id &&
      prev.teacher_initial === slot.teacher_initial &&
      prev.course_code === slot.course_code &&
      prev.batch_id === slot.batch_id &&
      prev.group === slot.group &&
      prev.slotIndex + 1 === slot.slotIndex &&
      prev.end === slot.start;

    if (same) {
      prev.end = slot.end;
      prev.slotIndex = slot.slotIndex;
    } else {
      merged.push({ ...slot });
    }
  }

  return merged.map(({ slotIndex, ...e }) => ({
    day: e.day,
    batch_id: e.batch_id,
    teacher_initial: e.teacher_initial,
    course_code: e.course_code,
    type: /lab/i.test(COURSE_TITLES[e.course_code] || '') ? 'Sessional' : 'Lecture',
    group: e.group,
    room_id: e.room_id,
    mode: 'Onsite',
    start: e.start,
    end: e.end,
    is_cancelled: false,
  }));
}

function ensureTeacher(teachers, initial, hintName) {
  if (teachers.some((t) => t.initial === initial)) return;
  teachers.push({
    id: `TG-${initial}`,
    name: hintName || `Guest Faculty (${initial})`,
    initial,
    designation: 'Guest / Part-time Faculty',
    phone: null,
    email: `${initial.toLowerCase()}.eng@diu.demo`,
    home_department: 'English',
    profile_pic: null,
  });
}

async function main() {
  const facultyDoc = path.join(DOWNLOADS, 'Faculty List.docx');
  const courseDoc = path.join(DOWNLOADS, 'COURSE LIST.docx');
  const xlsxPath = path.join(DOWNLOADS, 'Summer 2026 ( V- 0.4).xlsx');

  const facultyText = (await mammoth.extractRawText({ path: facultyDoc })).value;
  const courseText = (await mammoth.extractRawText({ path: courseDoc })).value;
  fs.writeFileSync(path.join(ROOT, 'scripts/_preview_faculty.txt'), facultyText);
  fs.writeFileSync(path.join(ROOT, 'scripts/_preview_courses.txt'), courseText);

  let teachers = parseFacultyText(facultyText);

  // Manual fixes for known faculty parsing issues
  const force = {
    BB: { designation: 'Professor', email: 'drbinoy@daffodilvarsity.edu.bd' },
    LS: { email: 'liza.eng@diu.edu.bd' },
    EHE: { email: 'headenglish@daffodilvarsity.edu.bd', designation: 'Assistant Professor and Head' },
    MBU: { email: 'burhan.eng@diu.demo', name: 'Md. Burhan Uddin' },
    UF: { designation: 'Part-time Faculty (JMC)', name: 'Umme Faria' },
  };
  teachers = teachers.map((t) => ({ ...t, ...(force[t.initial] || {}) }));

  const timetable = parseTimetable(xlsxPath);

  // Collect rooms, batches, courses, missing teachers from timetable
  const roomIds = [...new Set(timetable.map((e) => e.room_id))].sort();
  const batchIds = [...new Set(timetable.map((e) => e.batch_id))].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
    return String(a).localeCompare(String(b));
  });
  const courseCodes = [...new Set(timetable.map((e) => e.course_code))];

  for (const initial of [...new Set(timetable.map((e) => e.teacher_initial))]) {
    ensureTeacher(teachers, initial);
  }

  // Known aliases appearing in sheet
  ensureTeacher(teachers, 'MS', 'Guest Faculty (MS)');
  ensureTeacher(teachers, 'ST', 'Guest Faculty (ST)');

  const batches = batchIds.map((id) => {
    if (id === 'RETAKE') return { id, name: 'Retake / Special', session: 'Summer 2026' };
    if (id === 'MISC') return { id, name: 'Miscellaneous', session: 'Summer 2026' };
    return { id, name: `${id}th Batch`, session: 'Summer 2026' };
  });

  const courses = courseCodes
    .map((code) => ({
      code,
      title: COURSE_TITLES[code] || code,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  // Also add any course-list-only courses not in timetable
  for (const [code, title] of Object.entries(COURSE_TITLES)) {
    if (!courses.some((c) => c.code === code)) courses.push({ code, title });
  }

  const rooms = roomIds.map((id) => ({ id: String(id), name: String(id) }));

  // Demo students: 5 per numeric batch, plus explicit student01 on first batch.
  // Passwords are intentionally omitted — seed.js generates them at seed time.
  const students = [];
  const numericBatches = batches.filter((b) => /^\d+$/.test(b.id));
  numericBatches.forEach((batch, bi) => {
    for (let n = 1; n <= 5; n += 1) {
      const idx = bi * 5 + n;
      students.push({
        id: `S${String(idx).padStart(3, '0')}`,
        student_id: `241-${batch.id}-${String(n).padStart(2, '0')}`,
        name: `Demo Student ${batch.id}-${n}`,
        batch_id: batch.id,
        email: bi === 0 && n === 1 ? 'student01@diu.demo' : `student${batch.id}${n}@diu.demo`,
        phone: null,
      });
    }
  });

  const admins = [
    { username: 'chairman', type: 'super_admin' },
    { username: 'superadmin@diu.demo', type: 'super_admin' },
    { username: 'headenglish', type: 'super_admin' },
  ];

  // Teacher-admins for faculty with initials (passwords generated at seed time)
  for (const t of teachers) {
    admins.push({
      username: t.initial,
      type: 'teacher_admin',
      teacher_initial: t.initial,
    });
  }

  const seed = {
    meta: {
      version: '3.0.0-diu-summer-2026',
      updated_at: new Date().toISOString(),
      tz: 'Asia/Dhaka',
      days_off: ['Fri'],
      department: 'Department of English',
      university: 'Daffodil International University',
      program: 'B.A. (Hons) in English',
      campus: 'Daffodil Smart City',
      term: 'Summer 2026',
      slot_labels: SLOTS.map((s) => `${s.start}-${s.end}`),
      source_files: [
        'Faculty List.docx',
        'COURSE LIST.docx',
        'Summer 2026 ( V- 0.4).xlsx',
      ],
    },
    teachers,
    batches,
    courses,
    rooms,
    students,
    timetable,
    admins,
  };

  fs.writeFileSync(OUT, JSON.stringify(seed, null, 2) + '\n');

  // Offline public mirror (no admin passwords)
  const pub = {
    meta: seed.meta,
    teachers: teachers.map(({ password, password_hash, ...t }) => t),
    batches,
    courses,
    rooms,
    students: students.map(({ password, ...s }) => s),
    timetable,
  };
  fs.writeFileSync(PUBLIC_OUT, JSON.stringify(pub, null, 2) + '\n');

  console.log(
    JSON.stringify(
      {
        teachers: teachers.length,
        batches: batches.length,
        courses: courses.length,
        rooms: rooms.length,
        students: students.length,
        timetable: timetable.length,
        admins: admins.length,
        sampleTeachers: teachers.slice(0, 5).map((t) => `${t.initial}:${t.name}`),
        sampleEntries: timetable.slice(0, 3),
        missingTitles: courseCodes.filter((c) => !COURSE_TITLES[c]),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
