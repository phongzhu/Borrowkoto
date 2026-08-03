import React from 'react';
import './AdminDashboard.css';
import { useNavigate } from 'react-router-dom';

export default function AdminSidebar({ collapsed, setCollapsed }) {
  const navigate = useNavigate();
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-title">
        <span className="online-icon" title="Online" />
        Admin Panel
        <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '➡️' : '⬅️'}
        </button>
      </div>
      <ul>
        <li onClick={() => navigate('/admin/dashboard')}>
          <span className="sidebar-label">🏠 Dashboard</span>
        </li>
        <li onClick={() => navigate('/admin/users')}>
          <span className="sidebar-label">👥 Manage Users</span>
        </li>
        <li onClick={() => navigate('/admin/reports')}>
          <span className="sidebar-label">📄 Manage Reports</span>
        </li>
        <li onClick={() => navigate('/admin/ui-settings')}>
          <span className="sidebar-label">⚙️ UI-Settings</span>
        </li>
      </ul>
    </aside>
  );
}
