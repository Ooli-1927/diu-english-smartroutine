import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CalendarCheck, LogOut, School, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { CampusAtmosphere } from '../../components/CampusAtmosphere';

export function TeacherLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <CampusAtmosphere />
      <div className="app-shell teacher-shell ux-shell">
        <div className="app-body teacher-body">
          <Outlet />
        </div>

        <nav className="bottom-nav teacher-footer" aria-label="Teacher tools">
          <NavLink
            to="/teacher"
            end
            className={({ isActive }) => `teacher-footer__item${isActive ? ' active' : ''}`}
          >
            <span className="nav-ico">
              <School size={18} />
            </span>
            <span>Desk</span>
          </NavLink>

          <NavLink
            to="/teacher/appointments"
            className={({ isActive }) => `teacher-footer__item${isActive ? ' active' : ''}`}
          >
            <span className="nav-ico">
              <CalendarCheck size={18} />
            </span>
            <span>Meetings</span>
          </NavLink>

          <NavLink
            to="/teacher/profile"
            className={({ isActive }) => `teacher-footer__item${isActive ? ' active' : ''}`}
          >
            <span className="nav-ico">
              <User size={18} />
            </span>
            <span>Profile</span>
          </NavLink>

          <button
            type="button"
            className="teacher-footer__item is-danger"
            title="Log out"
            onClick={() => {
              logout();
              navigate('/login', { replace: true });
            }}
          >
            <span className="nav-ico">
              <LogOut size={18} />
            </span>
            <span>Logout</span>
          </button>
        </nav>
      </div>
    </>
  );
}
