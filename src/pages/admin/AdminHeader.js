import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';

export default function AdminHeader({ title }) {
  const navigate = useNavigate();
  const [showModal, setShowModal] = React.useState(false);

  const handleSignOut = async () => {
    setShowModal(true);
  };

  const confirmSignOut = async () => {
    await supabase.auth.signOut();
    setShowModal(false);
    navigate('/login');
  };

  const cancelSignOut = () => {
    setShowModal(false);
  };

  const goToProfile = () => {
    // Redirect to the UI settings page until a dedicated admin profile page exists.
    navigate('/admin/ui-settings');
  };

  return (
    <>
      <header className="dashboard-header">
        <div className="header-left">
          <span className="online-icon" title="Online" />
          <span>{title}</span>
        </div>
        <div className="header-right">
          <span className="notification-bell" title="Notifications">🔔</span>
          <span className="profile-icon" title="Profile" onClick={goToProfile} style={{cursor:'pointer'}}>👤</span>
          <button className="signout-btn" onClick={handleSignOut}>Sign Out</button>
        </div>
      </header>
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <p>Are you sure you want to sign out?</p>
            <div className="modal-actions">
              <button onClick={confirmSignOut}>Yes, Sign Out</button>
              <button onClick={cancelSignOut}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
