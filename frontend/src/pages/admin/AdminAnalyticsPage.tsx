import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CalendarClock,
  DoorOpen,
  GraduationCap,
  Radio,
  RefreshCw,
  Users,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { DAYS, todayDay, formatTime } from '../../lib/constants';
import { findConflicts } from '../../lib/conflicts';
import type { DayCode, TimetableEntry } from '../../lib/types';

const TYPE_COLORS: Record<string, string> = {
  Lecture: '#4366f6',
  Tutorial: '#32ade6',
  Sessional: '#34c759',
  Online: '#af52de',
};

const MODE_COLORS: Record<string, string> = {
  Onsite: '#4366f6',
  Offline: '#64748b',
  Online: '#32ade6',
};

function useNow(tickMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return now;
}

function useAnimatedNumber(target: number, duration = 700) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

function minutesNow(d: Date) {
  return d.getHours() * 60 + d.getMinutes();
}

function toMinutes(t: string) {
  const [h, m] = formatTime(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function isLive(e: TimetableEntry, day: DayCode, now: Date) {
  if (e.is_cancelled || e.day !== day) return false;
  const n = minutesNow(now);
  return toMinutes(e.start_time) <= n && n < toMinutes(e.end_time);
}

function isUpcoming(e: TimetableEntry, day: DayCode, now: Date) {
  if (e.is_cancelled || e.day !== day) return false;
  return toMinutes(e.start_time) > minutesNow(now);
}

function Donut({
  segments,
  size = 124,
  thickness = 14,
  centerLabel,
  centerSub,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerSub: string;
}) {
  const total = Math.max(1, segments.reduce((s, x) => s + x.value, 0));
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="ax-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface)"
          strokeWidth={thickness}
        />
        {segments.map((seg) => {
          const len = (seg.value / total) * c;
          const el = (
            <circle
              key={seg.label}
              className="ax-donut-seg"
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="ax-donut-center">
        <strong>{centerLabel}</strong>
        <span>{centerSub}</span>
      </div>
    </div>
  );
}

function HealthRing({ score }: { score: number }) {
  const size = 118;
  const thickness = 11;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 85 ? 'var(--success)' : score >= 60 ? 'var(--warning)' : 'var(--error)';
  const animated = useAnimatedNumber(score);
  const band = score >= 85 ? 'Strong' : score >= 60 ? 'Watch' : 'At risk';
  return (
    <div className="ax-donut" title="Starts at 100. Drops when clashes or cancellations rise.">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface)"
          strokeWidth={thickness}
        />
        <circle
          className="ax-health-ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={`${pct * c} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ax-donut-center">
        <strong>{animated}%</strong>
        <span>{band}</span>
      </div>
    </div>
  );
}

function PanelTitle({
  title,
  explain,
  badge,
}: {
  title: ReactNode;
  explain: string;
  badge?: ReactNode;
}) {
  return (
    <div className="ax-panel-head-block">
      <div className="ax-panel-head">
        <h3>{title}</h3>
        {badge}
      </div>
      <p className="ax-explain">{explain}</p>
    </div>
  );
}

function AnimatedBars({
  items,
  color = 'var(--primary)',
}: {
  items: Array<{ label: string; value: number; hint?: string }>;
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="ax-bars">
      {items.map((item, i) => (
        <div key={item.label} className="ax-bar-row" style={{ animationDelay: `${i * 40}ms` }}>
          <div className="ax-bar-meta">
            <span>{item.label}</span>
            <strong>
              {item.value}
              {item.hint ? <em>{item.hint}</em> : null}
            </strong>
          </div>
          <div className="ax-bar-track">
            <div
              className="ax-bar-fill"
              style={{ width: `${(item.value / max) * 100}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Sparkline({ values, color = '#4366f6' }: { values: number[]; color?: string }) {
  const w = 120;
  const h = 36;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * w;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg className="ax-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
      />
    </svg>
  );
}

/** Spider / radar — weekly class pressure across days */
function RadarChart({
  values,
  labels,
  highlightIndex,
  size = 200,
}: {
  values: number[];
  labels: string[];
  highlightIndex?: number;
  size?: number;
}) {
  const n = values.length;
  const max = Math.max(1, ...values);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  const angleAt = (i: number) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const point = (i: number, scale: number) => {
    const a = angleAt(i);
    return [cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale] as const;
  };
  const rings = [0.35, 0.65, 1];
  const poly = values
    .map((v, i) => {
      const [x, y] = point(i, v / max);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="ax-radar">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id="axRadarFill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--info)" stopOpacity="0.08" />
          </radialGradient>
        </defs>
        {rings.map((scale) => (
          <polygon
            key={scale}
            className="ax-radar-grid"
            points={Array.from({ length: n }, (_, i) => point(i, scale).join(',')).join(' ')}
            fill="none"
          />
        ))}
        {labels.map((_, i) => {
          const [x, y] = point(i, 1);
          return (
            <line
              key={`axis-${i}`}
              className="ax-radar-axis"
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
            />
          );
        })}
        <polygon className="ax-radar-poly" points={poly} fill="url(#axRadarFill)" />
        {values.map((v, i) => {
          const [x, y] = point(i, v / max);
          const active = i === highlightIndex;
          return (
            <circle
              key={`pt-${i}`}
              className={`ax-radar-dot${active ? ' today' : ''}`}
              cx={x}
              cy={y}
              r={active ? 6 : 4}
            />
          );
        })}
        {labels.map((label, i) => {
          const [x, y] = point(i, 1.22);
          return (
            <text key={`lb-${i}`} className="ax-radar-label" x={x} y={y} textAnchor="middle" dominantBaseline="middle">
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** Smooth wave / area — day-of-week rhythm */
function WaveAreaChart({
  values,
  labels,
  highlightIndex,
}: {
  values: number[];
  labels: string[];
  highlightIndex?: number;
}) {
  const w = 520;
  const h = 200;
  const padX = 28;
  const padY = 24;
  const max = Math.max(1, ...values);
  const coords = values.map((v, i) => {
    const x = padX + (i / Math.max(1, values.length - 1)) * (w - padX * 2);
    const y = h - padY - (v / max) * (h - padY * 2);
    return { x, y, v, label: labels[i] };
  });

  const linePath = coords
    .map((p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = coords[i - 1];
      const cpx = (prev.x + p.x) / 2;
      return `C ${cpx} ${prev.y}, ${cpx} ${p.y}, ${p.x} ${p.y}`;
    })
    .join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${h - padY} L ${coords[0].x} ${h - padY} Z`;

  return (
    <div className="ax-wave">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="axWaveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--info)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="axWaveStroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#0d7377" />
            <stop offset="50%" stopColor="#32ade6" />
            <stop offset="100%" stopColor="#4366f6" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((t) => {
          const y = h - padY - t * (h - padY * 2);
          return <line key={t} className="ax-wave-guide" x1={padX} x2={w - padX} y1={y} y2={y} />;
        })}
        <path className="ax-wave-area" d={areaPath} fill="url(#axWaveFill)" />
        <path className="ax-wave-line" d={linePath} fill="none" stroke="url(#axWaveStroke)" />
        {coords.map((p, i) => (
          <g key={p.label}>
            <circle
              className={`ax-wave-dot${i === highlightIndex ? ' today' : ''}`}
              cx={p.x}
              cy={p.y}
              r={i === highlightIndex ? 6 : 4}
            />
            <text className="ax-wave-value" x={p.x} y={p.y - 12} textAnchor="middle">
              {p.v}
            </text>
            <text className="ax-wave-label" x={p.x} y={h - 6} textAnchor="middle">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Orbit map — teacher load as orbiting bodies (unique, not a bar chart) */
function OrbitMap({
  items,
}: {
  items: Array<{ label: string; value: number }>;
}) {
  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const max = Math.max(1, ...items.map((i) => i.value));
  const shown = items.slice(0, 8);

  return (
    <div className="ax-orbit">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ax-orbit-ring" cx={cx} cy={cy} r={48} />
        <circle className="ax-orbit-ring" cx={cx} cy={cy} r={78} />
        <circle className="ax-orbit-ring" cx={cx} cy={cy} r={108} />
        <circle className="ax-orbit-core" cx={cx} cy={cy} r={28} />
        <text className="ax-orbit-core-label" x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
          Load
        </text>
        {shown.map((item, i) => {
          const ring = 48 + (i % 3) * 30;
          const angle = -Math.PI / 2 + (i / shown.length) * Math.PI * 2;
          const x = cx + Math.cos(angle) * ring;
          const y = cy + Math.sin(angle) * ring;
          const r = 10 + (item.value / max) * 16;
          return (
            <g key={item.label} className="ax-orbit-body" style={{ animationDelay: `${i * 0.35}s` }}>
              <circle className="ax-orbit-planet" cx={x} cy={y} r={r} />
              <text className="ax-orbit-initial" x={x} y={y} textAnchor="middle" dominantBaseline="middle">
                {item.label.slice(0, 3)}
              </text>
              <text className="ax-orbit-count" x={x} y={y + r + 12} textAnchor="middle">
                {item.value}
              </text>
            </g>
          );
        })}
      </svg>
      {!shown.length && <p className="muted ax-empty">No teacher load yet.</p>}
    </div>
  );
}

/** Hourly intensity — radial petals around the clock (9–16) */
function ClockPetals({
  hours,
}: {
  hours: number[];
}) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const max = Math.max(1, ...hours);
  const n = hours.length;

  return (
    <div className="ax-petals">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="ax-petals-hub" cx={cx} cy={cy} r={22} />
        {hours.map((count, i) => {
          const a0 = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const a1 = -Math.PI / 2 + ((i + 0.72) / n) * Math.PI * 2;
          const inner = 34;
          const outer = 34 + (count / max) * 78;
          const x0 = cx + Math.cos(a0) * inner;
          const y0 = cy + Math.sin(a0) * inner;
          const x1 = cx + Math.cos(a0) * outer;
          const y1 = cy + Math.sin(a0) * outer;
          const x2 = cx + Math.cos(a1) * outer;
          const y2 = cy + Math.sin(a1) * outer;
          const x3 = cx + Math.cos(a1) * inner;
          const y3 = cy + Math.sin(a1) * inner;
          const d = `M ${x0} ${y0} L ${x1} ${y1} A ${outer} ${outer} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 0 0 ${x0} ${y0} Z`;
          const lx = cx + Math.cos((a0 + a1) / 2) * (outer + 14);
          const ly = cy + Math.sin((a0 + a1) / 2) * (outer + 14);
          return (
            <g key={i} className="ax-petal" style={{ animationDelay: `${i * 0.12}s` }}>
              <path d={d} className="ax-petal-shape" />
              <text className="ax-petal-label" x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">
                {9 + i}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function AdminAnalyticsPage() {
  const { store, batchById, roomById, mode, refresh } = useData();
  const now = useNow(1000);
  const [pulse, setPulse] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Soft live refresh — keeps charts in sync with backend / local edits
  useEffect(() => {
    const id = window.setInterval(() => {
      setPulse((p) => p + 1);
      void refresh();
    }, 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const today = todayDay();
  const tt = store?.timetable || [];

  const analytics = useMemo(() => {
    const byDay = Object.fromEntries(DAYS.map((d) => [d, 0])) as Record<DayCode, number>;
    const byType: Record<string, number> = {};
    const byMode: Record<string, number> = {};
    const byBatch: Record<string, number> = {};
    const byTeacher: Record<string, number> = {};
    const byRoom: Record<string, number> = {};
    const hourHeat: Record<DayCode, number[]> = Object.fromEntries(
      DAYS.map((d) => [d, Array.from({ length: 8 }, () => 0)]),
    ) as Record<DayCode, number[]>;

    let cancelled = 0;
    let online = 0;

    for (const e of tt) {
      byDay[e.day] = (byDay[e.day] || 0) + 1;
      byType[e.type] = (byType[e.type] || 0) + 1;
      byMode[e.mode] = (byMode[e.mode] || 0) + 1;
      byBatch[e.batch_id] = (byBatch[e.batch_id] || 0) + 1;
      byTeacher[e.teacher_initial] = (byTeacher[e.teacher_initial] || 0) + 1;
      if (e.room_id) byRoom[e.room_id] = (byRoom[e.room_id] || 0) + 1;
      if (e.is_cancelled) cancelled += 1;
      if (e.mode === 'Online') online += 1;

      if (!e.is_cancelled) {
        const startH = Number(formatTime(e.start_time).slice(0, 2));
        const bucket = Math.min(7, Math.max(0, startH - 9)); // 9am → index 0
        hourHeat[e.day][bucket] += 1;
      }
    }

    const conflicts = findConflicts(tt);
    const active = tt.length - cancelled;
    const clashPenalty = Math.min(40, conflicts.length * 8);
    const cancelPenalty = tt.length ? Math.min(25, (cancelled / tt.length) * 100) : 0;
    const health = Math.round(Math.max(0, 100 - clashPenalty - cancelPenalty));

    const live = tt.filter((e) => isLive(e, today, now));
    const upcoming = tt
      .filter((e) => isUpcoming(e, today, now))
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .slice(0, 6);
    const todayClasses = tt.filter((e) => e.day === today && !e.is_cancelled);

    const teacherLoad = Object.entries(byTeacher)
      .map(([k, v]) => ({ label: k, value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const roomUse = Object.entries(byRoom)
      .map(([k, v]) => ({
        label: roomById(k)?.name || k,
        value: v,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    const batchBars = Object.entries(byBatch)
      .map(([k, v]) => ({
        label: batchById(k)?.name || k,
        value: v,
        hint: ` · ${store?.students.filter((s) => s.batch_id === k).length || 0} students`,
      }))
      .sort((a, b) => b.value - a.value);

    const peakHour = (() => {
      let best = { day: today as DayCode, hour: 9, count: 0 };
      for (const d of DAYS) {
        hourHeat[d].forEach((count, i) => {
          if (count > best.count) best = { day: d, hour: 9 + i, count };
        });
      }
      return best;
    })();

    const hourProfile = Array.from({ length: 8 }, (_, i) =>
      DAYS.reduce((sum, d) => sum + hourHeat[d][i], 0),
    );

    const roomUtil =
      store?.rooms.length && active
        ? Math.round((Object.keys(byRoom).length / store.rooms.length) * 100)
        : 0;

    return {
      byDay,
      byType,
      byMode,
      cancelled,
      active,
      online,
      conflicts,
      health,
      live,
      upcoming,
      todayClasses,
      teacherLoad,
      roomUse,
      batchBars,
      hourHeat,
      hourProfile,
      peakHour,
      roomUtil,
      students: store?.students.length || 0,
      teachers: store?.teachers.length || 0,
      rooms: store?.rooms.length || 0,
      courses: store?.courses.length || 0,
      batches: store?.batches.length || 0,
    };
  }, [store, batchById, roomById, today, now, pulse]);

  const totalAnim = useAnimatedNumber(tt.length);
  const liveAnim = useAnimatedNumber(analytics.live.length);
  const conflictAnim = useAnimatedNumber(analytics.conflicts.length);
  const studentAnim = useAnimatedNumber(analytics.students);

  const typeSegs = Object.entries(analytics.byType).map(([label, value]) => ({
    label,
    value,
    color: TYPE_COLORS[label] || '#94a3b8',
  }));
  const modeSegs = Object.entries(analytics.byMode).map(([label, value]) => ({
    label,
    value,
    color: MODE_COLORS[label] || '#94a3b8',
  }));

  const daySeries = DAYS.map((d) => analytics.byDay[d] || 0);
  const heatMax = Math.max(1, ...DAYS.flatMap((d) => analytics.hourHeat[d]));

  async function onRefresh() {
    setRefreshing(true);
    try {
      await refresh();
      setPulse((p) => p + 1);
    } finally {
      setRefreshing(false);
    }
  }

  const clock = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateLabel = now.toLocaleDateString([], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="admin-page ax-page">
      <div className="ax-hero">
        <span className="ax-orb ax-orb-a" aria-hidden />
        <span className="ax-orb ax-orb-b" aria-hidden />
        <span className="ax-orb ax-orb-c" aria-hidden />
        <div>
          <p className="ax-kicker">
            <Radio size={14} className="ax-live-dot" /> Analytics · Live operations
            <span className="ax-live-chip">
              <span className="ax-pulse" /> Streaming
            </span>
          </p>
          <h1>Analytics</h1>
          <p className="muted">
            Client overview of the English department routine — what is running now, where load sits,
            and which clashes need fixing. Auto-refreshes every 15 seconds.
          </p>
        </div>
        <div className="ax-hero-right">
          <div className="ax-clock card">
            <CalendarClock size={18} className="ax-clock-icon" />
            <div>
              <strong>{clock}</strong>
              <span>
                {dateLabel} · {today}
              </span>
            </div>
          </div>
          <button
            className={`btn-outline ax-refresh${refreshing ? ' spinning' : ''}`}
            onClick={() => void onRefresh()}
            type="button"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      <div className="ax-kpi-grid">
        <div className="ax-kpi ax-kpi-primary" title="Classes whose start–end window includes the current clock time (today only).">
          <div className="ax-kpi-top">
            <Activity size={18} />
            <span>Live now</span>
          </div>
          <strong>{liveAnim}</strong>
          <p>
            Classes in session right now · {analytics.todayClasses.length} scheduled today
            <Sparkline values={daySeries} color="#fff" />
          </p>
        </div>
        <div className="ax-kpi" title="All timetable rows in the system for this department.">
          <div className="ax-kpi-top">
            <BookOpen size={18} />
            <span>Total classes</span>
          </div>
          <strong>{totalAnim}</strong>
          <p>
            Whole-week slots · {analytics.active} active · {analytics.cancelled} cancelled
          </p>
        </div>
        <div className="ax-kpi" title="Students enrolled in SmartRoutine for English batches.">
          <div className="ax-kpi-top">
            <GraduationCap size={18} />
            <span>Students</span>
          </div>
          <strong>{studentAnim}</strong>
          <p>
            Enrolled learners · {analytics.batches} batches · {analytics.courses} courses
          </p>
        </div>
        <div
          className={`ax-kpi${analytics.conflicts.length ? ' ax-kpi-warn' : ''}`}
          title="Double-booked teachers, rooms, or batches at the same time."
        >
          <div className="ax-kpi-top">
            <AlertTriangle size={18} />
            <span>Conflicts</span>
          </div>
          <strong>{conflictAnim}</strong>
          <p>
            {analytics.conflicts.length
              ? 'Scheduling clashes that need chairman action'
              : 'No teacher / room / batch clashes'}
          </p>
        </div>
      </div>

      <div className="ax-guide card pad">
        <p className="ax-guide__kicker">How to read this page</p>
        <ul>
          <li>
            <strong>Top cards</strong> — quick pulse: live classes, total load, students, clashes.
          </li>
          <li>
            <strong>Charts below</strong> — where pressure sits by day, hour, teacher, room, and batch.
          </li>
          <li>
            <strong>Health %</strong> — starts at 100; falls when conflicts or cancellations rise.
          </li>
        </ul>
      </div>

      <div className="ax-main-grid">
        <section className="card pad ax-panel ax-health-panel">
          <PanelTitle
            title="Routine health"
            explain="Overall quality score for the published English timetable. 85%+ is healthy; below 60% means clashes or cancellations are hurting the week."
            badge={<span className="ax-badge">{mode === 'api' ? 'Live API' : mode}</span>}
          />
          <div className="ax-health-body">
            <HealthRing score={analytics.health} />
            <ul className="ax-health-list">
              <li title="Faculty profiles loaded for the Department of English.">
                <span>Faculty in system</span>
                <strong>{analytics.teachers}</strong>
              </li>
              <li title="Share of catalog rooms that appear in at least one class slot.">
                <span>Rooms booked</span>
                <strong>{analytics.roomUtil}%</strong>
              </li>
              <li title="Share of all class slots marked Online (not onsite).">
                <span>Online classes</span>
                <strong>
                  {tt.length ? Math.round((analytics.online / tt.length) * 100) : 0}%
                </strong>
              </li>
              <li title="Day + hour with the most class starts across Sat–Fri.">
                <span>Busiest slot</span>
                <strong>
                  {analytics.peakHour.day} {String(analytics.peakHour.hour).padStart(2, '0')}:00
                </strong>
              </li>
            </ul>
          </div>
          <p className="ax-explain ax-explain--foot">
            Score formula: 100 − clash penalty − cancel penalty (capped). Use Conflicts page to fix
            remaining clashes.
          </p>
        </section>

        <section className="card pad ax-panel">
          <PanelTitle
            title="Happening now"
            explain="Live list of English classes currently in session (matched to today’s day code and the clock). Up next = today’s remaining starts."
            badge={
              <span className="ax-pulse-pill">
                <span className="ax-pulse" />
                {analytics.live.length} live
              </span>
            }
          />
          {analytics.live.length === 0 ? (
            <p className="muted ax-empty">No class in session right now.</p>
          ) : (
            <div className="ax-live-list">
              {analytics.live.map((e) => (
                <div key={e.id} className="ax-live-row">
                  <div className="ax-live-time">
                    {formatTime(e.start_time)}–{formatTime(e.end_time)}
                  </div>
                  <div>
                    <strong>
                      {e.course_code} · {e.teacher_initial}
                    </strong>
                    <p>
                      {batchById(e.batch_id)?.name || e.batch_id}
                      {e.group_name ? ` · ${e.group_name}` : ''} ·{' '}
                      {e.mode === 'Online' ? 'Online' : roomById(e.room_id)?.name || e.room_id || '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {analytics.upcoming.length > 0 && (
            <>
              <h4 className="ax-subhead">Up next today</h4>
              <div className="ax-live-list dim">
                {analytics.upcoming.map((e) => (
                  <div key={e.id} className="ax-live-row">
                    <div className="ax-live-time">
                      {formatTime(e.start_time)}–{formatTime(e.end_time)}
                    </div>
                    <div>
                      <strong>
                        {e.course_code} · {e.teacher_initial}
                      </strong>
                      <p>{batchById(e.batch_id)?.name || e.batch_id}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="card pad ax-panel">
          <PanelTitle
            title="Weekly radar"
            explain="How many classes fall on each weekday (Sat–Fri). Longer spike = heavier teaching day. Today’s day is highlighted."
          />
          <RadarChart
            values={daySeries}
            labels={[...DAYS]}
            highlightIndex={DAYS.indexOf(today)}
          />
        </section>

        <section className="card pad ax-panel">
          <PanelTitle
            title="Class mix"
            explain="Left donut: Lecture / Tutorial / Sessional / Online type split. Right donut: Onsite vs Offline vs Online delivery mode. Helps show how the week is structured."
          />
          <div className="ax-mix">
            <div>
              <Donut
                segments={typeSegs}
                centerLabel={String(analytics.active)}
                centerSub="by type"
              />
              <div className="ax-legend">
                {typeSegs.map((s) => (
                  <span key={s.label}>
                    <i style={{ background: s.color }} />
                    {s.label} ({s.value})
                  </span>
                ))}
              </div>
              <p className="ax-explain">Session type count (active slots).</p>
            </div>
            <div>
              <Donut
                segments={modeSegs}
                centerLabel={String(tt.length)}
                centerSub="by mode"
              />
              <div className="ax-legend">
                {modeSegs.map((s) => (
                  <span key={s.label}>
                    <i style={{ background: s.color }} />
                    {s.label} ({s.value})
                  </span>
                ))}
              </div>
              <p className="ax-explain">Delivery mode across all timetable rows.</p>
            </div>
          </div>
        </section>
      </div>

      <div className="ax-unique-grid">
        <section className="card pad ax-panel ax-unique-wide">
          <PanelTitle
            title="Routine wave"
            explain="Same weekday totals as the radar, drawn as a smooth weekly rhythm so stakeholders can see peaks and quiet days at a glance."
          />
          <WaveAreaChart
            values={daySeries}
            labels={[...DAYS]}
            highlightIndex={DAYS.indexOf(today)}
          />
        </section>

        <section className="card pad ax-panel">
          <PanelTitle
            title="Teacher orbit"
            explain="Top loaded faculty initials. Larger “planet” = more assigned class slots this week (teaching load)."
          />
          <OrbitMap items={analytics.teacherLoad} />
        </section>

        <section className="card pad ax-panel">
          <PanelTitle
            title="Day clock"
            explain="Petal length = how many classes start in that hour (09:00–16:00), summed across the whole week. Shows when campus is busiest."
          />
          <ClockPetals hours={analytics.hourProfile} />
          <p className="muted" style={{ textAlign: 'center', marginTop: 8, fontSize: 12 }}>
            Peak {analytics.peakHour.day} · {String(analytics.peakHour.hour).padStart(2, '0')}:00 (
            {analytics.hourProfile[analytics.peakHour.hour - 9] || 0} classes)
          </p>
        </section>
      </div>

      <section className="card pad ax-panel">
        <PanelTitle
          title="Weekly heat map"
          explain="Grid of day × start hour. Darker cell = more classes begin in that hour on that day. Useful for finding overcrowded periods before adding new courses."
        />
        <div className="ax-heat">
          <div className="ax-heat-row head">
            <div className="ax-heat-day" />
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="ax-heat-h">
                {String(9 + i).padStart(2, '0')}
              </div>
            ))}
          </div>
          {DAYS.map((d) => (
            <div key={d} className="ax-heat-row">
              <div className={`ax-heat-day${d === today ? ' today' : ''}`}>{d}</div>
              {analytics.hourHeat[d].map((count, i) => {
                const intensity = count / heatMax;
                return (
                  <div
                    key={`${d}-${i}`}
                    className="ax-heat-cell"
                    title={`${d} ${9 + i}:00 — ${count} class(es) start`}
                    style={{
                      background: `color-mix(in srgb, var(--primary) ${Math.round(intensity * 85)}%, var(--surface))`,
                    }}
                  >
                    {count || ''}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      <div className="ax-bottom-grid">
        <section className="card pad ax-panel">
          <PanelTitle
            title={
              <>
                <Users size={16} /> Teacher load
              </>
            }
            explain="Bar length = number of class slots assigned to each teacher initial (top 8). High bars may need redistribution."
          />
          <AnimatedBars items={analytics.teacherLoad} color="var(--grad)" />
        </section>
        <section className="card pad ax-panel">
          <PanelTitle
            title={
              <>
                <DoorOpen size={16} /> Room pressure
              </>
            }
            explain="Which rooms host the most classes. High bars = heavy room use; check free-room tools before booking more."
          />
          <AnimatedBars items={analytics.roomUse} color="#32ade6" />
        </section>
        <section className="card pad ax-panel">
          <PanelTitle
            title={
              <>
                <GraduationCap size={16} /> Batch volume
              </>
            }
            explain="Class slots per batch. Hint shows enrolled student count so load can be compared with cohort size."
          />
          <AnimatedBars items={analytics.batchBars} color="#34c759" />
        </section>
      </div>

      {analytics.conflicts.length > 0 && (
        <section className="card pad ax-panel ax-conflict-panel">
          <PanelTitle
            title={
              <>
                <AlertTriangle size={16} /> Live conflict feed
              </>
            }
            explain="Detected clashes (same teacher, room, or batch overlapping in time). Open the Conflicts page to resolve each item."
          />
          <ul className="ax-conflict-feed">
            {analytics.conflicts.slice(0, 8).map((c, i) => (
              <li key={`${c.kind}-${c.resource}-${i}`}>
                <span className={`ax-tag ${c.kind}`}>{c.kind}</span>
                <span>
                  {c.day} {formatTime(c.start_time)}–{formatTime(c.end_time)} · {c.message}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
