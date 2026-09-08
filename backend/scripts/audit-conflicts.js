import { all } from '../src/db.js';

const rooms = all(
  `SELECT day, start_time, room_id, COUNT(*) AS n,
          GROUP_CONCAT(batch_id || ':' || course_code || ':' || COALESCE(group_name, '-')) AS info
   FROM timetable_entries
   WHERE room_id IS NOT NULL AND is_cancelled = 0
   GROUP BY day, start_time, room_id
   HAVING n > 1
   ORDER BY day, start_time`,
);

const teachers = all(
  `SELECT day, start_time, teacher_initial, COUNT(*) AS n,
          GROUP_CONCAT(batch_id || ':' || course_code) AS info
   FROM timetable_entries
   WHERE is_cancelled = 0
   GROUP BY day, start_time, teacher_initial
   HAVING n > 1
   ORDER BY day, start_time`,
);

console.log(`room clashes: ${rooms.length}`);
rooms.slice(0, 10).forEach((r) => console.log(`  ${r.day} ${r.start_time} room ${r.room_id} x${r.n} -> ${r.info}`));

console.log(`teacher clashes: ${teachers.length}`);
teachers
  .slice(0, 10)
  .forEach((r) => console.log(`  ${r.day} ${r.start_time} ${r.teacher_initial} x${r.n} -> ${r.info}`));
