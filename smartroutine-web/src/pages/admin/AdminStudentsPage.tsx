import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { uid } from '../../lib/constants';
import type { Student } from '../../lib/types';
import { sortRows, type SortDir } from '../../lib/sort';
import { PageHero } from '../../components/PageHero';
import { SearchBox } from '../../components/SearchBox';
import { SortControls, SortableHeaders, type SortColumn } from '../../components/TableSort';

type SortKey = 'student_id' | 'name' | 'batch';

const columns: SortColumn<SortKey>[] = [
  { key: 'student_id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'batch', label: 'Batch' },
];

const emptyForm = {
  student_id: '',
  name: '',
  batch_id: '',
  email: '',
  password: '12345678',
};

export function AdminStudentsPage() {
  const { store, upsertStudent, deleteStudent, batchById } = useData();
  const [batchFilter, setBatchFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('student_id');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const batchNames = useMemo(
    () => new Map((store?.batches || []).map((b) => [b.id, b.name])),
    [store],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nameOf = (id: string) => batchNames.get(id) || id;

    const filtered = (store?.students || []).filter((s) => {
      if (batchFilter !== 'all' && s.batch_id !== batchFilter) return false;
      if (!q) return true;
      return [s.student_id, s.name, s.email || '', nameOf(s.batch_id)].some((field) =>
        field.toLowerCase().includes(q),
      );
    });

    const value = (s: Student) =>
      sortKey === 'batch' ? nameOf(s.batch_id) : sortKey === 'name' ? s.name : s.student_id;

    return sortRows(filtered, value, sortDir);
  }, [store, batchNames, batchFilter, query, sortKey, sortDir]);

  const total = store?.students.length || 0;
  const filtering = query.trim() !== '' || batchFilter !== 'all';
  const editing = Boolean(editingId);

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function resetFilters() {
    setQuery('');
    setBatchFilter('all');
  }

  function startEdit(s: Student) {
    setEditingId(s.id);
    setForm({
      student_id: s.student_id,
      name: s.name,
      batch_id: s.batch_id,
      email: s.email || '',
      password: '',
    });
    setError('');
    setMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...emptyForm, batch_id: form.batch_id });
    setError('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');

    if (!editing && !form.password.trim()) {
      setError('A starting password is required for new students');
      return;
    }

    const existing = editingId
      ? store?.students.find((s) => s.id === editingId)
      : undefined;
    const passwordChanged = Boolean(form.password.trim());
    const student: Student = {
      id: editingId || uid('stu'),
      student_id: form.student_id.trim(),
      name: form.name.trim(),
      batch_id: form.batch_id,
      email: form.email.trim() || null,
      phone: existing?.phone ?? null,
      profile_pic: existing?.profile_pic ?? null,
      password: form.password.trim() || null,
      has_changed_password: passwordChanged
        ? false
        : (existing?.has_changed_password ?? false),
    };

    try {
      await upsertStudent(student, !editing);
      setForm({ ...emptyForm, batch_id: form.batch_id });
      setEditingId(null);
      setMsg(
        editing
          ? form.password.trim()
            ? 'Student updated — password was reset'
            : 'Student updated'
          : 'Student added with starting password',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save student');
    }
  }

  async function resetPassword(s: Student) {
    const next = window.prompt(
      `New password for ${s.name} (${s.student_id}) — after reset they may change once`,
      '12345678',
    );
    if (!next || !next.trim()) return;
    try {
      await upsertStudent(
        {
          ...s,
          password: next.trim(),
          has_changed_password: false,
        },
        false,
      );
      setMsg(`Password reset for ${s.student_id}`);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    }
  }

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="People · Enrollment"
        title="Students"
        subtitle="Dept sets the starting email and password. Students can change it later from their profile; if they forget it, reset it here."
      />

      <form className="card pad grid-form" onSubmit={onSubmit}>
        <input
          className="input"
          placeholder="Student ID"
          value={form.student_id}
          onChange={(e) => setForm({ ...form, student_id: e.target.value })}
          required
        />
        <input
          className="input"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <select
          className="input"
          value={form.batch_id}
          onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
          required
        >
          <option value="">Select batch</option>
          {store?.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          className="input"
          type="text"
          placeholder={editing ? 'New password (leave blank to keep)' : 'Starting password'}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required={!editing}
          autoComplete="new-password"
        />
        <div className="row-gap wrap">
          <button className="btn-primary" style={{ width: 'auto' }}>
            {editing ? <Pencil size={16} /> : <Plus size={16} />}
            {editing ? 'Update Student' : 'Add Student'}
          </button>
          {editing && (
            <button type="button" className="btn-outline" onClick={cancelEdit}>
              Cancel edit
            </button>
          )}
        </div>
      </form>
      {error && <div className="error-banner">{error}</div>}
      {msg && <div className="success-banner">{msg}</div>}

      <div className="filter-bar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search by ID, name, email or batch"
        />
        <select
          className="input"
          value={batchFilter}
          onChange={(e) => setBatchFilter(e.target.value)}
        >
          <option value="all">All batches</option>
          {store?.batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
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
          Showing {list.length} of {total} students
        </span>
        {filtering && (
          <button className="btn-outline" onClick={resetFilters}>
            <X size={14} /> Clear filters
          </button>
        )}
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
              <th>Email</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center-cell">
                  No student matches this search.
                </td>
              </tr>
            )}
            {list.map((s) => (
              <tr key={s.id} className={editingId === s.id ? 'row-editing' : ''}>
                <td>{s.student_id}</td>
                <td>{s.name}</td>
                <td>{batchById(s.batch_id)?.name || s.batch_id}</td>
                <td>{s.email || '—'}</td>
                <td className="row-gap">
                  <button
                    className="icon-btn"
                    title="Edit email / details"
                    onClick={() => startEdit(s)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Reset password"
                    onClick={() => void resetPassword(s)}
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete"
                    onClick={() => {
                      if (window.confirm('Delete student?')) void deleteStudent(s.id);
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
