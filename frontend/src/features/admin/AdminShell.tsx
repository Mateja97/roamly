import { Outlet, Link } from 'react-router-dom';
import { Compass, Tag, MapPin, Star, Settings } from 'lucide-react';
import './AdminShell.css';

const DISABLED_NAV_ITEMS = [
  { label: 'Categories', Icon: Tag },
  { label: 'Cities', Icon: MapPin },
  { label: 'Reviews', Icon: Star },
  { label: 'Settings', Icon: Settings },
];

/** The persistent admin chrome: wine sidebar (Activities is the only active,
 * navigable item — Categories/Cities/Reviews/Settings are out of scope per
 * product-tasks.md's Non-goals and render disabled) + a static user footer,
 * on the light admin surface. Each routed page renders its own header. */
export function AdminShell() {
  return (
    <div className="admin-shell">
      <nav className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-sidebar-brand">
          <Compass
            size={20}
            className="admin-sidebar-brand-icon"
            aria-hidden="true"
          />
          <span className="admin-sidebar-wordmark">Roamly</span>
        </div>
        <p className="admin-sidebar-eyebrow">Admin</p>

        <ul className="admin-nav-list">
          <li>
            <Link
              to="/activities"
              className="admin-nav-item admin-nav-item-active"
              aria-current="page"
            >
              <Compass size={16} aria-hidden="true" />
              Activities
            </Link>
          </li>
          {DISABLED_NAV_ITEMS.map(({ label, Icon }) => (
            <li key={label}>
              <span
                className="admin-nav-item admin-nav-item-disabled"
                aria-disabled="true"
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </span>
            </li>
          ))}
        </ul>

        <div className="admin-sidebar-footer">
          <span className="admin-avatar" aria-hidden="true">
            MK
          </span>
          <span className="admin-sidebar-footer-text">
            <span className="admin-sidebar-footer-name">Mila Kostić</span>
            <span className="admin-sidebar-footer-role">Editor</span>
          </span>
        </div>
      </nav>

      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}
