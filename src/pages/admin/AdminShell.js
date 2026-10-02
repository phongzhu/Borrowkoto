import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { ArrowUpRightIcon, CatalogIcon, FaqIcon, HomeIcon, LogoutIcon, PaletteIcon, ProfileIcon, ReportIcon, StarIcon, UsersIcon } from '../../ui/icons';
import { WorkspaceLayout } from '../../ui/layouts';
import { Button, Modal } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import './AdminUI.css';

const navItems = [
  { path: '/admin/dashboard', label: 'Overview', icon: <HomeIcon size={18} /> },
  { path: '/admin/users', label: 'Users', icon: <UsersIcon size={18} />, badge: 'Live' },
  { path: '/admin/catalog', label: 'Catalog', icon: <CatalogIcon size={18} /> },
  { path: '/admin/reports', label: 'Reports', icon: <ReportIcon size={18} /> },
  { path: '/admin/withdrawals', label: 'Withdrawals', icon: <ArrowUpRightIcon size={18} /> },
  { path: '/admin/ui-settings', label: 'UI settings', icon: <PaletteIcon size={18} /> },
  { path: '/admin/promotion-settings', label: 'Promotion pricing', icon: <PaletteIcon size={18} /> },
  { path: '/admin/voucher-rewards', label: 'Voucher rewards', icon: <StarIcon size={18} /> },
  { path: '/admin/terms', label: 'Terms & conditions', icon: <FaqIcon size={18} /> },
];

export default function AdminShell({ children, subtitle, title }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadProfilePhoto() {
      if (!user?.id) {
        setProfilePhotoUrl('');
        return;
      }

      const { data, error } = await supabase.from('profiles').select('profile_photo_url').eq('id', user.id).maybeSingle();

      if (!mounted) {
        return;
      }

      if (error) {
        console.warn('Unable to load the admin profile photo:', error.message);
        return;
      }

      setProfilePhotoUrl(data?.profile_photo_url || '');
    }

    function handleProfilePhotoUpdate(event) {
      setProfilePhotoUrl(event.detail?.profilePhotoUrl || '');
    }

    loadProfilePhoto().catch((error) => {
      if (mounted) console.warn('Unable to load the admin profile photo:', error?.message || error);
    });
    window.addEventListener('profile-photo-updated', handleProfilePhotoUpdate);

    return () => {
      mounted = false;
      window.removeEventListener('profile-photo-updated', handleProfilePhotoUpdate);
    };
  }, [user?.id]);

  async function handleConfirmSignOut() {
    await supabase.auth.signOut();
    navigate('/login');
  }

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
              onClick={() => navigate('/admin/profile')}
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
        kind="admin"
        navItems={navItems}
        onNavigate={navigate}
        setCollapsed={setCollapsed}
        subtitle={subtitle}
        title={title}
      >
        <div className="admin-page-surface">{children}</div>
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
        title="Leave control room?"
      >
        You will be signed out and returned to the shared login screen.
      </Modal>
    </>
  );
}
