/**
 * One source of truth for "these two classes cannot happen together".
 * Used both to audit the whole routine and to guard single edits.
 */

const overlaps = (a, b) =>
  a.day === b.day && a.start_time < b.end_time && a.end_time > b.start_time;

const active = (e) => !e.is_cancelled;

function sectionOf(e) {
  return e.section || e.group_name || null;
}

/** Different sections of the same batch may run in parallel. */
function sameAudience(a, b) {
  if (a.batch_id !== b.batch_id) return false;
  const sa = sectionOf(a);
  const sb = sectionOf(b);
  if (sa && sb) return sa === sb;
  return true;
}

function pairKind(a, b) {
  if (a.room_id && b.room_id && a.room_id === b.room_id) return 'room';
  if (a.teacher_initial === b.teacher_initial) return 'teacher';
  if (sameAudience(a, b)) return 'batch';
  return null;
}

const describe = (e) => {
  const sec = sectionOf(e);
  return `${e.batch_id}${sec || ''} ${e.course_code}`.trim();
};

function reason(kind, a, b) {
  if (kind === 'room') return `Room ${a.room_id} is booked twice: ${describe(a)} and ${describe(b)}`;
  if (kind === 'teacher') return `${a.teacher_initial} is in two classes at once: ${describe(a)} and ${describe(b)}`;
  const sec = sectionOf(a);
  return `${a.batch_id}${sec || ''} has two classes at once: ${a.course_code} and ${b.course_code}`;
}

/** Every clashing pair a candidate entry would create against `others`. */
export function conflictsWith(candidate, others) {
  const found = [];
  if (!active(candidate)) return found;

  for (const other of others) {
    if (other.id && other.id === candidate.id) continue;
    if (!active(other) || !overlaps(candidate, other)) continue;
    const kind = pairKind(candidate, other);
    if (!kind) continue;
    found.push({
      kind,
      day: candidate.day,
      start_time: candidate.start_time,
      end_time: candidate.end_time,
      resource: kind === 'room' ? candidate.room_id : kind === 'teacher' ? candidate.teacher_initial : candidate.batch_id,
      message: reason(kind, candidate, other),
      with: other,
    });
  }
  return found;
}

/** Audit of the full routine, one item per clashing pair. */
export function findConflicts(entries) {
  const list = entries.filter(active);
  const conflicts = [];

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!overlaps(a, b)) continue;
      const kind = pairKind(a, b);
      if (!kind) continue;
      conflicts.push({
        kind,
        day: a.day,
        start_time: a.start_time < b.start_time ? a.start_time : b.start_time,
        end_time: a.end_time > b.end_time ? a.end_time : b.end_time,
        resource: kind === 'room' ? a.room_id : kind === 'teacher' ? a.teacher_initial : a.batch_id,
        message: reason(kind, a, b),
        entries: [a, b],
      });
    }
  }

  const order = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  conflicts.sort(
    (a, b) => order.indexOf(a.day) - order.indexOf(b.day) || a.start_time.localeCompare(b.start_time),
  );
  return conflicts;
}

export function summarize(conflicts) {
  return {
    total: conflicts.length,
    room: conflicts.filter((c) => c.kind === 'room').length,
    teacher: conflicts.filter((c) => c.kind === 'teacher').length,
    batch: conflicts.filter((c) => c.kind === 'batch').length,
  };
}
