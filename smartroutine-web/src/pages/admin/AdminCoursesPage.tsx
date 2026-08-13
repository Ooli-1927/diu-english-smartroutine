import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useData } from '../../context/DataContext';
import { uid } from '../../lib/constants';
import type { Course } from '../../lib/types';
import { PageHero } from '../../components/PageHero';
import { SearchBox } from '../../components/SearchBox';

export function AdminCoursesPage() {
  const { store, upsertCourse, deleteCourse } = useData();
  const [form, setForm] = useState({ id: '', code: '', title: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const courses = useMemo(() => {
    const list = store?.courses || [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (c) => c.code.toLowerCase().includes(term) || c.title.toLowerCase().includes(term),
    );
  }, [store, q]);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of store?.timetable || []) {
      counts.set(e.course_code, (counts.get(e.course_code) || 0) + 1);
    }
    return counts;
  }, [store]);

  function startEdit(course: Course) {
    setEditing(course.id);
    setForm({ id: course.id, code: course.code, title: course.title });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const course: Course = {
      id: editing || form.id || uid('course'),
      code: form.code.trim().toUpperCase(),
      title: form.title.trim(),
    };
    try {
      await upsertCourse(course, !editing);
      setForm({ id: '', code: '', title: '' });
      setEditing(null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save course');
    }
  }

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="Catalog · Curriculum"
        title="Courses"
        subtitle="Course codes and titles referenced across the weekly routine."
      />
      <form className="card pad row-3" onSubmit={onSubmit}>
        <input
          className="input"
          placeholder="Course code e.g. ET 118"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          required
        />
        <input
          className="input"
          placeholder="Course title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
        />
        <button className="btn-primary">
          {editing ? <Pencil size={16} /> : <Plus size={16} />}
          {editing ? 'Update' : 'Add Course'}
        </button>
      </form>
      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <SearchBox value={q} onChange={setQ} placeholder="Search course code or title" />
      </div>
      <div className="row-between result-line">
        <p className="muted small">
          Showing {courses.length} of {store?.courses.length || 0} courses
        </p>
      </div>

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Title</th>
              <th>Scheduled classes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {courses.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted center-cell">
                  No courses match this search
                </td>
              </tr>
            ) : (
              courses.map((c) => (
              <tr key={c.id}>
                <td>{c.code}</td>
                <td>{c.title}</td>
                <td className="muted">{usage.get(c.code) || 0}</td>
                <td className="row-gap">
                  <button className="icon-btn" onClick={() => startEdit(c)}>
                    <Pencil size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => {
                      if (window.confirm('Delete this course?')) void deleteCourse(c.id);
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
