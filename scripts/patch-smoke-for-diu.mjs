import fs from 'fs';

/** One-time DIU data patches for smoke scripts (counts / teacher initials). No passwords. */
const patches = [
  [
    'backend/scripts/smoke.js',
    [
      [/boot\.data\.teachers\.length === 17/, 'boot.data.teachers.length >= 40'],
      [/boot\.data\.timetable\.length === 76/, 'boot.data.timetable.length >= 200'],
      [/analytics\.data\.totals\.classes === 76/, 'analytics.data.totals.classes >= 200'],
      [/teacher_initial=AR/g, 'teacher_initial=LS'],
      [/teacherInitial === 'AR'/, "teacherInitial === 'LS'"],
      [/teacher_initial=FI/g, 'teacher_initial=EHE'],
      [/teacher_initial: 'AR'/g, "teacher_initial: 'LS'"],
    ],
  ],
  [
    'backend/scripts/smoke-social.js',
    [
      [/teacher_initial: 'AR'/g, "teacher_initial: 'LS'"],
    ],
  ],
  [
    'backend/scripts/smoke-generate.js',
    [
      [/batch_ids=7th/g, 'batch_ids=66'],
      [/batch_id === '7th'/g, "batch_id === '66'"],
      [/batch_id !== '7th'/g, "batch_id !== '66'"],
      [/teacher_initial: i % 2 === 0 \? 'AR' : 'FI'/, "teacher_initial: i % 2 === 0 ? 'LS' : 'EHE'"],
      [/teacher_initial: 'AR'/g, "teacher_initial: 'LS'"],
    ],
  ],
  [
    'backend/scripts/smoke-conflicts.js',
    [
      [/teacher_initial === 'AR'/g, "teacher_initial === 'LS'"],
    ],
  ],
];

for (const [file, reps] of patches) {
  let c = fs.readFileSync(file, 'utf8');
  const orig = c;
  for (const [re, to] of reps) c = c.replace(re, to);
  if (c !== orig) {
    fs.writeFileSync(file, c);
    console.log('patched', file);
  } else {
    console.log('nochange', file);
  }
}
