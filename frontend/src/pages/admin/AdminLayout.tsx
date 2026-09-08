import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  CalendarRange,
  CircleUserRound,
  DoorOpen,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Users,
  GraduationCap,
  Layers,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { useNotifications } from '../../hooks/useNotifications';
import { findConflicts } from '../../lib/conflicts';
import { ThemeToggle } from '../../components/ThemeToggle';
import { PortalAlerts } from '../../components/PortalAlerts';
import { UserAvatar } from '../../components/ProfileAvatar';
import { BrandMark } from '../../components/BrandMark';
import { CampusAtmosphere } from '../../components/CampusAtmosphere';

type NavItem = {
  to: string;
  end?: boolean;
  label: string;
  icon: LucideIcon;
};

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [{ to: '/admin', end: true, label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'People & catalog',
    items: [
      { to: '/admin/batches', label: 'Batches', icon: Layers },
      { to: '/admin/students', label: 'Students', icon: GraduationCap },
      { to: '/admin/teachers', label: 'Teachers', icon: Users },
      { to: '/admin/courses', label: 'Courses', icon: BookOpen },
      { to: '/admin/rooms', label: 'Rooms', icon: DoorOpen },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admin/timetable', label: 'Timetable', icon: CalendarRange },
      { to: '/admin/conflicts', label: 'Conflicts', icon: AlertTriangle },
      { to: '/admin/generate', label: 'Generate', icon: Wand2 },
      { to: '/admin/lab', label: 'Lab', icon: FlaskConical },
      { to: '/admin/notices', label: 'Notices', icon: Bell },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/admin/profile', label: 'Profile', icon: CircleUserRound },
    ],
  },
];

const modeLabels: Record<string, string> = {
  api: 'Live API',
  supabase: 'Supabase',
  local: 'Offline demo',
  unknown: 'Connecting…',
};

export function AdminLayout() {
  const { session, logout } = useAuth();
  const { mode, store } = useData();
  const { unread } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const clashes = useMemo(() => findConflicts(store?.timetable || []).length, [store]);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  return (
    <>
      <CampusAtmosphere />
      <div
        className={`admin-shell ux-shell chairman-console${navOpen ? ' is-nav-open' : ''}`}
      >
        <header className="admin-mobile-bar">
          <button
            type="button"
            className="admin-menu-btn"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            aria-controls="admin-sidebar-nav"
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="admin-mobile-bar__brand">
            <BrandMark
              variant="compact"
              title="Chairman"
              className="admin-mobile-brand"
            />
          </div>
          <div className="admin-mobile-bar__tools">
            <PortalAlerts noticesTo="/admin/notices" />
            <UserAvatar
              src={session?.profilePic}
              name={session?.username || 'C'}
              className="sm ring"
            />
          </div>
        </header>

        <button
          type="button"
          className="admin-nav-backdrop"
          aria-label="Close menu"
          tabIndex={navOpen ? 0 : -1}
          onClick={() => setNavOpen(false)}
        />

        <aside className="admin-sidebar" id="admin-sidebar-nav">
          <div className="brand">
            <BrandMark
              variant="sidebar"
              title="Chairman Console"
              subtitle={session?.username || 'Super Admin'}
            />
            <UserAvatar
              src={session?.profilePic}
              name={session?.username || 'C'}
              className="sm ring brand-avatar"
            />
          </div>
          <div className="admin-sidebar__tools">
            <ThemeToggle />
            <PortalAlerts noticesTo="/admin/notices" />
          </div>
          <nav aria-label="Admin navigation">
            {navGroups.map((group) => (
              <div key={group.label} className="nav-group">
                <p className="nav-group__label">{group.label}</p>
                {group.items.map(({ to, end, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                    onClick={() => setNavOpen(false)}
                  >
                    <span className="nav-ico">
                      <Icon size={17} />
                    </span>
                    <span className="nav-label">{label}</span>
                    {label === 'Notices' && unread > 0 && (
                      <span className="nav-badge">{unread > 9 ? '9+' : unread}</span>
                    )}
                    {label === 'Conflicts' && clashes > 0 && (
                      <span className="nav-badge warn" title={`${clashes} scheduling clashes`}>
                        {clashes > 9 ? '9+' : clashes}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className={`backend-pill ${mode}`}>{modeLabels[mode]}</div>
            <p className="sidebar-dept">Department of English · DIU</p>
            <button
              className="btn-danger sidebar-logout"
              type="button"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </aside>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </>
  );
}
