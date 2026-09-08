import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarDays,
  CircleUserRound,
  DoorOpen,
  School,
  Sparkles,
  UserSearch,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserAvatar } from '../../components/ProfileAvatar';
import { BrandMark } from '../../components/BrandMark';
import { CampusAtmosphere } from '../../components/CampusAtmosphere';
import { PortalAlerts } from '../../components/PortalAlerts';

const tabs = [
  { to: '/student', end: true, label: 'Schedule', icon: School },
  { to: '/student/teacher', label: 'Teacher', icon: UserSearch },
  { to: '/student/room', label: 'Room', icon: DoorOpen },
  { to: '/student/free', label: 'Free', icon: CalendarDays },
  { to: '/student/optimize', label: 'Optimize', icon: Sparkles },
  { to: '/student/profile', label: 'Profile', icon: CircleUserRound },
];

export function StudentLayout() {
  const { session } = useAuth();

  return (
    <>
      <CampusAtmosphere />
      <div className="app-shell student-shell ux-shell">
        <header className="student-topbar student-campus-bar">
          <div className="student-topbar__row">
            <div className="student-topbar__brand">
              <BrandMark
                variant="topbar"
                title="Student portal"
                subtitle={session?.name || 'Department of English'}
              />
            </div>
            <div className="student-topbar__mid" aria-hidden>
              <strong>Sapere Aude</strong>
              <span>Dare to be wise</span>
            </div>
            <div className="student-topbar__alerts">
              <PortalAlerts noticesTo="/student/notifications" />
            </div>
            <div className="student-topbar__photo">
              <UserAvatar
                src={session?.profilePic}
                name={session?.name || 'S'}
                className="student-hero-photo"
              />
              <p className="student-topbar__photo-caption">
                {session?.studentId || 'Student'}
              </p>
            </div>
          </div>
        </header>
        <div className="app-body">
          <Outlet />
        </div>
        <nav className="bottom-nav" aria-label="Student navigation">
          {tabs.map(({ to, end, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-ico">
                <Icon size={18} />
              </span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  );
}
