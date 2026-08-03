import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { CalendarIcon, CatalogIcon, LogoutIcon, MessageIcon, ProfileIcon, SparkIcon } from '../../ui/icons';
import { WorkspaceLayout } from '../../ui/layouts';
import { Button, Modal } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';

const navItems = [
  { type: 'section', label: 'Browse' },
  { path: '/user/dashboard', label: 'Dashboard', icon: <CatalogIcon size={18} /> },
  { path: '/', label: 'Browse Listings', icon: <CatalogIcon size={18} /> },
  { path: '/user/saved-listings', label: 'Saved Listings', icon: <CatalogIcon size={18} /> },
  { type: 'section', label: 'Rentals' },
  { path: '/user/rental-items', label: 'Rental Items', icon: <CatalogIcon size={18} /> },
  { path: '/user/manage-booking', label: 'Manage Booking', icon: <CalendarIcon size={18} /> },
  { path: '/user/rental-income', label: 'Report', icon: <SparkIcon size={18} /> },
  { type: 'section', label: 'Communication' },
  { path: '/user/messages', label: 'Messages', icon: <MessageIcon size={18} /> },
];

export default function UserShell({ children, subtitle, title }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadProfilePhoto() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted || !user) {
        return;
      }

      const { data } = await supabase.from('profiles').select('profile_photo_url').eq('id', user.id).maybeSingle();

      if (!mounted) {
        return;
      }

      setProfilePhotoUrl(data?.profile_photo_url || '');
    }

    function handleProfilePhotoUpdate(event) {
      setProfilePhotoUrl(event.detail?.profilePhotoUrl || '');
    }

    loadProfilePhoto();
    window.addEventListener('profile-photo-updated', handleProfilePhotoUpdate);

    return () => {
      mounted = false;
      window.removeEventListener('profile-photo-updated', handleProfilePhotoUpdate);
    };
  }, []);

  async function handleConfirmSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

  const rentItemPathMatch = location.pathname.match(/^\/user\/rent-item\/([^/]+)/);
  const rentItemId = rentItemPathMatch?.[1] || '';
  const showRentHeaderBack = Boolean(rentItemId);

  const rentHeaderBackButton = showRentHeaderBack ? (
    <button
      aria-label="Return"
      className="rent-header-back-btn"
      onClick={() => navigate(`/user/view-item-list/${rentItemId}`)}
      style={{
        alignItems: 'center',
        background: alpha(theme.colors.ink, 0.04),
        border: `1px solid ${alpha(theme.colors.ink, 0.12)}`,
        borderRadius: 999,
        color: theme.colors.ink,
        cursor: 'pointer',
        display: 'inline-flex',
        fontFamily: theme.fonts.display,
        fontSize: 14,
        fontWeight: 600,
        minHeight: 40,
        padding: '0 14px',
        whiteSpace: 'nowrap',
      }}
      type="button"
    >
      Return
    </button>
  ) : null;

  return (
    <>
      <WorkspaceLayout
        actions={
          <>
            <button
              aria-label="Open profile"
              type="button"
              style={{
                background: alpha(theme.colors.ink, 0.06),
                border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                borderRadius: 999,
                color: theme.colors.ink,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                height: 44,
                justifyContent: 'center',
                padding: 0,
                width: 44,
              }}
              onClick={() => navigate('/user/profile')}
            >
              <span
                style={{
                  alignItems: 'center',
                  background: alpha(theme.colors.ink, 0.08),
                  borderRadius: '50%',
                  color: theme.colors.ink,
                  display: 'inline-flex',
                  height: 30,
                  justifyContent: 'center',
                  overflow: 'hidden',
                  width: 30,
                }}
              >
                {profilePhotoUrl ? (
                  <img alt="Profile" src={profilePhotoUrl} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
                ) : (
                  <ProfileIcon size={16} />
                )}
              </span>
            </button>
            <button
              aria-label="Sign out"
              type="button"
              style={{
                background: alpha(theme.colors.ink, 0.06),
                border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                borderRadius: '50%',
                color: theme.colors.ink,
                cursor: 'pointer',
                display: 'inline-flex',
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
              }}
              onClick={() => setShowSignOut(true)}
            >
              <LogoutIcon size={18} />
            </button>
          </>
        }
        activePath={location.pathname}
        collapsed={collapsed}
        kind="user"
        navItems={navItems}
        onNavigate={navigate}
        setCollapsed={setCollapsed}
        subtitle={subtitle}
        topbarExtrasLeft={rentHeaderBackButton}
        title={title}
      >
        {children}
      </WorkspaceLayout>

      <Modal
        actions={
          <>
            <Button variant="ghost" onClick={() => setShowSignOut(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmSignOut}>
              Sign out
            </Button>
          </>
        }
        onClose={() => setShowSignOut(false)}
        open={showSignOut}
        title="Leave member space?"
      >
        You will be signed out of the current session and returned to the user login screen.
      </Modal>
    </>
  );
}
