import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const target = resolve(process.argv[2] || 'data/seed.json');
const apply = !process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(target, 'utf8'));
const rooms = data.rooms || [];
const timetable = data.timetable || [];

const isLab = (roomId) => /lab/i.test(rooms.find((r) => r.id === roomId)?.name || '');
const slotOf = (e) => `${e.day}|${e.start}`;

function roomOccupancy() {
  const map = new Map();
  for (const e of timetable) {
    if (!e.room_id || e.is_cancelled) continue;
    const key = `${slotOf(e)}|${e.room_id}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function clashes() {
  const groups = new Map();
  for (const e of timetable) {
    if (!e.room_id || e.is_cancelled) continue;
    const key = `${slotOf(e)}|${e.room_id}`;
    const list = groups.get(key) || [];
    list.push(e);
    groups.set(key, list);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 1);
}

/** Keeps students near their original room by preferring the same floor prefix. */
function pickFreeRoom(entry) {
  const occupancy = roomOccupancy();
  const wantsLab = entry.type === 'Sessional';
  const originalFloor = String(entry.room_id).charAt(0);

  const free = rooms.filter(
    (r) => !occupancy.has(`${slotOf(entry)}|${r.id}`) && isLab(r.id) === wantsLab,
  );
  if (!free.length) return null;

  free.sort((a, b) => {
    const floorA = String(a.id).charAt(0) === originalFloor ? 0 : 1;
    const floorB = String(b.id).charAt(0) === originalFloor ? 0 : 1;
    return floorA - floorB || a.id.localeCompare(b.id);
  });
  return free[0].id;
}

const before = clashes();
console.log(`${target}`);
console.log(`room clashes found: ${before.length}`);

const changes = [];
for (const [key, list] of before) {
  const [, ...toMove] = list; // the first booking keeps the room
  for (const entry of toMove) {
    const replacement = pickFreeRoom(entry);
    if (!replacement) {
      console.log(`  ! no free room for ${key} (${entry.batch_id} ${entry.course_code})`);
      continue;
    }
    changes.push({
      day: entry.day,
      time: `${entry.start}-${entry.end}`,
      batch: entry.batch_id,
      course: entry.course_code,
      teacher: entry.teacher_initial,
      from: entry.room_id,
      to: replacement,
    });
    entry.room_id = replacement;
  }
}

for (const c of changes) {
  console.log(
    `  ${c.day} ${c.time}  ${c.batch} ${c.course} (${c.teacher})  room ${c.from} -> ${c.to}`,
  );
}

const after = clashes();
console.log(`room clashes remaining: ${after.length}`);

/** Reported, never auto-fixed: these need a human decision about who moves. */
function otherClashes(pick) {
  const groups = new Map();
  for (const e of timetable) {
    if (e.is_cancelled) continue;
    const value = pick(e);
    if (!value) continue;
    const key = `${slotOf(e)}|${value}`;
    const list = groups.get(key) || [];
    list.push(e);
    groups.set(key, list);
  }
  return [...groups.entries()].filter(([, list]) => list.length > 1);
}

const teacherClashes = otherClashes((e) => e.teacher_initial);
// Parallel groups (G1/G2) of one batch are intentional, so they are not a batch clash.
const batchClashes = otherClashes((e) => `${e.batch_id}|${e.group || 'all'}`);
console.log(`teacher clashes: ${teacherClashes.length}`);
teacherClashes.forEach(([key, list]) =>
  console.log(`  ${key} -> ${list.map((e) => `${e.batch_id}:${e.course_code}`).join(', ')}`),
);
console.log(`batch clashes: ${batchClashes.length}`);
batchClashes.forEach(([key, list]) =>
  console.log(`  ${key} -> ${list.map((e) => `${e.course_code}@${e.room_id}`).join(', ')}`),
);

if (apply && changes.length) {
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`updated ${changes.length} entries in ${target}`);
} else if (!apply) {
  console.log('dry run — nothing written');
}
