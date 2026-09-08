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

const MAX_SLOTS = 4;

/** DIU English print palette — navy + soft teal (print-safe). */
const C = {
  navy: [10, 37, 64] as [number, number, number],
  navyMid: [18, 55, 95] as [number, number, number],
  teal: [14, 110, 110] as [number, number, number],
  ink: [22, 32, 40] as [number, number, number],
  muted: [90, 105, 118] as [number, number, number],
  line: [190, 204, 218] as [number, number, number],
  head: [232, 238, 246] as [number, number, number],
  band: [245, 248, 252] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  softTeal: [232, 244, 243] as [number, number, number],
  dayFill: [10, 37, 64] as [number, number, number],
  slotAlt: [248, 250, 253] as [number, number, number],
};

/** Serializable rows that round-trip cleanly through PDF import. */
export type RoutinePdfRow = {
  day: DayCode;
  batch_id: string;
  batch_name?: string;
  teacher_initial: string;
  course_code: string;
  course_title?: string;
  type: ClassType;
  mode: ClassMode;
  start_time: string;
  end_time: string;
  room_id: string | null;
  room_name?: string | null;
  group_name: string | null;
  is_cancelled: boolean;
  cancellation_reason: string | null;
};

export function toPdfRows(store: StoreState, entries: TimetableEntry[]): RoutinePdfRow[] {
  return entries.map((e) => {
    const course = store.courses.find((c) => c.code === e.course_code);
    const batch = store.batches.find((b) => b.id === e.batch_id);
    const room = store.rooms.find((r) => r.id === e.room_id || r.name === e.room_id);
    return {
      day: e.day,
      batch_id: e.batch_id,
      batch_name: batch?.name,
      teacher_initial: e.teacher_initial,
      course_code: e.course_code,
      course_title: course?.title,
      type: e.type,
      mode: e.mode,
      start_time: formatTime(e.start_time),
      end_time: formatTime(e.end_time),
      room_id: e.room_id,
      room_name: e.mode === 'Online' ? 'Online' : room?.name || e.room_id,
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

function sessionLabel(session: string): string {
  const m = session.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-20${m[2]}`;
  return session;
}

function typeShort(type: ClassType, mode: ClassMode): string {
  if (mode === 'Online') return 'Online';
  if (type === 'Tutorial') return 'Tutorial';
  if (type === 'Sessional') return 'Lab / Sessional';
  return 'Lecture';
}

function roomShort(name: string | null | undefined, id: string | null): string {
  if (!name && !id) return '';
  const raw = name || id || '';
  if (/online/i.test(raw)) return 'Online';
  const digits = raw.match(/\d{3,4}/);
  return digits ? `R-${digits[0]}` : raw.replace(/\s*\([^)]*\)\s*/g, '').trim();
}

/** Readable multi-line cell — time first, then course, then meta. */
function cellText(e: RoutinePdfRow): string {
  const time = `${toAmPm(e.start_time)} – ${toAmPm(e.end_time)}`;
  const room = e.mode === 'Online' ? 'Online' : roomShort(e.room_name, e.room_id);
  const meta = [
    e.teacher_initial,
    room || null,
    e.group_name ? `Grp ${e.group_name}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  return `${time}\n${e.course_code}\n${meta}\n${typeShort(e.type, e.mode)}`;
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
  return [...new Set(parts)].join('  ·  ');
}

function batchColumnLabel(batch: { name: string; session: string }): string {
  const sess = sessionLabel(batch.session);
  if (!sess || sess === batch.name) return batch.name;
  return `${batch.name}\n${sess}`;
}

function packSlots(classes: RoutinePdfRow[]): string[] {
  const slots: string[] = Array.from({ length: MAX_SLOTS }, () => '');
  const byStart = new Map<string, RoutinePdfRow[]>();
  for (const c of classes) {
    const key = `${c.start_time}|${c.end_time}`;
    const list = byStart.get(key) || [];
    list.push(c);
    byStart.set(key, list);
  }
  [...byStart.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, MAX_SLOTS)
    .forEach(([_, list], idx) => {
      slots[idx] = list.map(cellText).join('\n────────\n');
    });
  return slots;
}

function lastTableY(doc: jsPDF, fallback: number) {
  return (
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY || fallback
  );
}

function drawBrandMark(doc: jsPDF, x: number, y: number, size = 14) {
  doc.setFillColor(...C.navy);
  doc.roundedRect(x, y, size, size, 2.2, 2.2, 'F');
  doc.setFillColor(...C.teal);
  doc.roundedRect(x + size * 0.38, y + size * 0.38, size * 0.5, size * 0.5, 1.4, 1.4, 'F');
  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.text('ENG', x + size / 2, y + size / 2 + 1.6, { align: 'center' });
}

function drawPageChrome(
  doc: jsPDF,
  opts: {
    title: string;
    subtitle?: string;
    meta?: string;
    compact?: boolean;
  },
) {
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(...C.navy);
  doc.rect(0, 0, pageW, opts.compact ? 18 : 28, 'F');
  doc.setFillColor(...C.teal);
  doc.rect(0, opts.compact ? 18 : 28, pageW, 1.4, 'F');

  drawBrandMark(doc, 12, opts.compact ? 2.2 : 6, opts.compact ? 13 : 16);

  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(opts.compact ? 11 : 13);
  doc.text('Daffodil International University', 30, opts.compact ? 8.2 : 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(opts.compact ? 7.5 : 8.5);
  doc.setTextColor(210, 222, 235);
  doc.text(
    'Faculty of Humanities & Social Sciences  ·  Department of English',
    30,
    opts.compact ? 13.5 : 18.5,
  );

  if (!opts.compact) {
    doc.setFillColor(...C.band);
    doc.rect(0, 29.4, pageW, 16, 'F');
    doc.setTextColor(...C.navy);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(opts.title, 12, 39);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    const right = [opts.subtitle, opts.meta].filter(Boolean).join('   |   ');
    if (right) doc.text(right, pageW - 12, 39, { align: 'right' });
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.3);
    doc.line(12, 44.2, pageW - 12, 44.2);
    return 48;
  }

  doc.setTextColor(...C.navy);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(opts.title, 12, 28);
  if (opts.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(opts.subtitle, 12, 33);
  }
  return 36;
}

function drawLegend(doc: jsPDF, x: number, y: number) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(...C.head);
  doc.roundedRect(x, y - 3.5, pageW - x * 2, 8, 1.2, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.navy);
  doc.text('Cell guide', x + 3, y + 1.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...C.muted);
  doc.text(
    '1) Time   2) Course code   3) Teacher · Room · Group   4) Class type   ·   Online classes tinted mint',
    x + 28,
    y + 1.5,
  );
}

/**
 * Professional weekly class routine PDF (master grid + per-batch pages).
 */
export function exportTimetablePdf(
  store: StoreState,
  entries: TimetableEntry[],
  _title = 'ENG Class Routine',
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const rows = toPdfRows(
    store,
    entries.filter((e) => !e.is_cancelled),
  );
  const batches = sortedBatches(store);
  const activeDays = DAYS.filter((d) => rows.some((r) => r.day === d));
  const generated = new Date().toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const sessions = uniqueSessions(store);

  let y = drawPageChrome(doc, {
    title: 'Class Routine — B.A. (Hons) in English',
    subtitle: sessions ? `Session ${sessions}` : undefined,
    meta: `Generated ${generated}`,
  });

  drawLegend(doc, 12, y);
  y += 9;

  const slotHead = Array.from({ length: MAX_SLOTS }, (_, i) => `${i + 1}${ordinal(i + 1)} Slot`);

  const tableBase = {
    theme: 'grid' as const,
    styles: {
      font: 'helvetica',
      fontSize: 7.2,
      cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
      valign: 'top' as const,
      halign: 'left' as const,
      overflow: 'linebreak' as const,
      minCellHeight: 18,
      lineColor: C.line,
      lineWidth: 0.25,
      textColor: C.ink,
    },
    headStyles: {
      fillColor: C.navy,
      textColor: C.white,
      fontStyle: 'bold' as const,
      fontSize: 8.5,
      halign: 'center' as const,
      valign: 'middle' as const,
      cellPadding: 3,
    },
    alternateRowStyles: {
      fillColor: C.slotAlt,
    },
    margin: { left: 10, right: 10, bottom: 14 },
  };

  for (const day of activeDays) {
    const dayRows = batches
      .map((batch) => {
        const classes = rows
          .filter((r) => r.day === day && r.batch_id === batch.id)
          .sort(
            (a, b) =>
              a.start_time.localeCompare(b.start_time) ||
              (a.group_name || '').localeCompare(b.group_name || ''),
          );
        return {
          batchLabel: batchColumnLabel(batch),
          slots: packSlots(classes),
          hasClass: classes.length > 0,
        };
      })
      .filter((r) => r.hasClass);

    if (!dayRows.length) continue;

    if (y > 155) {
      doc.addPage();
      y = drawPageChrome(doc, {
        title: 'Class Routine — continued',
        subtitle: sessions ? `Session ${sessions}` : undefined,
        meta: generated,
        compact: true,
      });
    }

    doc.setFillColor(...C.softTeal);
    doc.roundedRect(10, y, pageW - 20, 7, 1.5, 1.5, 'F');
    doc.setTextColor(...C.teal);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(DAY_FULL[day].toUpperCase(), 14, y + 4.8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(`${dayRows.length} batch row${dayRows.length === 1 ? '' : 's'}`, pageW - 14, y + 4.8, {
      align: 'right',
    });
    y += 9;

    autoTable(doc, {
      ...tableBase,
      startY: y,
      head: [['Batch / Session', ...slotHead]],
      body: dayRows.map((r) => [r.batchLabel, ...r.slots]),
      columnStyles: {
        0: {
          cellWidth: 32,
          fontStyle: 'bold',
          valign: 'middle',
          halign: 'center',
          fillColor: C.head,
          textColor: C.navy,
          fontSize: 7.5,
        },
        1: { cellWidth: 56 },
        2: { cellWidth: 56 },
        3: { cellWidth: 56 },
        4: { cellWidth: 56 },
      },
      didParseCell(data) {
        if (data.section !== 'body' || data.column.index < 1) return;
        const raw = String(data.cell.raw || '');
        if (!raw.trim()) {
          data.cell.styles.fillColor = [252, 253, 255];
          return;
        }
        data.cell.styles.fontSize = 6.9;
        data.cell.styles.halign = 'left';
        if (raw.includes('Online')) {
          data.cell.styles.fillColor = [240, 248, 247];
        }
      },
    });

    y = lastTableY(doc, y) + 7;
  }

  for (const batch of batches) {
    const batchRows = rows.filter((r) => r.batch_id === batch.id);
    if (!batchRows.length) continue;

    doc.addPage();
    y = drawPageChrome(doc, {
      title: `Weekly Routine — ${batch.name}`,
      subtitle: sessionLabel(batch.session),
      meta: generated,
    });

    doc.setFillColor(...C.navyMid);
    doc.roundedRect(10, y, pageW - 20, 8, 1.5, 1.5, 'F');
    doc.setTextColor(...C.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Single-batch view  ·  Print or share with this section only', 14, y + 5.3);
    y += 12;

    const body = DAYS.map((day) => {
      const classes = batchRows
        .filter((r) => r.day === day)
        .sort((a, b) => a.start_time.localeCompare(b.start_time));
      if (!classes.length) return null;
      return [DAY_FULL[day], ...packSlots(classes)];
    }).filter(Boolean) as string[][];

    autoTable(doc, {
      ...tableBase,
      startY: y,
      head: [['Day', ...slotHead]],
      body,
      columnStyles: {
        0: {
          cellWidth: 28,
          fontStyle: 'bold',
          valign: 'middle',
          halign: 'center',
          fillColor: C.dayFill,
          textColor: C.white,
          fontSize: 8,
        },
      },
      didParseCell(data) {
        if (data.section !== 'body' || data.column.index < 1) return;
        data.cell.styles.fontSize = 7;
        data.cell.styles.halign = 'left';
      },
    });
  }

  const payload = JSON.stringify({ version: 1, entries: rows });
  doc.addPage();
  doc.setFillColor(...C.navy);
  doc.rect(0, 0, pageW, 22, 'F');
  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('SmartRoutine import data', 14, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 214, 230);
  doc.text('System use only — skip this page when printing the class routine.', 14, 16);
  doc.setTextColor(...C.muted);
  doc.setFontSize(4.2);
  const blob = `${ROUTINE_JSON_START}${payload}${ROUTINE_JSON_END}`;
  doc.text(doc.splitTextToSize(blob, pageW - 28), 14, 30);

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    const isImport = i === total;
    doc.setFillColor(...C.navy);
    doc.rect(0, pageH - 8, pageW, 8, 'F');
    doc.setTextColor(200, 214, 230);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(
      isImport
        ? 'DIU English · SmartRoutine · Do not print'
        : 'DIU English · SmartRoutine class routine',
      12,
      pageH - 3.2,
    );
    doc.text(`Page ${i} of ${total}`, pageW / 2, pageH - 3.2, { align: 'center' });
    if (!isImport) {
      doc.text(generated, pageW - 12, pageH - 3.2, { align: 'right' });
    }
  }

  doc.save('diu_english_class_routine.pdf');
}

function ordinal(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}
