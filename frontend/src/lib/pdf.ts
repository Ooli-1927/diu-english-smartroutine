import type { ClassMode, ClassType, DayCode, TimetableEntry } from './types';
import type { StoreState } from './store';
import { formatTime, DAYS } from './constants';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const ROUTINE_JSON_START = '###SMARTROUTINE_JSON_START###';
export const ROUTINE_JSON_END = '###SMARTROUTINE_JSON_END###';

const DAY_FULL: Record<DayCode, string> = {
  Sat: 'Saturday',
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
};

/** Official DIU print palette */
const C = {
  navy: [10, 37, 64] as [number, number, number],
  navyDeep: [6, 28, 48] as [number, number, number],
  blue: [0, 112, 176] as [number, number, number],
  green: [57, 181, 74] as [number, number, number],
  ink: [24, 32, 40] as [number, number, number],
  muted: [88, 102, 116] as [number, number, number],
  line: [198, 210, 222] as [number, number, number],
  headSoft: [236, 242, 248] as [number, number, number],
  rowAlt: [248, 251, 253] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  band: [242, 247, 251] as [number, number, number],
};

export type RoutinePdfRow = {
  day: DayCode;
  batch_id: string;
  batch_name?: string;
  teacher_initial: string;
  teacher_name?: string;
  course_code: string;
  course_title?: string;
  type: ClassType;
  mode: ClassMode;
  start_time: string;
  end_time: string;
  room_id: string | null;
  room_name?: string | null;
  section: string | null;
  group_name: string | null;
  is_cancelled: boolean;
  cancellation_reason: string | null;
};

export function toPdfRows(store: StoreState, entries: TimetableEntry[]): RoutinePdfRow[] {
  return entries.map((e) => {
    const course = store.courses.find((c) => c.code === e.course_code);
    const batch = store.batches.find((b) => b.id === e.batch_id);
    const room = store.rooms.find((r) => r.id === e.room_id || r.name === e.room_id);
    const teacher = store.teachers.find((t) => t.initial === e.teacher_initial);
    return {
      day: e.day,
      batch_id: e.batch_id,
      batch_name: batch?.name,
      teacher_initial: e.teacher_initial,
      teacher_name: teacher?.name,
      course_code: e.course_code,
      course_title: course?.title,
      type: e.type,
      mode: e.mode,
      start_time: formatTime(e.start_time),
      end_time: formatTime(e.end_time),
      room_id: e.room_id,
      room_name: e.mode === 'Online' ? 'Online' : room?.name || e.room_id,
      section: e.section || null,
      group_name: e.group_name,
      is_cancelled: e.is_cancelled,
      cancellation_reason: e.cancellation_reason,
    };
  });
}

function toAmPm(t: string): string {
  const [hs, ms] = formatTime(t).split(':').map(Number);
  if (Number.isNaN(hs)) return t;
  const ap = hs >= 12 ? 'PM' : 'AM';
  const h12 = hs % 12 || 12;
  return `${h12}:${String(ms || 0).padStart(2, '0')} ${ap}`;
}

function timeRange(start: string, end: string): string {
  return `${toAmPm(start)} – ${toAmPm(end)}`;
}

function sessionLabel(session: string): string {
  const m = session.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-20${m[2]}`;
  return session;
}

function roomLabel(row: RoutinePdfRow): string {
  if (row.mode === 'Online') return 'Online';
  const raw = row.room_name || row.room_id || '—';
  const digits = String(raw).match(/\d{3,4}[A-Za-z]?/);
  return digits ? digits[0] : String(raw).replace(/\s*\([^)]*\)\s*/g, '').trim() || '—';
}

function sectionLabel(row: RoutinePdfRow): string {
  return (row.section || row.group_name || '—').toString().toUpperCase();
}

function classKind(row: RoutinePdfRow): string {
  if (row.mode === 'Online') return 'Online';
  if (row.type === 'Sessional') return 'Lab';
  if (row.type === 'Tutorial') return 'Tutorial';
  return 'Lecture';
}

function teacherLabel(row: RoutinePdfRow): string {
  if (row.teacher_name) return `${row.teacher_initial} — ${row.teacher_name}`;
  return row.teacher_initial || '—';
}

function sortedBatches(store: StoreState) {
  return [...store.batches].sort((a, b) => {
    const ay = Number((a.session.match(/\d{4}/) || ['0'])[0]);
    const by = Number((b.session.match(/\d{4}/) || ['0'])[0]);
    if (ay !== by) return by - ay;
    return a.name.localeCompare(b.name);
  });
}

function uniqueSessions(store: StoreState): string {
  const parts = sortedBatches(store)
    .filter((b) => b.session && b.session !== 'MSC')
    .map((b) => sessionLabel(b.session));
  return [...new Set(parts)].join(' · ');
}

function lastTableY(doc: jsPDF, fallback: number) {
  return (
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || fallback
  );
}

function sortRows(rows: RoutinePdfRow[]): RoutinePdfRow[] {
  return [...rows].sort((a, b) => {
    const d = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
    if (d) return d;
    const t = a.start_time.localeCompare(b.start_time);
    if (t) return t;
    const bcmp = (a.batch_name || a.batch_id).localeCompare(b.batch_name || b.batch_id);
    if (bcmp) return bcmp;
    return sectionLabel(a).localeCompare(sectionLabel(b));
  });
}

async function loadImageDataUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function drawHeader(
  doc: jsPDF,
  logos: { uni: string | null; eng: string | null },
  opts: {
    documentTitle: string;
    sessionLine?: string;
    generated: string;
    compact?: boolean;
  },
) {
  const pageW = doc.internal.pageSize.getWidth();
  const headerH = opts.compact ? 26 : 36;

  doc.setFillColor(...C.navyDeep);
  doc.rect(0, 0, pageW, headerH, 'F');
  doc.setFillColor(...C.green);
  doc.rect(0, headerH, pageW, 1.6, 'F');
  doc.setFillColor(...C.blue);
  doc.rect(0, headerH + 1.6, pageW, 0.7, 'F');

  const logoY = opts.compact ? 4 : 6;
  const logoSize = opts.compact ? 16 : 22;
  if (logos.uni) {
    try {
      doc.addImage(logos.uni, 'PNG', 10, logoY, logoSize, logoSize);
    } catch {
      /* ignore */
    }
  }
  if (logos.eng) {
    try {
      doc.addImage(logos.eng, 'PNG', pageW - 10 - logoSize, logoY, logoSize, logoSize);
    } catch {
      /* ignore */
    }
  }

  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(opts.compact ? 11 : 13);
  doc.text('DAFFODIL INTERNATIONAL UNIVERSITY', pageW / 2, opts.compact ? 9 : 11, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(opts.compact ? 7.5 : 8.5);
  doc.setTextColor(200, 218, 235);
  doc.text(
    'Faculty of Humanities & Social Sciences  ·  Department of English',
    pageW / 2,
    opts.compact ? 14.5 : 17.5,
    { align: 'center' },
  );

  if (!opts.compact) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...C.white);
    doc.text(opts.documentTitle, pageW / 2, 27, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(180, 205, 225);
    const sub = [opts.sessionLine, `Generated ${opts.generated}`].filter(Boolean).join('   ·   ');
    doc.text(sub, pageW / 2, 32.5, { align: 'center' });
    return headerH + 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...C.white);
  doc.text(opts.documentTitle, pageW / 2, 21.5, { align: 'center' });
  return headerH + 6;
}

function drawFooter(doc: jsPDF, page: number, total: number, generated: string, note?: string) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFillColor(...C.navyDeep);
  doc.rect(0, pageH - 10, pageW, 10, 'F');
  doc.setTextColor(190, 210, 228);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(note || 'Department of English · DIU SmartRoutine', 12, pageH - 4);
  doc.text(`Page ${page} of ${total}`, pageW / 2, pageH - 4, { align: 'center' });
  doc.text(generated, pageW - 12, pageH - 4, { align: 'right' });
}

function tableTheme() {
  return {
    theme: 'grid' as const,
    styles: {
      font: 'helvetica',
      fontSize: 7.4,
      cellPadding: { top: 2.4, right: 2, bottom: 2.4, left: 2 },
      valign: 'middle' as const,
      overflow: 'linebreak' as const,
      lineColor: C.line,
      lineWidth: 0.2,
      textColor: C.ink,
      minCellHeight: 9,
    },
    headStyles: {
      fillColor: C.navy,
      textColor: C.white,
      fontStyle: 'bold' as const,
      fontSize: 7.6,
      halign: 'center' as const,
      valign: 'middle' as const,
      cellPadding: 2.6,
    },
    alternateRowStyles: {
      fillColor: C.rowAlt,
    },
    margin: { left: 10, right: 10, bottom: 14, top: 10 },
  };
}

function rowCells(r: RoutinePdfRow, includeBatch: boolean): string[] {
  const base = [
    DAY_FULL[r.day],
    timeRange(r.start_time, r.end_time),
  ];
  if (includeBatch) base.push(r.batch_name || r.batch_id);
  return [
    ...base,
    r.course_code,
    r.course_title || '—',
    teacherLabel(r),
    roomLabel(r),
    sectionLabel(r),
    classKind(r),
  ];
}

/**
 * Professional DIU English class routine PDF (logos + clean schedule tables).
 */
export async function exportTimetablePdf(
  store: StoreState,
  entries: TimetableEntry[],
  _title = 'ENG Class Routine',
) {
  const [uniLogo, engLogo] = await Promise.all([
    loadImageDataUrl('/branding/diu-university-logo.png'),
    loadImageDataUrl('/branding/diu-english-dept-logo.png'),
  ]);
  const logos = { uni: uniLogo, eng: engLogo };

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const rows = sortRows(
    toPdfRows(
      store,
      entries.filter((e) => !e.is_cancelled),
    ),
  );
  const batches = sortedBatches(store).filter((b) => rows.some((r) => r.batch_id === b.id));
  const generated = new Date().toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const sessions = uniqueSessions(store);
  const sessionLine = sessions ? `Academic session ${sessions}` : 'Undergraduate programme';

  // ——— Cover / master schedule ———
  let y = drawHeader(doc, logos, {
    documentTitle: 'Official Class Routine  ·  B.A. (Hons.) in English',
    sessionLine,
    generated,
  });

  doc.setFillColor(...C.band);
  doc.roundedRect(10, y, pageW - 20, 11, 1.8, 1.8, 'F');
  doc.setTextColor(...C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Master schedule (all batches)', 14, y + 4.6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text(
    `${rows.length} classes  ·  ${batches.length} batches  ·  Times shown in Bangladesh local time`,
    14,
    y + 9,
  );
  y += 15;

  const masterHead = [
    'Day',
    'Time',
    'Batch',
    'Code',
    'Course title',
    'Teacher',
    'Room',
    'Sec',
    'Type',
  ];

  autoTable(doc, {
    ...tableTheme(),
    startY: y,
    head: [masterHead],
    body: rows.map((r) => rowCells(r, true)),
    columnStyles: {
      0: { cellWidth: 22, halign: 'left', fontStyle: 'bold', textColor: C.navy },
      1: { cellWidth: 30, halign: 'center' },
      2: { cellWidth: 26, halign: 'left' },
      3: { cellWidth: 26, halign: 'left', fontStyle: 'bold' },
      4: { cellWidth: 68, halign: 'left' },
      5: { cellWidth: 48, halign: 'left' },
      6: { cellWidth: 18, halign: 'center' },
      7: { cellWidth: 12, halign: 'center' },
      8: { cellWidth: 18, halign: 'center' },
    },
    didParseCell(data) {
      if (data.section !== 'body') return;
      if (data.column.index === 8 && String(data.cell.raw).toLowerCase() === 'online') {
        data.cell.styles.textColor = C.blue;
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // ——— Per-batch pages ———
  for (const batch of batches) {
    const batchRows = rows.filter((r) => r.batch_id === batch.id);
    if (!batchRows.length) continue;

    doc.addPage();
    y = drawHeader(doc, logos, {
      documentTitle: `Weekly routine  ·  ${batch.name}`,
      sessionLine: `Session ${sessionLabel(batch.session)}  ·  ${batchRows.length} classes`,
      generated,
      compact: true,
    });

    doc.setFillColor(...C.headSoft);
    doc.roundedRect(10, y, pageW - 20, 8, 1.5, 1.5, 'F');
    doc.setTextColor(...C.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(
      'For students & course teachers of this batch  ·  Department of English, DIU',
      14,
      y + 5.2,
    );
    y += 12;

    const batchHead = ['Day', 'Time', 'Code', 'Course title', 'Teacher', 'Room', 'Sec', 'Type'];

    // One table per day for clearer reading
    for (const day of DAYS) {
      const dayRows = batchRows.filter((r) => r.day === day);
      if (!dayRows.length) continue;

      if (y > 170) {
        doc.addPage();
        y = drawHeader(doc, logos, {
          documentTitle: `Weekly routine  ·  ${batch.name} (continued)`,
          sessionLine: `Session ${sessionLabel(batch.session)}`,
          generated,
          compact: true,
        });
      }

      doc.setFillColor(...C.navy);
      doc.roundedRect(10, y, pageW - 20, 6.5, 1.2, 1.2, 'F');
      doc.setTextColor(...C.white);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(DAY_FULL[day].toUpperCase(), 14, y + 4.3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.text(
        `${dayRows.length} class${dayRows.length === 1 ? '' : 'es'}`,
        pageW - 14,
        y + 4.3,
        { align: 'right' },
      );
      y += 8;

      autoTable(doc, {
        ...tableTheme(),
        startY: y,
        head: [batchHead],
        body: dayRows.map((r) => {
          const cells = rowCells(r, false);
          // drop Day column for day-banded tables (already in banner)
          return cells.slice(1);
        }),
        columnStyles: {
          0: { cellWidth: 32, halign: 'center' },
          1: { cellWidth: 28, halign: 'left', fontStyle: 'bold' },
          2: { cellWidth: 78, halign: 'left' },
          3: { cellWidth: 55, halign: 'left' },
          4: { cellWidth: 20, halign: 'center' },
          5: { cellWidth: 14, halign: 'center' },
          6: { cellWidth: 20, halign: 'center' },
        },
      });

      y = lastTableY(doc, y) + 6;
    }
  }

  // ——— Import appendix (machine data) ———
  const payload = JSON.stringify({ version: 1, entries: rows });
  doc.addPage();
  doc.setFillColor(...C.navyDeep);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Appendix — SmartRoutine import data', 14, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(190, 210, 228);
  doc.text('System use only. Skip this page when printing the official class routine.', 14, 16);
  doc.setTextColor(...C.muted);
  doc.setFontSize(4);
  const blob = `${ROUTINE_JSON_START}${payload}${ROUTINE_JSON_END}`;
  doc.text(doc.splitTextToSize(blob, pageW - 28), 14, 30);

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const isImport = i === total;
    drawFooter(
      doc,
      i,
      total,
      generated,
      isImport
        ? 'DIU English · SmartRoutine · Do not print this page'
        : 'Daffodil International University · Department of English · Official class routine',
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`DIU_English_Class_Routine_${stamp}.pdf`);
}

/** Shared day-banded PDF for batch / teacher / student scopes (no import appendix). */
async function exportScopedRoutinePdf(
  store: StoreState,
  entries: TimetableEntry[],
  opts: {
    kind: 'batch' | 'teacher' | 'student';
    documentTitle: string;
    bannerNote: string;
    fileName: string;
    note: string;
    /** Teacher view shows batch column instead of teacher name */
    teacherView?: boolean;
  },
) {
  const [uniLogo, engLogo] = await Promise.all([
    loadImageDataUrl('/branding/diu-university-logo.png'),
    loadImageDataUrl('/branding/diu-english-dept-logo.png'),
  ]);
  const logos = { uni: uniLogo, eng: engLogo };
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const rows = sortRows(
    toPdfRows(
      store,
      entries.filter((e) => !e.is_cancelled),
    ),
  );
  const generated = new Date().toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  let y = drawHeader(doc, logos, {
    documentTitle: opts.documentTitle,
    sessionLine: `${opts.bannerNote}  ·  ${rows.length} class${rows.length === 1 ? '' : 'es'}`,
    generated,
  });

  doc.setFillColor(...C.headSoft);
  doc.roundedRect(10, y, pageW - 20, 8, 1.5, 1.5, 'F');
  doc.setTextColor(...C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(opts.note, 14, y + 5.2);
  y += 12;

  if (!rows.length) {
    doc.setTextColor(...C.muted);
    doc.setFontSize(11);
    doc.text('No active classes in this schedule.', pageW / 2, y + 24, { align: 'center' });
  }

  const head = opts.teacherView
    ? ['Time', 'Batch', 'Code', 'Course title', 'Room', 'Sec', 'Type']
    : ['Time', 'Code', 'Course title', 'Teacher', 'Room', 'Sec', 'Type'];

  for (const day of DAYS) {
    const dayRows = rows.filter((r) => r.day === day);
    if (!dayRows.length) continue;

    if (y > 170) {
      doc.addPage();
      y = drawHeader(doc, logos, {
        documentTitle: `${opts.documentTitle} (continued)`,
        sessionLine: opts.bannerNote,
        generated,
        compact: true,
      });
    }

    doc.setFillColor(...C.navy);
    doc.roundedRect(10, y, pageW - 20, 6.5, 1.2, 1.2, 'F');
    doc.setTextColor(...C.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(DAY_FULL[day].toUpperCase(), 14, y + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(
      `${dayRows.length} class${dayRows.length === 1 ? '' : 'es'}`,
      pageW - 14,
      y + 4.3,
      { align: 'right' },
    );
    y += 8;

    autoTable(doc, {
      ...tableTheme(),
      startY: y,
      head: [head],
      body: dayRows.map((r) =>
        opts.teacherView
          ? [
              timeRange(r.start_time, r.end_time),
              r.batch_name || r.batch_id,
              r.course_code,
              r.course_title || '—',
              roomLabel(r),
              sectionLabel(r),
              classKind(r),
            ]
          : rowCells(r, false).slice(1),
      ),
      columnStyles: opts.teacherView
        ? {
            0: { cellWidth: 30, halign: 'center' },
            1: { cellWidth: 28, halign: 'left' },
            2: { cellWidth: 28, halign: 'left', fontStyle: 'bold' },
            3: { cellWidth: 72, halign: 'left' },
            4: { cellWidth: 20, halign: 'center' },
            5: { cellWidth: 14, halign: 'center' },
            6: { cellWidth: 20, halign: 'center' },
          }
        : {
            0: { cellWidth: 32, halign: 'center' },
            1: { cellWidth: 28, halign: 'left', fontStyle: 'bold' },
            2: { cellWidth: 78, halign: 'left' },
            3: { cellWidth: 55, halign: 'left' },
            4: { cellWidth: 20, halign: 'center' },
            5: { cellWidth: 14, halign: 'center' },
            6: { cellWidth: 20, halign: 'center' },
          },
    });
    y = lastTableY(doc, y) + 6;
  }

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawFooter(
      doc,
      i,
      total,
      generated,
      'Daffodil International University · Department of English · Class routine',
    );
  }
  doc.save(opts.fileName);
}

/** One batch only — chairman, or shared download */
export async function exportBatchRoutinePdf(store: StoreState, batchId: string) {
  const batch = store.batches.find((b) => b.id === batchId);
  const entries = store.timetable.filter((e) => e.batch_id === batchId);
  const safe = (batch?.name || batchId).replace(/[^\w\-]+/g, '_');
  await exportScopedRoutinePdf(store, entries, {
    kind: 'batch',
    documentTitle: `Batch routine  ·  ${batch?.name || batchId}`,
    bannerNote: batch?.session
      ? `Session ${sessionLabel(batch.session)}  ·  ${batch.name}`
      : batch?.name || batchId,
    fileName: `DIU_English_Batch_${safe}.pdf`,
    note: 'Batch timetable  ·  Department of English, DIU',
  });
}

/** Teacher: own teaching load */
export async function exportTeacherRoutinePdf(
  store: StoreState,
  teacherInitial: string,
  teacherName?: string | null,
) {
  const initial = teacherInitial.toUpperCase();
  const teacher = store.teachers.find((t) => t.initial.toUpperCase() === initial) || null;
  const entries = store.timetable.filter((e) => e.teacher_initial.toUpperCase() === initial);
  const label = teacherName || teacher?.name || initial;
  await exportScopedRoutinePdf(store, entries, {
    kind: 'teacher',
    documentTitle: `Teaching schedule  ·  ${label} (${initial})`,
    bannerNote: `${label}  ·  ${initial}`,
    fileName: `DIU_English_Teacher_${initial}.pdf`,
    note: 'Personal teaching timetable  ·  Department of English, DIU',
    teacherView: true,
  });
}

/** Student: own batch (+ section when set) */
export async function exportStudentRoutinePdf(
  store: StoreState,
  batchId: string,
  section?: string | null,
  studentLabel?: string | null,
) {
  const batch = store.batches.find((b) => b.id === batchId);
  const sec = section?.trim() || null;
  const entries = store.timetable.filter((e) => {
    if (e.batch_id !== batchId) return false;
    if (!sec) return true;
    const entrySec = e.section || e.group_name;
    return !entrySec || entrySec === sec;
  });
  const titleBits = [batch?.name || batchId, sec ? `Sec ${sec}` : null, studentLabel]
    .filter(Boolean)
    .join(' · ');
  const safe = titleBits.replace(/[^\w\-]+/g, '_').slice(0, 60);
  await exportScopedRoutinePdf(store, entries, {
    kind: 'student',
    documentTitle: `My class routine  ·  ${titleBits}`,
    bannerNote: titleBits,
    fileName: `DIU_English_Student_${safe || batchId}.pdf`,
    note: 'Personal student timetable  ·  Department of English, DIU',
  });
}
