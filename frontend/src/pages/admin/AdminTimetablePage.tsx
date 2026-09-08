import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Download, FileUp, Plus, Trash2, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { CLASS_MODES, CLASS_TYPES, DAYS } from '../../lib/constants';
import { exportTimetablePdf } from '../../lib/pdf';
import { parseRoutineFile, resolveRoutineImport } from '../../lib/routineImport';
import {
  conflictLabel,
  conflictMessages,
  conflictsWith,
  findConflicts,
} from '../../lib/conflicts';
import type { ClassMode, ClassType, DayCode } from '../../lib/types';
import { ConflictPanel } from '../../components/ConflictPanel';
import { PageHero } from '../../components/PageHero';
import { ScheduleCard } from '../../components/ScheduleCard';
import { SearchableSelect } from '../../components/SearchableSelect';
import { SearchBox } from '../../components/SearchBox';

const emptyForm = {
  day: 'Sat' as DayCode,
  batch_id: '',
  teacher_initial: '',
  course_code: '',
  type: 'Lecture' as ClassType,
  section: '',
  group_name: '',
  room_id: '',
  mode: 'Onsite' as ClassMode,
  start_time: '09:00',
  end_time: '10:15',
};

export function AdminTimetablePage() {
  const {
    store,
    addTimetableEntry,
    deleteTimetableEntry,
    deleteTimetableEntries,
    importTimetable,
    seedImportEntities,
    courseByCode,
    teacherByInitial,
    batchById,
    roomById,
  } = useData();
  const [params, setParams] = useSearchParams();
  const focusId = params.get('focus');
  const [day, setDay] = useState<DayCode | 'All'>((params.get('day') as DayCode) || 'All');
  const [q, setQ] = useState('');
  const [batchFilter, setBatchFilter] = useState('all');
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [blocked, setBlocked] = useState<string[]>([]);
  const [headerCompact, setHeaderCompact] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
  const heroWrapRef = useRef<HTMLDivElement>(null);
  const [dockStyle, setDockStyle] = useState<CSSProperties | undefined>();
  const [spacerH, setSpacerH] = useState(0);

  const totalClasses = store?.timetable.length || 0;

  const entries = useMemo(() => {
    const list = store?.timetable || [];
    const term = q.trim().toLowerCase();
    const filtered = list.filter((e) => {
      if (day !== 'All' && e.day !== day) return false;
      if (batchFilter !== 'all' && e.batch_id !== batchFilter) return false;
      if (!term) return true;
      const course = courseByCode(e.course_code);
      const teacher = teacherByInitial(e.teacher_initial);
      const batch = batchById(e.batch_id);
      const room = roomById(e.room_id);
      const hay = [
        e.course_code,
        course?.title,
        e.teacher_initial,
        teacher?.name,
        batch?.name,
        e.batch_id,
        room?.name,
        e.room_id,
        e.type,
        e.mode,
        e.group_name,
        e.section,
        e.day,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(term);
    });
    return [...filtered].sort((a, b) =>
      a.day === b.day
        ? a.start_time.localeCompare(b.start_time)
        : DAYS.indexOf(a.day) - DAYS.indexOf(b.day),
    );
  }, [store, day, batchFilter, q, courseByCode, teacherByInitial, batchById, roomById]);

  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(entries.map((e) => e.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  const allVisibleSelected =
    entries.length > 0 && entries.every((e) => selected.has(e.id));
  const someVisibleSelected = entries.some((e) => selected.has(e.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      if (entries.length === 0) return prev;
      if (entries.every((e) => prev.has(e.id))) {
        const next = new Set(prev);
        for (const e of entries) next.delete(e.id);
        return next;
      }
      const next = new Set(prev);
      for (const e of entries) next.add(e.id);
      return next;
    });
  };

  const onBulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length || bulkBusy) return;
    const ok = window.confirm(
      `Delete ${ids.length} selected class${ids.length === 1 ? '' : 'es'}?\n\nThis cannot be undone. Students will not get individual remove emails for bulk delete.`,
    );
    if (!ok) return;
    setBulkBusy(true);
    setError('');
    setMsg('');
    try {
      const deleted = await deleteTimetableEntries(ids);
      setSelected(new Set());
      setMsg(`Deleted ${deleted} class${deleted === 1 ? '' : 'es'}. You can add the new semester routine now.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const onClearEntireTimetable = async () => {
    const allIds = (store?.timetable || []).map((e) => e.id);
    if (!allIds.length || bulkBusy) return;
    const ok = window.confirm(
      `Clear the ENTIRE timetable (${allIds.length} classes)?\n\nUse this before manually building a new semester. This cannot be undone.`,
    );
    if (!ok) return;
    setBulkBusy(true);
    setError('');
    setMsg('');
    try {
      const deleted = await deleteTimetableEntries(allIds);
      setSelected(new Set());
      setMsg(`Cleared ${deleted} classes. Timetable is empty — add new classes with Add.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear timetable');
    } finally {
      setBulkBusy(false);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<DayCode, typeof entries>();
    for (const e of entries) {
      const bucket = map.get(e.day) || [];
      bucket.push(e);
      map.set(e.day, bucket);
    }
    return DAYS.map((d) => ({ day: d, items: map.get(d) || [] })).filter((g) => g.items.length > 0);
  }, [entries]);

  const conflicts = useMemo(() => findConflicts(store?.timetable || []), [store]);
  const dayConflicts = useMemo(
    () => (day === 'All' ? conflicts : conflicts.filter((c) => c.day === day)),
    [conflicts, day],
  );
  const clashNote = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of dayConflicts) {
      const [a, b] = c.entries;
      if (!a || !b) continue;
      const noteA = `Clashes with ${b.batch_id} ${b.course_code} (${conflictLabel(c.kind)})`;
      const noteB = `Clashes with ${a.batch_id} ${a.course_code} (${conflictLabel(c.kind)})`;
      map.set(a.id, map.has(a.id) ? `${map.get(a.id)}; ${noteA}` : noteA);
      map.set(b.id, map.has(b.id) ? `${map.get(b.id)}; ${noteB}` : noteB);
    }
    return map;
  }, [dayConflicts]);

  const filtersActive = Boolean(q.trim()) || batchFilter !== 'all' || day !== 'All';

  useEffect(() => {
    const linkedDay = params.get('day') as DayCode | null;
    if (linkedDay) setDay(linkedDay);
  }, [params]);

  useEffect(() => {
    if (!focusId || !entries.some((e) => e.id === focusId)) return;
    document
      .getElementById(`entry-${focusId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusId, entries]);

  useEffect(() => {
    if (!showForm) return;
    const id = window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(id);
  }, [showForm]);

  useEffect(() => {
    const sentinel = stickySentinelRef.current;
    if (!sentinel) return;

    const syncDock = () => {
      const wrap = heroWrapRef.current;
      const page = wrap?.closest('.admin-page') as HTMLElement | null;
      if (!wrap || !page) return;
      const past = sentinel.getBoundingClientRect().top < 8;
      setHeaderCompact(past);
      if (!past) {
        setDockStyle(undefined);
        setSpacerH(0);
      }
    };

    syncDock();
    window.addEventListener('scroll', syncDock, { passive: true });
    window.addEventListener('resize', syncDock);
    return () => {
      window.removeEventListener('scroll', syncDock);
      window.removeEventListener('resize', syncDock);
    };
  }, []);

  useLayoutEffect(() => {
    const place = () => {
      const wrap = heroWrapRef.current;
      const page = wrap?.closest('.admin-page') as HTMLElement | null;
      const hero = wrap?.querySelector('.page-hero') as HTMLElement | null;
      if (!wrap || !page || !hero) return;

      if (!headerCompact) {
        setDockStyle(undefined);
        setSpacerH(0);
        return;
      }

      const pageRect = page.getBoundingClientRect();
      setSpacerH(hero.offsetHeight + 12);
      setDockStyle({
        position: 'fixed',
        top: 10,
        left: pageRect.left,
        width: pageRect.width,
        zIndex: 240,
        margin: 0,
      });
    };

    place();
    if (!headerCompact) return;
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [headerCompact]);

  function toggleAddForm() {
    setShowForm((open) => {
      if (open) return false;
      setError('');
      setBlocked([]);
      return true;
    });
  }

  function changeDay(next: DayCode | 'All') {
    setDay(next);
    if (params.has('focus') || params.has('day')) setParams({}, { replace: true });
  }

  function clearFilters() {
    setQ('');
    setBatchFilter('all');
    setDay('All');
    if (params.has('focus') || params.has('day')) setParams({}, { replace: true });
  }

  const teacherOptions = useMemo(
    () =>
      (store?.teachers || []).map((t) => ({
        value: t.initial,
        label: `${t.initial} — ${t.name}`,
        searchText: `${t.initial} ${t.name}`,
      })),
    [store?.teachers],
  );

  const draftConflicts = useMemo(() => {
    if (!showForm || !store || !form.batch_id || !form.teacher_initial) return [];
    return conflictsWith(
      {
        ...form,
        section: form.section || form.group_name || null,
        group_name: form.section || form.group_name || null,
        room_id: form.room_id || null,
        is_cancelled: false,
        cancellation_reason: null,
      },
      store.timetable,
    );
  }, [showForm, store, form]);

  async function save(force: boolean) {
    await addTimetableEntry(
      {
        ...form,
        section: form.section || form.group_name || null,
        group_name: form.section || form.group_name || null,
        room_id: form.room_id || null,
        is_cancelled: false,
        cancellation_reason: null,
      },
      { force },
    );
    setForm(emptyForm);
    setShowForm(false);
    setError('');
    setBlocked([]);
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    try {
      await save(false);
    } catch (err) {
      const clashes = conflictMessages(err);
      if (clashes) {
        setBlocked(clashes);
        setError('');
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not add class');
    }
  }

  async function onForceAdd() {
    try {
      await save(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add class');
    }
  }

  function exportPdf() {
    if (!store) return;
    exportTimetablePdf(store, store.timetable, 'DIU English Timetable');
  }

  async function onImportFile(file: File) {
    if (!store) return;
    setError('');
    setMsg('');
    setImporting(true);
    try {
      const parsed = await parseRoutineFile(file);
      if (!parsed.drafts.length) throw new Error('No class rows found in this file');

      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const replace = window.confirm(
        isPdf
          ? `Replace the entire website timetable with this PDF (${parsed.drafts.length} classes)?\n\nStudent portal, teacher portal, free/busy rooms, and conflict checks will all follow the new routine.`
          : `Found ${parsed.drafts.length} classes.\n\nOK = replace entire timetable\nCancel = append to existing`,
      );

      if (isPdf && !replace) {
        setMsg('Import cancelled');
        return;
      }
      const doReplace = isPdf ? true : replace;

      const resolved = resolveRoutineImport(store, parsed.drafts, {
        courseTitles: parsed.courseTitles,
      });

      await seedImportEntities(resolved.createdCourses, resolved.createdRooms);

      if (!resolved.entries.length) {
        throw new Error(
          resolved.rejected.length
            ? `Nothing imported. ${resolved.rejected
                .slice(0, 3)
                .map((r) => `Row ${r.row}: ${r.reason}`)
                .join(' · ')}`
            : 'Nothing imported',
        );
      }

      const result = await importTimetable(resolved.entries, doReplace);
      const extraReject = resolved.rejected.length;
      const parts = [
        doReplace ? 'Replaced site timetable' : 'Appended to timetable',
        `${result.imported} classes live`,
      ];
      if (resolved.createdCourses.length) {
        parts.push(`${resolved.createdCourses.length} new course(s)`);
      }
      if (resolved.createdRooms.length) {
        parts.push(`${resolved.createdRooms.length} new room(s)`);
      }
      if (result.rejected || extraReject) {
        parts.push(`${(result.rejected || 0) + extraReject} row(s) skipped`);
      }
      setMsg(parts.join(' · '));
      setDay('All');
      setQ('');
      setBatchFilter('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      className={`admin-page admin-page--timetable${headerCompact ? ' is-header-docked' : ''}`}
    >
      <div ref={stickySentinelRef} className="tt-sticky-sentinel" aria-hidden />
      {headerCompact ? (
        <div className="tt-sticky-spacer" style={{ height: spacerH }} aria-hidden />
      ) : null}
      <div ref={heroWrapRef} className="tt-hero-wrap" style={dockStyle}>
        <PageHero
          variant="admin"
          className={`page-hero--sticky${headerCompact ? ' is-compact is-docked' : ''}`}
          kicker="Operations · Schedule"
          title="Timetable"
          subtitle={
            headerCompact
              ? undefined
              : 'Search any teacher, course or room · filter by day/batch · PDF & Import stay pinned while you scroll.'
          }
          actions={
            <div className="page-actions">
              <button
                type="button"
                className="btn-outline"
                onClick={exportPdf}
                title="Download full routine as PDF"
              >
                <Download size={16} /> PDF
              </button>
              <label
                className={`btn-outline file-btn${importing ? ' disabled' : ''}`}
                title="Upload semester PDF / JSON / CSV — updates whole site"
              >
                <FileUp size={16} /> {importing ? 'Importing…' : 'Import'}
                <input
                  type="file"
                  accept=".pdf,.json,.csv,application/pdf,text/csv,application/json"
                  hidden
                  disabled={importing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void onImportFile(f);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn-outline danger"
                disabled={bulkBusy || totalClasses === 0}
                onClick={() => void onClearEntireTimetable()}
                title="Remove every class (new semester reset)"
              >
                <Trash2 size={16} /> Clear all
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={toggleAddForm}
                aria-expanded={showForm}
                title={showForm ? 'Close add form' : 'Add a class'}
              >
                {showForm ? <X size={16} /> : <Plus size={16} />}
                {showForm ? 'Close' : 'Add'}
              </button>
            </div>
          }
        />
      </div>

      {error && <div className="error-banner">{error}</div>}
      {msg && <div className="success-banner">{msg}</div>}

      {showForm && (
        <form
          ref={formRef}
          id="tt-add-form"
          className="card pad grid-form tt-add-form"
          onSubmit={onAdd}
        >
          <select
            className="input"
            value={form.day}
            onChange={(e) => setForm({ ...form, day: e.target.value as DayCode })}
          >
            {DAYS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <select
            className="input"
            value={form.batch_id}
            onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
            required
          >
            <option value="">Batch</option>
            {store?.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <SearchableSelect
            options={teacherOptions}
            value={form.teacher_initial}
            onChange={(teacher_initial) => setForm({ ...form, teacher_initial })}
            placeholder="Search teacher by full name…"
            required
            emptyLabel="No teacher matches that name"
          />
          <select
            className="input"
            value={form.course_code}
            onChange={(e) => setForm({ ...form, course_code: e.target.value })}
            required
          >
            <option value="">Course</option>
            {store?.courses.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ClassType })}
          >
            {CLASS_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            className="input"
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value as ClassMode })}
          >
            {CLASS_MODES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            className="input"
            type="time"
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            required
          />
          <input
            className="input"
            type="time"
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            required
          />
          <select
            className="input"
            value={form.room_id}
            onChange={(e) => setForm({ ...form, room_id: e.target.value })}
          >
            <option value="">Room (optional)</option>
            {store?.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Section (A–G)"
            value={form.section || form.group_name}
            onChange={(e) =>
              setForm({
                ...form,
                section: e.target.value.toUpperCase(),
                group_name: e.target.value.toUpperCase(),
              })
            }
            maxLength={2}
          />
          <button className="btn-primary">Save Entry</button>

          {draftConflicts.length > 0 && blocked.length === 0 && (
            <div className="warn-banner form-span">
              <AlertTriangle size={16} />
              <div>
                <strong>
                  This slot already has {draftConflicts.length} clash
                  {draftConflicts.length === 1 ? '' : 'es'}
                </strong>
                <ul>
                  {draftConflicts.map((c, i) => (
                    <li key={i}>{c.message}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {blocked.length > 0 && (
            <div className="warn-banner blocked form-span">
              <AlertTriangle size={16} />
              <div>
                <strong>Not saved — this class clashes with the routine</strong>
                <ul>
                  {blocked.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                <div className="row-gap">
                  <button type="button" className="btn-outline danger" onClick={onForceAdd}>
                    Save anyway
                  </button>
                  <button type="button" className="btn-outline" onClick={() => setBlocked([])}>
                    Change the slot
                  </button>
                </div>
              </div>
            </div>
          )}
        </form>
      )}

      <div className="tt-toolbar card">
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="Search teacher, course, code, batch, room…"
        />
        <select
          className="input tt-batch-filter"
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
          aria-label="Filter by batch"
        >
          <option value="all">All batches</option>
          {store?.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="day-pills dark tt-day-pills">
          <button
            type="button"
            className={day === 'All' ? 'active' : ''}
            onClick={() => changeDay('All')}
          >
            All
          </button>
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              className={day === d ? 'active' : ''}
              onClick={() => changeDay(d)}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="tt-toolbar__meta">
          <p className="muted small">
            Showing <strong>{entries.length}</strong> of {totalClasses}
          </p>
          {filtersActive && (
            <button type="button" className="btn-outline sm" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {dayConflicts.length > 0 ? (
        <ConflictPanel
          conflicts={conflicts}
          dayFilter={day}
          title={day === 'All' ? 'Conflict checker' : `Conflict checker · ${day}`}
        />
      ) : conflicts.length > 0 && day !== 'All' ? (
        <div className="tt-conflict-link ok" role="status">
          <AlertTriangle size={18} />
          <div>
            <strong>No clashes on {day}</strong>
            <span className="muted">
              {conflicts.length} clash{conflicts.length === 1 ? '' : 'es'} on other days
            </span>
          </div>
          <Link to="/admin/conflicts" className="tt-conflict-link__go">
            All clashes
          </Link>
        </div>
      ) : null}

      {entries.length > 0 && (
        <div className="tt-select-bar card pad">
          <label className="tt-select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected;
              }}
              onChange={toggleSelectAllVisible}
            />
            <span>
              Select all shown ({entries.length}
              {filtersActive ? ' filtered' : ''})
            </span>
          </label>
          <div className="tt-select-bar__actions">
            {selected.size > 0 && (
              <span className="muted small">
                {selected.size} selected
              </span>
            )}
            <button
              type="button"
              className="btn-outline danger sm"
              disabled={selected.size === 0 || bulkBusy}
              onClick={() => void onBulkDelete()}
            >
              <Trash2 size={14} />
              {bulkBusy ? 'Deleting…' : `Delete selected${selected.size ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </div>
      )}

      <div className="page-content tt-list">
        {entries.length === 0 ? (
          <div className="empty-state tt-empty">
            <p>No classes match this search or filter.</p>
            {filtersActive && (
              <button type="button" className="btn-outline sm" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          grouped.map(({ day: groupDay, items }) => (
            <section key={groupDay} className="tt-day-group">
              <header className="tt-day-group__head">
                <strong>{groupDay}</strong>
                <span className="muted">
                  {items.length} class{items.length === 1 ? '' : 'es'}
                </span>
              </header>
              {items.map((e) => (
                <div
                  key={e.id}
                  id={`entry-${e.id}`}
                  className={`tt-entry-row${focusId === e.id ? ' focus-ring' : ''}${
                    selected.has(e.id) ? ' is-selected' : ''
                  }`}
                >
                  <label className="tt-entry-check">
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggleSelect(e.id)}
                      aria-label={`Select ${e.course_code} on ${e.day}`}
                    />
                  </label>
                  <div className="tt-entry-card">
                    <ScheduleCard
                      entry={e}
                      warning={clashNote.get(e.id)}
                      actions={
                        <button
                          className="btn-outline danger sm"
                          onClick={() => {
                            if (window.confirm('Delete this class?')) {
                              void deleteTimetableEntry(e.id);
                              setSelected((prev) => {
                                if (!prev.has(e.id)) return prev;
                                const next = new Set(prev);
                                next.delete(e.id);
                                return next;
                              });
                            }
                          }}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      }
                    />
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
