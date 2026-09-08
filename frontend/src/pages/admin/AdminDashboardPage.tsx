import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  FlaskConical,
  GraduationCap,
  Layers,
  Users,
} from 'lucide-react';
import { useData } from '../../context/DataContext';
import { findConflicts } from '../../lib/conflicts';
import { PageHero } from '../../components/PageHero';

export function AdminDashboardPage() {
  const { store, mode } = useData();
  const healthConflicts = useMemo(() => findConflicts(store?.timetable || []), [store]);
  const clashCount = healthConflicts.length;
  const stats = [
    { label: 'Batches', value: store?.batches.length || 0, icon: Layers, to: '/admin/batches' },
    { label: 'Students', value: store?.students.length || 0, icon: GraduationCap, to: '/admin/students' },
    { label: 'Teachers', value: store?.teachers.length || 0, icon: Users, to: '/admin/teachers' },
    {
      label: 'Classes',
      value: store?.timetable.length || 0,
      icon: CalendarRange,
      to: '/admin/timetable',
    },
  ];

  return (
    <div className="admin-page">
      <PageHero
        variant="admin"
        kicker="Operations · Overview"
        title="Dashboard"
        subtitle={
          <>
            Official SmartRoutine for the Department of English at Daffodil International University
            — batches, people, classes and routine health · {mode === 'api' ? 'Live server' : mode}
            {clashCount > 0 ? (
              <>
                {' '}
                · <span className="text-warn">{clashCount} clash{clashCount === 1 ? '' : 'es'}</span>
              </>
            ) : null}
          </>
        }
        actions={
          <div className="page-actions">
            <Link className="btn-outline" to="/admin/analytics">
              <BarChart3 size={16} /> Analytics
            </Link>
            <Link className="btn-primary" to="/admin/timetable">
              <CalendarRange size={16} /> Timetable
            </Link>
          </div>
        }
      />

      <div className="stat-grid">
        {stats.map(({ label, value, icon: Icon, to }) => (
          <Link key={label} to={to} className="stat-card">
            <Icon size={22} />
            <div>
              <strong>{value}</strong>
              <p>{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {clashCount > 0 ? (
        <Link to="/admin/conflicts" className="tt-conflict-link warn">
          <AlertTriangle size={18} />
          <div>
            <strong>
              {clashCount} clash{clashCount === 1 ? '' : 'es'} in the routine
            </strong>
            <span className="muted">Open Conflict checker — only clash days are shown</span>
          </div>
          <span className="tt-conflict-link__go">Open</span>
        </Link>
      ) : (
        <Link to="/admin/conflicts" className="tt-conflict-link ok">
          <AlertTriangle size={18} />
          <div>
            <strong>Routine health looks clean</strong>
            <span className="muted">Open Conflict checker anytime</span>
          </div>
          <span className="tt-conflict-link__go">Open</span>
        </Link>
      )}

      <section className="card pad console-panel">
        <div className="console-panel__head">
          <div>
            <span className="brand-kicker">Shortcuts</span>
            <h3>Quick Actions</h3>
            <p className="muted">Jump into the most used chairman workflows.</p>
          </div>
        </div>
        <div className="quick-actions">
          <Link className="btn-primary" to="/admin/timetable">
            <CalendarRange size={16} /> Manage Timetable
          </Link>
          <Link className="btn-outline" to="/admin/lab">
            <FlaskConical size={16} /> Advanced Lab
          </Link>
          <Link className="btn-outline" to="/admin/students">
            <GraduationCap size={16} /> Add Student
          </Link>
          <Link className="btn-outline" to="/admin/teachers">
            <Users size={16} /> Manage Teachers
          </Link>
          <Link className="btn-outline" to="/admin/conflicts">
            <AlertTriangle size={16} /> Conflicts
          </Link>
          <Link className="btn-outline" to="/admin/analytics">
            <BarChart3 size={16} /> View Analytics
          </Link>
          <Link className="btn-outline" to="/admin/batches">
            <Layers size={16} /> Batches
          </Link>
        </div>
      </section>
    </div>
  );
}
