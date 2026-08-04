import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import AdminShell from './AdminShell';
import { CheckIcon, ShieldIcon, UsersIcon } from '../../ui/icons';
import { SectionGrid } from '../../ui/layouts';
import { Badge, Button, FormField, Input, MetricCard, Panel, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';

function buildName(profile) {
  return [profile.first_name, profile.middle_name, profile.last_name, profile.suffix].filter(Boolean).join(' ');
}

function buildLocation(profile) {
  return [profile.barangay, profile.city, profile.province, profile.country].filter(Boolean).join(', ');
}

function accountTone(status) {
  if (status === 'active') {
    return 'success';
  }

  if (status === 'inactive') {
    return 'warning';
  }

  return 'info';
}

const headerCellStyle = {
  borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
  color: theme.colors.slate,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.12em',
  padding: '0 16px 14px',
  textAlign: 'left',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const bodyCellStyle = {
  borderBottom: `1px solid ${alpha(theme.colors.ink, 0.06)}`,
  padding: '16px',
  verticalAlign: 'top',
};

export default function ManageUsers() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [updatingId, setUpdatingId] = useState('');

  useEffect(() => {
    let mounted = true;

    async function fetchProfiles() {
      const { data, error: queryError } = await supabase
        .from('profiles')
        .select('id, role, first_name, middle_name, last_name, suffix, username, phone_number, barangay, city, province, country, account_status')
        .order('created_at', { ascending: false });

      if (!mounted) {
        return;
      }

      if (queryError) {
        setError(queryError.message);
        setProfiles([]);
      } else {
        setError('');
        setProfiles(data || []);
      }

      setLoading(false);
    }

    fetchProfiles();

    return () => {
      mounted = false;
    };
  }, []);

  const totalUsers = profiles.length;
  const activeUsers = useMemo(() => profiles.filter((profile) => profile.account_status === 'active').length, [profiles]);
  const inactiveUsers = useMemo(() => profiles.filter((profile) => profile.account_status === 'inactive').length, [profiles]);

  const roleOptions = useMemo(() => ['all', ...Array.from(new Set(profiles.map((profile) => profile.role).filter(Boolean))).sort()], [profiles]);

  const filteredProfiles = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return profiles.filter((profile) => {
      if (roleFilter !== 'all' && profile.role !== roleFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        profile.id,
        buildName(profile),
        profile.username,
        profile.phone_number,
        profile.role,
        profile.account_status,
        buildLocation(profile),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [profiles, roleFilter, searchQuery]);

  async function handleToggleAccountStatus(profile) {
    const nextStatus = profile.account_status === 'active' ? 'inactive' : 'active';
    const previousStatus = profile.account_status;

    setUpdatingId(profile.id);
    setMessage('');
    setProfiles((current) => current.map((item) => (item.id === profile.id ? { ...item, account_status: nextStatus } : item)));

    const { error: updateError } = await supabase.from('profiles').update({ account_status: nextStatus }).eq('id', profile.id);

    if (updateError) {
      setProfiles((current) => current.map((item) => (item.id === profile.id ? { ...item, account_status: previousStatus } : item)));
      setMessage(`Unable to update account status: ${updateError.message}`);
      setMessageTone('warning');
      setUpdatingId('');
      return;
    }

    setMessage(`Account updated to ${nextStatus}.`);
    setMessageTone('success');
    setUpdatingId('');
  }

  return (
    <AdminShell subtitle="" title="">
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionGrid columns={3} style={{ gap: 16, position: 'relative', zIndex: 1 }}>
          <MetricCard
            detail="All Users of Borrow Ko To."
            icon={<UsersIcon size={18} />}
            label="Users"
            tone={theme.colors.coral}
            value={loading ? 'Loading...' : `${totalUsers}`}
          />
          <MetricCard
            detail="Accounts with Active Status."
            icon={<CheckIcon size={18} />}
            label="Active"
            tone={theme.colors.success}
            value={loading ? 'Loading...' : `${activeUsers}`}
          />
          <MetricCard
            detail="Accounts with Inactive Status"
            icon={<ShieldIcon size={18} />}
            label="Inactive"
            tone={theme.colors.amber}
            value={loading ? 'Loading...' : `${inactiveUsers}`}
          />
        </SectionGrid>

        <Panel style={{ marginTop: 0, padding: '8px 24px 24px', position: 'relative', zIndex: 0 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="form-grid admin-filter-toolbar" style={{ alignItems: 'end', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) 240px auto' }}>
              <FormField label="Search users">
                <Input name="search" onChange={(event) => setSearchQuery(event.target.value)} value={searchQuery} />
              </FormField>

              <FormField label="Filter by role">
                <select
                  name="role_filter"
                  onChange={(event) => setRoleFilter(event.target.value)}
                  style={{
                    background: alpha(theme.colors.panel, 0.92),
                    border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                    borderRadius: 18,
                    color: theme.colors.ink,
                    fontFamily: theme.fonts.body,
                    fontSize: 15,
                    minHeight: 52,
                    outline: 'none',
                    padding: '0 16px',
                    width: '100%',
                  }}
                  value={roleFilter}
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role === 'all' ? 'All roles' : role}
                    </option>
                  ))}
                </select>
              </FormField>

              <Badge style={{ alignSelf: 'center', justifySelf: 'flex-start', marginBottom: 2 }} tone="info">
                {loading ? 'Loading users' : `${filteredProfiles.length} shown`}
              </Badge>
            </div>

            {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
            {loading ? <StatusMessage tone="info">Loading profile records.</StatusMessage> : null}
            {!loading && !filteredProfiles.length ? <StatusMessage tone="info">No users match the current search and role filter.</StatusMessage> : null}

            {!loading && filteredProfiles.length ? (
              <div
                style={{
                  border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                  overflowX: 'auto',
                }}
              >
                <table style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 980, width: '100%' }}>
                  <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                    <tr>
                      <th style={headerCellStyle}>User</th>
                      <th style={headerCellStyle}>Username</th>
                      <th style={headerCellStyle}>Role</th>
                      <th style={headerCellStyle}>Phone</th>
                      <th style={headerCellStyle}>Location</th>
                      <th style={headerCellStyle}>Status</th>
                      <th style={headerCellStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProfiles.map((profile) => {
                      const displayName = buildName(profile);
                      const location = buildLocation(profile);
                      const isActive = profile.account_status === 'active';

                      return (
                        <tr key={profile.id}>
                          <td style={bodyCellStyle}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <strong
                                style={{
                                  color: theme.colors.ink,
                                  fontFamily: theme.fonts.display,
                                  fontSize: 18,
                                  letterSpacing: '-0.04em',
                                }}
                              >
                                {displayName || 'No name saved'}
                              </strong>
                              <span style={{ color: theme.colors.slate, fontFamily: theme.fonts.mono, fontSize: 12, lineHeight: 1.55 }}>{profile.id}</span>
                            </div>
                          </td>
                          <td style={bodyCellStyle}>
                            <span style={{ color: theme.colors.ink }}>{profile.username || 'Not set'}</span>
                          </td>
                          <td style={bodyCellStyle}>
                            <Badge tone="info">{profile.role || 'user'}</Badge>
                          </td>
                          <td style={bodyCellStyle}>
                            <span style={{ color: theme.colors.ink }}>{profile.phone_number || 'Not set'}</span>
                          </td>
                          <td style={bodyCellStyle}>
                            <span style={{ color: theme.colors.ink }}>{location || 'Not set'}</span>
                          </td>
                          <td style={bodyCellStyle}>
                            <Badge tone={accountTone(profile.account_status)}>{profile.account_status || 'Unknown'}</Badge>
                          </td>
                          <td style={bodyCellStyle}>
                            <Button
                              disabled={updatingId === profile.id}
                              onClick={() => handleToggleAccountStatus(profile)}
                              type="button"
                              variant={isActive ? 'danger' : 'secondary'}
                            >
                              {updatingId === profile.id ? 'Saving...' : isActive ? 'Set inactive' : 'Set active'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </AdminShell>
  );
}
