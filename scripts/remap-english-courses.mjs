import fs from 'fs';

const seedPath = 'smartroutine-api/data/seed.json';
const publicPath = 'smartroutine-web/public/data/data.json';
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const englishCatalog = [
  ['ENG 101', 'Introduction to English Literature'],
  ['ENG 102', 'Academic Writing Skills'],
  ['ENG 103', 'Foundation English'],
  ['ENG 104', 'Spoken English Lab'],
  ['ENG 201', 'British Literature: Romantic to Victorian'],
  ['ENG 202', 'American Literature'],
  ['ENG 203', 'Introduction to Linguistics'],
  ['ENG 204', 'Phonetics and Phonology Lab'],
  ['ENG 205', 'Elizabethan and Jacobean Drama'],
  ['ENG 206', 'Prose and Fiction'],
  ['ENG 301', 'Shakespeare Studies'],
  ['ENG 302', 'Literary Theory and Criticism'],
  ['ENG 303', 'English Language Teaching (ELT)'],
  ['ENG 304', 'ELT Practice Lab'],
  ['ENG 305', 'Modern Poetry'],
  ['ENG 306', 'World Literature in Translation'],
  ['ENG 307', 'Sociolinguistics'],
  ['ENG 308', 'Advanced Composition'],
  ['ENG 401', 'Postcolonial Literature'],
  ['ENG 402', 'Research Methodology in English'],
  ['ENG 403', 'Research Methodology Lab'],
  ['ENG 404', 'Creative Writing'],
  ['ENG 405', 'Creative Writing Workshop'],
  ['ENG 406', 'Contemporary Fiction'],
  ['ENG 407', 'Professional Communication'],
  ['ENG 408', 'Professional Communication Lab'],
  ['ENG 409', 'Cultural Studies'],
  ['ENG 410', 'Media and Discourse Analysis'],
  ['ENG 411', 'Translation Studies'],
  ['ENG 412', 'Translation Practice Lab'],
  ['ENG 481', 'Seminar on Literature'],
  ['ENG 482', 'Seminar Presentation Lab'],
  ['ENG 483', 'Capstone Project I'],
  ['ENG 484', 'Capstone Project II'],
  ['ENG 111', 'Reading Skills'],
  ['ENG 112', 'Reading Skills Lab'],
  ['ENG 217', 'History of English Language'],
];

const oldCodes = seed.courses.map((c) => c.code);
while (englishCatalog.length < oldCodes.length) {
  const i = englishCatalog.length + 1;
  englishCatalog.push([`ENG ${500 + i}`, `English Special Topic ${i}`]);
}

const codeMap = {};
oldCodes.forEach((old, i) => {
  codeMap[old] = englishCatalog[i][0];
});

seed.courses = oldCodes.map((_old, i) => ({
  code: englishCatalog[i][0],
  title: englishCatalog[i][1],
}));

for (const key of Object.keys(seed)) {
  if (Array.isArray(seed[key])) {
    for (const row of seed[key]) {
      if (row && typeof row === 'object' && row.course_code && codeMap[row.course_code]) {
        row.course_code = codeMap[row.course_code];
      }
    }
  }
}

seed.meta.department = 'Department of English';
seed.meta.university = 'Daffodil International University';
seed.meta.updated_at = new Date().toISOString();

fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2) + '\n');
console.log('seed courses', seed.courses.length);

if (fs.existsSync(publicPath)) {
  const pub = JSON.parse(fs.readFileSync(publicPath, 'utf8'));
  const pubOld = (pub.courses || []).map((c) => c.code);
  const pubMap = {};
  pubOld.forEach((old, i) => {
    if (seed.courses[i]) pubMap[old] = seed.courses[i].code;
  });
  pub.courses = seed.courses.map((c) => ({ ...c }));
  for (const key of Object.keys(pub)) {
    if (Array.isArray(pub[key])) {
      for (const row of pub[key]) {
        if (row?.course_code && pubMap[row.course_code]) {
          row.course_code = pubMap[row.course_code];
        }
      }
    }
  }
  if (pub.meta) {
    pub.meta.department = 'Department of English';
    pub.meta.university = 'Daffodil International University';
  }
  fs.writeFileSync(publicPath, JSON.stringify(pub, null, 2) + '\n');
  console.log('public data updated');
}

console.log('sample', seed.courses.slice(0, 4));
const tt = seed.timetable || seed.timetable_entries || [];
console.log('tt codes', tt.slice(0, 5).map((e) => e.course_code));
