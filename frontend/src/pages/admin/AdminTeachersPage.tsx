import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { uid } from '../../lib/constants';
import type { Teacher } from '../../lib/types';
import { PageHero } from '../../components/PageHero';
import { SearchBox } from '../../components/SearchBox';

const emptyForm = {
  name: '',
  initial: '',
  designation: 'Lecturer',
  email: '',
  phone: '',
  home_department: 'English',
  password: '',
};

export function AdminTeachersPage() {
  const { store, upsertTeacher, deleteTeacher } = useData();
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const list = useMemo(() => {
    const teachers = store?.teachers || [];
    if (!q.trim()) return teachers;
    const s = q.toLowerCase();
    return teachers.filter(
      (t) =>
        t.name.toLowerCase().includes(s) ||
        t.initial.toLowerCase().includes(s) ||
        (t.email || '').toLowerCase().includes(s) ||
        t.designation.toLowerCase().includes(s),
    );
  }, [store, q]);

  const editing = Boolean(editingId);

  function startEdit(t: Teacher) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      initial: t.initial,
      designation: t.designation,
      email: t.email || '',
      phone: t.phone || '',
      home_department: t.home_department,
      password: '',
    });
    setError('');
    setMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMsg('');
    const initial = form.initial.trim().toUpperCase();
    const existing = editingId
      ? store?.teachers.find((x) => x.id === editingId)
      : undefined;
    const passwordChanged = Boolean(form.password.trim());
    const teacher: Teacher = {
      id: editingId || uid('tch'),
      name: form.name.trim(),
      initial,
      designation: form.designation.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      home_department: form.home_department.trim(),
      profile_pic: existing?.profile_pic || null,
      password: passwordChanged
        ? form.password.trim()
        : editing
          ? null
          : `${initial}123`,
      has_changed_password: passwordChanged
        ? false
        : (existing?.has_changed_password ?? false),
    };
    try {
      await upsertTeacher(teacher, !editing);
      setForm(emptyForm);
      setEditingId(null);
      setMsg(
        editing
          ? form.password.trim()
            ? 'Teacher updated — password was reset'
            : 'Teacher updated'
          : 'Teacher added with starting password',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save teacher');
    }
  }

  async function resetPassword(t: Teacher) {
    const fallback = `${t.initial.toUpperCase()}123`;
    const next = window.prompt(
      `New password for ${t.name} (${t.initial}) — after reset they may change once`,
      fallback,
    );
    if (!next || !next.trim()) return;
    try {
      await upsertTeacher(
        {
          ...t,
          password: next.trim(),
          has_changed_password: false,
        },
        false,
      );
      setMsg(`Password reset for ${t.initial}`);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    }
  }

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="People · Faculty"
        title="Teachers"
        subtitle="Dept sets the starting email and password. Teachers can change it from their profile; if they forget it, reset it here."
      />

      <form className="card pad grid-form" onSubmit={onSubmit}>
        <input
          className="input"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          className="input"
          placeholder="Initial"
          value={form.initial}
          onChange={(e) => setForm({ ...form, initial: e.target.value.toUpperCase() })}
          required
          disabled={editing}
          title={editing ? 'Initial cannot be changed while editing' : undefined}
        />
        <input
          className="input"
          placeholder="Designation"
          value={form.designation}
          onChange={(e) => setForm({ ...form, designation: e.target.value })}
          required
        />
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <input
          className="input"
          placeholder="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <input
          className="input"
          type="text"
          placeholder={
            editing
              ? 'New password (leave blank to keep)'
              : 'Password (optional — default INITIAL123)'
          }
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          autoComplete="new-password"
        />
        <div className="row-gap wrap form-span">
          <button className="btn-primary" style={{ width: 'auto' }}>
            {editing ? <Pencil size={16} /> : <Plus size={16} />}
            {editing ? 'Update Teacher' : 'Add Teacher'}
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
        <SearchBox value={q} onChange={setQ} placeholder="Search teachers..." />
      </div>
      <div className="row-between result-line">
        <p className="muted small">
          Showing {list.length} of {store?.teachers.length || 0} teachers
        </p>
      </div>

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Initial</th>
              <th>Name</th>
              <th>Designation</th>
              <th>Email</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted center-cell">
                  No teachers match this search
                </td>
              </tr>
            ) : (
              list.map((t) => (
              <tr key={t.id} className={editingId === t.id ? 'row-editing' : ''}>
                <td>
                  <strong>{t.initial}</strong>
                </td>
                <td>{t.name}</td>
                <td>{t.designation}</td>
                <td>{t.email || '—'}</td>
                <td className="row-gap">
                  <button
                    className="icon-btn"
                    title="Edit email / details"
                    onClick={() => startEdit(t)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Reset password"
                    onClick={() => void resetPassword(t)}
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete"
                    onClick={() => {
                      if (window.confirm('Delete teacher?')) void deleteTeacher(t.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
