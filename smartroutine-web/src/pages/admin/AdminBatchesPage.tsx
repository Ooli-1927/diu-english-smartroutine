import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { uid } from '../../lib/constants';
import type { Batch } from '../../lib/types';
import { sortRows, type SortDir } from '../../lib/sort';
import { PageHero } from '../../components/PageHero';
import { SearchBox } from '../../components/SearchBox';
import { SortControls, SortableHeaders, type SortColumn } from '../../components/TableSort';

type SortKey = 'name' | 'session' | 'students';

const columns: SortColumn<SortKey>[] = [
  { key: 'name', label: 'Name' },
  { key: 'session', label: 'Session' },
  { key: 'students', label: 'Students' },
];

export function AdminBatchesPage() {
  const { store, upsertBatch, deleteBatch } = useData();
  const [form, setForm] = useState({ id: '', name: '', session: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const counts = useMemo(() => {
    const students = new Map<string, number>();
    const classes = new Map<string, number>();
    for (const s of store?.students || []) {
      students.set(s.batch_id, (students.get(s.batch_id) || 0) + 1);
    }
    for (const e of store?.timetable || []) {
      classes.set(e.batch_id, (classes.get(e.batch_id) || 0) + 1);
    }
    return { students, classes };
  }, [store]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (store?.batches || []).filter((b) =>
      q ? [b.name, b.session, b.id].some((f) => f.toLowerCase().includes(q)) : true,
    );
    const value = (b: Batch) =>
      sortKey === 'session'
        ? b.session
        : sortKey === 'students'
          ? String(counts.students.get(b.id) || 0)
          : b.name;
    return sortRows(filtered, value, sortDir);
  }, [store, counts, query, sortKey, sortDir]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function startEdit(b: Batch) {
    setEditing(b.id);
    setForm({ id: b.id, name: b.name, session: b.session });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const batch: Batch = {
      id: editing || form.id || uid('batch'),
      name: form.name.trim(),
      session: form.session.trim(),
    };
    try {
      await upsertBatch(batch, !editing);
      setForm({ id: '', name: '', session: '' });
      setEditing(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save batch');
    }
  }

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="Catalog · Cohorts"
        title="Batches"
        subtitle="Program cohorts and academic sessions for enrollment and scheduling."
      />
      <form className="card pad row-3" onSubmit={onSubmit}>
        <input
          className="input"
          placeholder="Batch name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          className="input"
          placeholder="Session e.g. 2024-25"
          value={form.session}
          onChange={(e) => setForm({ ...form, session: e.target.value })}
          required
        />
        <button className="btn-primary">
          {editing ? <Pencil size={16} /> : <Plus size={16} />}
          {editing ? 'Update' : 'Add Batch'}
        </button>
      </form>
      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search batch name, session or ID"
        />
        <SortControls
          columns={columns}
          sortKey={sortKey}
          sortDir={sortDir}
          onKey={setSortKey}
          onDir={setSortDir}
        />
      </div>

      <div className="row-between result-line">
        <span className="muted">
          Showing {list.length} of {store?.batches.length || 0} batches
        </span>
      </div>

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <SortableHeaders
                columns={columns}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={sortBy}
              />
              <th>Classes</th>
              <th>ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center-cell">
                  No batch matches this search.
                </td>
              </tr>
            )}
            {list.map((b) => (
              <tr key={b.id}>
                <td>{b.name}</td>
                <td>{b.session}</td>
                <td className="muted">{counts.students.get(b.id) || 0}</td>
                <td className="muted">{counts.classes.get(b.id) || 0}</td>
                <td className="muted">{b.id}</td>
                <td className="row-gap">
                  <button className="icon-btn" onClick={() => startEdit(b)}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => {
                      if (window.confirm('Delete batch and related data?')) void deleteBatch(b.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
