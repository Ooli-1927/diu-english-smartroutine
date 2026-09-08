import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Briefcase,
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  GraduationCap,
  Mail,
  Phone,
  X,
} from 'lucide-react';
import { PageHero } from '../../components/PageHero';
import { UserAvatar } from '../../components/ProfileAvatar';
import { useData } from '../../context/DataContext';
import { ScheduleCard } from '../../components/ScheduleCard';
import { SearchBox } from '../../components/SearchBox';
import { formatTime, todayDay } from '../../lib/constants';
import type { Teacher } from '../../lib/types';
import { useOfficeHours } from '../../hooks/useOfficeHours';

export function TeacherLookupPage() {
  const { store } = useData();
  const { slots: allSlots } = useOfficeHours();
  const [query, setQuery] = useState('');
  const [openInitial, setOpenInitial] = useState<string | null>(null);
  const day = todayDay();

  const hoursByTeacher = useMemo(() => {
    const map = new Map<string, typeof allSlots>();
    for (const s of allSlots) {
      if (!s.is_active) continue;
      const list = map.get(s.teacher_initial) || [];
      list.push(s);
      map.set(s.teacher_initial, list);
    }
    return map;
  }, [allSlots]);

  const teachers = useMemo(() => {
    const list = [...(store?.teachers || [])].sort((a, b) =>
      a.initial.localeCompare(b.initial),
    );
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) =>
      [t.initial, t.name, t.designation, t.email || '', t.home_department || ''].some((f) =>
        f.toLowerCase().includes(q),
      ),
    );
  }, [store, query]);

  const classesToday = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of store?.timetable || []) {
      if (e.day !== day || e.is_cancelled) continue;
      map.set(e.teacher_initial, (map.get(e.teacher_initial) || 0) + 1);
    }
    return map;
  }, [store, day]);

  const teachingToday = useMemo(
    () => [...classesToday.values()].filter((n) => n > 0).length,
    [classesToday],
  );

  function scheduleFor(teacher: Teacher) {
    return (store?.timetable || [])
      .filter((e) => e.teacher_initial === teacher.initial && e.day === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  return (
    <div className="page student-page student-page--teachers">
      <PageHero
        variant="page"
        kicker="Directory"
        title="Teachers"
        icon={<GraduationCap size={22} color="#fff" />}
        subtitle={`${store?.teachers.length || 0} faculty · ${teachingToday} teaching today · ${day}`}
      />

      <div className="faculty-kpi">
        <article className="faculty-kpi__card">
          <GraduationCap size={18} />
          <div>
            <strong>{store?.teachers.length || 0}</strong>
            <p>Faculty</p>
          </div>
        </article>
        <article className="faculty-kpi__card is-live">
          <Briefcase size={18} />
          <div>
            <strong>{teachingToday}</strong>
            <p>On duty today</p>
          </div>
        </article>
        <article className="faculty-kpi__card">
          <Building2 size={18} />
          <div>
            <strong>English</strong>
            <p>Department</p>
          </div>
        </article>
      </div>

      <div className="filter-bar faculty-filter card pad">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Filter by name, initial or department"
        />
        <div className="row-between result-line" style={{ margin: 0 }}>
          <span className="muted">
            Showing {teachers.length} of {store?.teachers.length || 0} teachers
          </span>
          {query && (
            <button type="button" className="btn-outline" onClick={() => setQuery('')}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {teachers.length === 0 && (
        <div className="empty-state">
          <p>No teacher matches this search</p>
        </div>
      )}

      <div className="teacher-directory">
        {teachers.map((t) => {
          const open = openInitial === t.initial;
          const todayCount = classesToday.get(t.initial) || 0;
          const entries = open ? scheduleFor(t) : [];
          const office = hoursByTeacher.get(t.initial) || [];

          return (
            <article key={t.id} className="card teacher-card">
              <div className="teacher-card__top">
                <UserAvatar src={t.profile_pic} name={t.name} className="md" />
                <div className="teacher-card__info">
                  <div className="row-between">
                    <strong>{t.name}</strong>
                    <span className="initial-badge">{t.initial}</span>
                  </div>
                  <p className="muted">{t.designation}</p>
                  {t.home_department && (
                    <p className="small">{t.home_department}</p>
                  )}
                </div>
              </div>

              <div className="chip-row wrap">
                {t.phone && (
                  <a className="chip" href={`tel:${t.phone}`}>
                    <Phone size={14} /> {t.phone}
                  </a>
                )}
                {t.email && (
                  <a className="chip" href={`mailto:${t.email}`}>
                    <Mail size={14} /> {t.email}
                  </a>
                )}
                <span className={`chip ${todayCount ? 'chip-online' : ''}`}>
                  {todayCount} class{todayCount === 1 ? '' : 'es'} today
                </span>
                {office.length ? (
                  <span className="chip chip-online">
                    Appointment schedule:{' '}
                    {office
                      .map((s) => `${s.day} ${formatTime(s.start_time)}–${formatTime(s.end_time)}`)
                      .join(' · ')}
                  </span>
                ) : (
                  <span className="chip">No appointment schedule</span>
                )}
              </div>

              <div className="teacher-card__actions">
                <button
                  type="button"
                  className="btn-outline sm"
                  onClick={() => setOpenInitial(open ? null : t.initial)}
                >
                  {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {open ? 'Hide schedule' : "Today's schedule"}
                </button>
                <Link
                  className="btn-primary sm"
                  to={`/student/appointments?teacher=${encodeURIComponent(t.initial)}`}
                >
                  <CalendarCheck size={14} /> Appointment
                </Link>
              </div>

              {open && (
                <div className="teacher-card__schedule">
                  {entries.length === 0 ? (
                    <p className="muted">No classes today</p>
                  ) : (
                    entries.map((e) => (
                      <ScheduleCard key={e.id} entry={e} showTeacher={false} />
                    ))
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
