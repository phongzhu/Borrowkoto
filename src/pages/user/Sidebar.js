import React from 'react';
import './UserDashboard.css';
import { useNavigate } from 'react-router-dom';

export default function UserSidebar({ collapsed, setCollapsed }) {
  const navigate = useNavigate();
  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-title">
        <span className="online-icon" title="Online" />
        User Menu
        <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '➡️' : '⬅️'}
        </button>
      </div>
      <ul>
        <li onClick={() => navigate('/user/dashboard')}>Dashboard</li>
        <li onClick={() => navigate('/user/rental-items')}>Rental Items</li>
        <li onClick={() => navigate('/user/manage-booking')}>Manage Booking</li>
        <li onClick={() => navigate('/user/schedule-booking')}>Schedule Booking</li>
        <li onClick={() => navigate('/user/rental-income')}>Report</li>
        <li onClick={() => navigate('/user/messages')}>Messages</li>
      </ul>
    </aside>
  );
}
