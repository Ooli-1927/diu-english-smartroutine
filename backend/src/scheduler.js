export const DEFAULT_DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'];

export const DEFAULT_SLOTS = [
  { start: '09:00', end: '10:15' },
  { start: '10:15', end: '11:30' },
  { start: '11:30', end: '12:45' },
  { start: '13:30', end: '14:45' },
];

const ANY_GROUP = '*';

function slotKey(day, slot) {
  return `${day}|${slot.start}`;
}

/**
 * Two classes of the same batch may share a slot only when they are different
 * lab groups, which is how the existing routine runs parallel sessionals.
 */
function batchIsBusy(occupancy, day, slot, batchId, group) {
  const groups = occupancy.batchGroups.get(`${slotKey(day, slot)}|${batchId}`);
  if (!groups || groups.size === 0) return false;
  if (groups.has(ANY_GROUP)) return true;
  if (!group) return true;
  return groups.has(group);
}

function buildOccupancy(existing) {
  const occupancy = {
    teachers: new Map(),
    rooms: new Map(),
    batchGroups: new Map(),
    batchDay: new Map(),
    teacherDay: new Map(),
    batchCourseDay: new Set(),
    roomUse: new Map(),
  };

  for (const e of existing) {
    const slot = { start: e.start_time, end: e.end_time };
    const key = slotKey(e.day, slot);

    const teacherSet = occupancy.teachers.get(key) || new Set();
    teacherSet.add(e.teacher_initial);
    occupancy.teachers.set(key, teacherSet);

    if (e.room_id) {
      const roomSet = occupancy.rooms.get(key) || new Set();
      roomSet.add(e.room_id);
      occupancy.rooms.set(key, roomSet);
      occupancy.roomUse.set(e.room_id, (occupancy.roomUse.get(e.room_id) || 0) + 1);
    }

    const groupKey = `${key}|${e.batch_id}`;
    const groups = occupancy.batchGroups.get(groupKey) || new Set();
    groups.add(e.group_name || ANY_GROUP);
    occupancy.batchGroups.set(groupKey, groups);

    const bd = `${e.batch_id}|${e.day}`;
    occupancy.batchDay.set(bd, (occupancy.batchDay.get(bd) || 0) + 1);
    const td = `${e.teacher_initial}|${e.day}`;
    occupancy.teacherDay.set(td, (occupancy.teacherDay.get(td) || 0) + 1);
    occupancy.batchCourseDay.add(`${e.batch_id}|${e.course_code}|${e.day}`);
  }

  return occupancy;
}

function place(occupancy, entry) {
  const slot = { start: entry.start_time, end: entry.end_time };
  const key = slotKey(entry.day, slot);

  const teacherSet = occupancy.teachers.get(key) || new Set();
  teacherSet.add(entry.teacher_initial);
  occupancy.teachers.set(key, teacherSet);

  if (entry.room_id) {
    const roomSet = occupancy.rooms.get(key) || new Set();
    roomSet.add(entry.room_id);
    occupancy.rooms.set(key, roomSet);
    occupancy.roomUse.set(entry.room_id, (occupancy.roomUse.get(entry.room_id) || 0) + 1);
  }

  const groupKey = `${key}|${entry.batch_id}`;
  const groups = occupancy.batchGroups.get(groupKey) || new Set();
  groups.add(entry.group_name || ANY_GROUP);
  occupancy.batchGroups.set(groupKey, groups);

  const bd = `${entry.batch_id}|${entry.day}`;
  occupancy.batchDay.set(bd, (occupancy.batchDay.get(bd) || 0) + 1);
  const td = `${entry.teacher_initial}|${entry.day}`;
  occupancy.teacherDay.set(td, (occupancy.teacherDay.get(td) || 0) + 1);
  occupancy.batchCourseDay.add(`${entry.batch_id}|${entry.course_code}|${entry.day}`);
}

function pickRoom(occupancy, day, slot, requirement, rooms) {
  if (requirement.mode === 'Online') return { room: null, ok: true };
  const busy = occupancy.rooms.get(slotKey(day, slot)) || new Set();

  if (requirement.room_id) {
    return busy.has(requirement.room_id)
      ? { room: null, ok: false }
      : { room: requirement.room_id, ok: true };
  }

  const wantsLab = requirement.type === 'Sessional';
  const free = rooms.filter((r) => !busy.has(r.id));
  if (!free.length) return { room: null, ok: false };

  const isLab = (room) => /lab/i.test(room.name);
  const preferred = free.filter((r) => (wantsLab ? isLab(r) : !isLab(r)));
  const pool = preferred.length ? preferred : free;
  const sorted = [...pool].sort(
    (a, b) => (occupancy.roomUse.get(a.id) || 0) - (occupancy.roomUse.get(b.id) || 0),
  );
  return { room: sorted[0].id, ok: true };
}

/**
 * Greedy scheduler: the hardest requirements are placed first and each session
 * takes the emptiest feasible day, which spreads a batch's week evenly.
 * Soft constraints (preferredDays, avoidDays, noBackToBack, preferMorning)
 * score candidates without blocking hard feasibility.
 */
export function generateSchedule({
  requirements,
  existing = [],
  rooms = [],
  days = DEFAULT_DAYS,
  slots = DEFAULT_SLOTS,
  maxPerBatchPerDay = 3,
  maxPerTeacherPerDay = 4,
  soft = {},
}) {
  const occupancy = buildOccupancy(existing);
  const scheduled = [];
  const unscheduled = [];
  const explanations = [];

  const preferredDays = new Set(soft.preferredDays || []);
  const avoidDays = new Set(soft.avoidDays || []);
  const preferMorning = Boolean(soft.preferMorning);
  const noBackToBack = Boolean(soft.noBackToBack);
  const maxConsecutive = Number(soft.maxConsecutive || 2);

  const sessions = [];
  requirements.forEach((req, index) => {
    const count = Math.max(1, Number(req.sessions_per_week) || 1);
    for (let i = 0; i < count; i += 1) {
      sessions.push({ req, index, session: i + 1, of: count });
    }
  });

  const difficulty = (req) =>
    (req.type === 'Sessional' ? 2 : 0) + (req.room_id ? 1 : 0) + (req.mode === 'Online' ? -1 : 0);
  sessions.sort((a, b) => difficulty(b.req) - difficulty(a.req) || a.index - b.index);

  for (const item of sessions) {
    const req = item.req;
    const group = req.group_name || null;
    const reasons = { teacher: 0, batch: 0, room: 0, dayLoad: 0, sameCourse: 0 };

    const candidates = [];
    for (const day of days) {
      for (let s = 0; s < slots.length; s += 1) {
        candidates.push({ day, slot: slots[s], slotIndex: s });
      }
    }

    const softScore = (c) => {
      let score = 0;
      const load = occupancy.batchDay.get(`${req.batch_id}|${c.day}`) || 0;
      const tLoad = occupancy.teacherDay.get(`${req.teacher_initial}|${c.day}`) || 0;
      score += load * 10 + tLoad * 8;
      if (preferredDays.size && preferredDays.has(c.day)) score -= 15;
      if (avoidDays.has(c.day)) score += 40;
      if (preferMorning && c.slotIndex >= 2) score += 12;
      if (preferMorning && c.slotIndex === 0) score -= 8;
      if (noBackToBack) {
        const prev = slots[c.slotIndex - 1];
        const next = slots[c.slotIndex + 1];
        const key = (slot) => slotKey(c.day, slot);
        if (prev && (occupancy.teachers.get(key(prev)) || new Set()).has(req.teacher_initial)) {
          score += 25;
        }
        if (next && (occupancy.teachers.get(key(next)) || new Set()).has(req.teacher_initial)) {
          score += 25;
        }
      }
      if (maxConsecutive > 0 && c.slotIndex > 0) {
        let streak = 0;
        for (let i = c.slotIndex - 1; i >= 0; i -= 1) {
          if ((occupancy.batchDay.get(`${req.batch_id}|${c.day}`) || 0) <= 0) break;
          const sk = slotKey(c.day, slots[i]);
          if (batchIsBusy(occupancy, c.day, slots[i], req.batch_id, group)) streak += 1;
          else break;
          void sk;
        }
        if (streak >= maxConsecutive) score += 30;
      }
      return score;
    };

    candidates.sort((a, b) => {
      const softDiff = softScore(a) - softScore(b);
      if (softDiff !== 0) return softDiff;
      const loadA = occupancy.batchDay.get(`${req.batch_id}|${a.day}`) || 0;
      const loadB = occupancy.batchDay.get(`${req.batch_id}|${b.day}`) || 0;
      if (loadA !== loadB) return loadA - loadB;
      const tA = occupancy.teacherDay.get(`${req.teacher_initial}|${a.day}`) || 0;
      const tB = occupancy.teacherDay.get(`${req.teacher_initial}|${b.day}`) || 0;
      if (tA !== tB) return tA - tB;
      return days.indexOf(a.day) - days.indexOf(b.day) || a.slotIndex - b.slotIndex;
    });

    let placed = null;
    let rejectedSoft = 0;
    for (const candidate of candidates) {
      const { day, slot } = candidate;

      if (occupancy.batchCourseDay.has(`${req.batch_id}|${req.course_code}|${day}`)) {
        reasons.sameCourse += 1;
        continue;
      }
      if ((occupancy.batchDay.get(`${req.batch_id}|${day}`) || 0) >= maxPerBatchPerDay) {
        reasons.dayLoad += 1;
        continue;
      }
      if ((occupancy.teacherDay.get(`${req.teacher_initial}|${day}`) || 0) >= maxPerTeacherPerDay) {
        reasons.dayLoad += 1;
        continue;
      }
      if ((occupancy.teachers.get(slotKey(day, slot)) || new Set()).has(req.teacher_initial)) {
        reasons.teacher += 1;
        continue;
      }
      if (batchIsBusy(occupancy, day, slot, req.batch_id, group)) {
        reasons.batch += 1;
        continue;
      }
      const room = pickRoom(occupancy, day, slot, req, rooms);
      if (!room.ok) {
        reasons.room += 1;
        continue;
      }

      placed = {
        day,
        batch_id: req.batch_id,
        teacher_initial: req.teacher_initial,
        course_code: req.course_code,
        type: req.type || 'Lecture',
        group_name: group,
        room_id: room.room,
        mode: req.mode || 'Onsite',
        start_time: slot.start,
        end_time: slot.end,
        is_cancelled: false,
        cancellation_reason: null,
        _softScore: softScore(candidate),
      };
      break;
    }

    if (placed) {
      const { _softScore, ...entry } = placed;
      place(occupancy, entry);
      scheduled.push(entry);
      explanations.push({
        course_code: entry.course_code,
        teacher_initial: entry.teacher_initial,
        day: entry.day,
        start_time: entry.start_time,
        why: `Placed with soft-score ${_softScore} (lower is better). Hard constraints satisfied.`,
      });
      void rejectedSoft;
    } else {
      const [topReason] = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
      const messages = {
        teacher: `${req.teacher_initial} is already teaching in every free slot`,
        batch: `batch ${req.batch_id} has no free slot left`,
        room: 'no free room in any suitable slot',
        dayLoad: 'daily class limits reached for this batch or teacher',
        sameCourse: 'the course already runs on every available day',
      };
      unscheduled.push({
        batch_id: req.batch_id,
        course_code: req.course_code,
        teacher_initial: req.teacher_initial,
        type: req.type || 'Lecture',
        group_name: group,
        session: `${item.session}/${item.of}`,
        reason: messages[topReason?.[0]] || 'no feasible slot found',
      });
    }
  }

  const perDay = {};
  for (const e of scheduled) perDay[e.day] = (perDay[e.day] || 0) + 1;

  return {
    scheduled,
    unscheduled,
    explanations,
    softApplied: {
      preferredDays: [...preferredDays],
      avoidDays: [...avoidDays],
      preferMorning,
      noBackToBack,
      maxConsecutive,
    },
    stats: {
      requested: sessions.length,
      placed: scheduled.length,
      skipped: unscheduled.length,
      perDay,
    },
  };
}
