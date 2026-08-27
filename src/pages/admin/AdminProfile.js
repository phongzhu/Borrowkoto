import { useEffect, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import AdminShell from './AdminShell';
import { SectionGrid } from '../../ui/layouts';
import { Badge, Button, FileInput, FormField, Input, Panel, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import { CalendarIcon, ProfileIcon } from '../../ui/icons';
import PhilippineAddressFields from '../../ui/PhilippineAddressFields';
import {
  buildMapEmbedUrl,
  buildProfileForm,
  ensureUniquePhoneNumber,
  ensureUniqueUsername,
  sanitizeText,
  suffixOptions,
  validateCoordinates,
} from '../../ui/profileFormUtils';

const identityFields = [
  { label: 'First name', name: 'first_name' },
  { label: 'Middle name', name: 'middle_name' },
  { label: 'Last name', name: 'last_name' },
  { label: 'Username', name: 'username' },
  { label: 'Phone number', name: 'phone_number' },
];

const selectStyle = {
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
};

const profilePanelHeight = 'min(82vh, 980px)';

function formatDate(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function buildName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function readValue(value, fallback = 'Not available') {
  if (typeof value === 'string') {
    return value.trim() || fallback;
  }

  return value || fallback;
}

function DetailCard({ label, style, value }) {
  return (
    <div
      style={{
        alignContent: 'start',
        background: alpha(theme.colors.panel, 0.74),
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: 0,
        display: 'grid',
        gap: 6,
        minHeight: 110,
        padding: 16,
        ...style,
      }}
    >
      <span style={{ color: theme.colors.slate, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
      <span
        style={{
          color: theme.colors.ink,
          fontFamily: theme.fonts.display,
          fontSize: 17,
          letterSpacing: '-0.04em',
          lineHeight: 1.35,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div
      className="responsive-detail-row"
      style={{
        alignItems: 'start',
        borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        display: 'grid',
        gap: 10,
        gridTemplateColumns: '160px minmax(0, 1fr)',
        padding: '12px 0',
      }}
    >
      <span style={{ color: theme.colors.slate, fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color: theme.colors.ink, lineHeight: 1.7, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

export default function AdminProfile() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(buildProfileForm(null, null, 'admin'));
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');

  useEffect(() => {
    let mounted = true;

    async function loadAccount() {
      const {
        data: { user: currentUser },
        error: userError,
      } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      if (userError) {
        setError(userError.message);
        setLoading(false);
        return;
      }

      if (!currentUser) {
        setError('No authenticated admin session was found.');
        setLoading(false);
        return;
      }

      setUser(currentUser);

      const { data: profileData, error: profileError } = await supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();

      if (!mounted) {
        return;
      }

      if (profileError) {
        setError(profileError.message);
      } else {
        setProfile(profileData || null);
        setForm(buildProfileForm(currentUser, profileData, 'admin'));
      }

      setLoading(false);
    }

    loadAccount();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [photoFile]);

  function handleChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function uploadPhoto() {
    if (!photoFile) {
      return sanitizeText(form.profile_photo_url);
    }

    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();

    if (!currentUser) {
      throw new Error('User not authenticated');
    }

    const fileExt = photoFile.name.split('.').pop()?.toLowerCase() || 'png';
    const filePath = `${currentUser.id}/avatar.${fileExt}`;
    const { error: uploadError } = await supabase.storage.from('profile-photos').upload(filePath, photoFile, { upsert: true });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from('profile-photos').getPublicUrl(filePath);
    return data.publicUrl;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!user) {
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const profilePhotoUrl = await uploadPhoto();
      const normalizedPhoneNumber = await ensureUniquePhoneNumber(supabase, form.phone_number, user.id);
      const normalizedUsername = await ensureUniqueUsername(supabase, form.username, user.id);
      const { latitude, longitude } = validateCoordinates(form.latitude, form.longitude);
      const payload = {
        barangay: sanitizeText(form.barangay),
        city: sanitizeText(form.city),
        country: sanitizeText(form.country) || 'Philippines',
        first_name: sanitizeText(form.first_name),
        id: user.id,
        last_name: sanitizeText(form.last_name),
        latitude,
        longitude,
        middle_name: sanitizeText(form.middle_name),
        phone_number: normalizedPhoneNumber,
        profile_photo_url: profilePhotoUrl,
        province: sanitizeText(form.province),
        region: sanitizeText(form.region),
        role: sanitizeText(form.role) || profile?.role || user?.user_metadata?.role || 'admin',
        street: sanitizeText(form.street),
        suffix: sanitizeText(form.suffix),
        username: normalizedUsername,
      };

      const { data: nextProfile, error: saveError } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' }).select().single();

      if (saveError) {
        throw new Error(saveError.message);
      }

      setProfile(nextProfile);
      setForm(buildProfileForm(user, nextProfile, 'admin'));
      setPhotoFile(null);
      setEditMode(false);
      setMessage('Profile updated successfully.');
      setMessageTone('success');
      window.dispatchEvent(
        new CustomEvent('profile-photo-updated', {
          detail: { profilePhotoUrl: nextProfile.profile_photo_url || '' },
        })
      );
    } catch (submitError) {
      const rawMessage = String(submitError?.message || '');
      const friendlyMessage = rawMessage.includes('profiles_username_key')
        ? 'That username already exists. Please choose another one.'
        : rawMessage;
      setMessage(`Update failed: ${friendlyMessage}`);
      setMessageTone('danger');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminShell subtitle="" title="">
        <Panel>
          <StatusMessage tone="info">Loading profile.</StatusMessage>
        </Panel>
      </AdminShell>
    );
  }

  const displayName = buildName(profile);
  const roleLabel = readValue(profile?.role || user?.user_metadata?.role);
  const accountStatus = readValue(profile?.account_status, 'Active');
  const username = sanitizeText(profile?.username) ? `@${profile.username}` : 'No username saved';
  const address = [profile?.street, profile?.barangay, profile?.city, profile?.province, profile?.region, profile?.country].filter(Boolean).join(', ');
  const mapUrl = buildMapEmbedUrl(profile?.latitude, profile?.longitude);

  return (
    <AdminShell subtitle="" title="">
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

      <div className="two-column" style={{ alignItems: 'start', display: 'grid', gap: 24, gridTemplateColumns: 'minmax(320px, 0.84fr) minmax(0, 1.16fr)' }}>
        <Panel
          className="responsive-panel-auto"
          style={{
            alignContent: 'start',
            background: `linear-gradient(180deg, ${alpha(theme.colors.panel, 0.98)}, ${alpha(theme.colors.coral, 0.08)})`,
            gap: 24,
            height: profilePanelHeight,
            overflow: 'hidden',
          }}
        >
          <div className="responsive-scroll-form" style={{ display: 'grid', gap: 20, minHeight: 0, overflowY: 'auto', paddingRight: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                icon={<ProfileIcon size={16} />}
                onClick={() => setEditMode((current) => !current)}
                type="button"
                variant={editMode ? 'ghost' : 'secondary'}
              >
                {editMode ? 'Stop editing' : 'Edit profile'}
              </Button>
            </div>

            <div className="responsive-flex-stack-start" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 18 }}>
              <div
                style={{
                  alignItems: 'center',
                  background: alpha(theme.colors.coral, 0.12),
                  borderRadius: '50%',
                  color: theme.colors.coral,
                  display: 'inline-flex',
                  flexShrink: 0,
                  height: 120,
                  justifyContent: 'center',
                  overflow: 'hidden',
                  width: 120,
                }}
              >
                {photoPreviewUrl || form.profile_photo_url ? (
                  <img alt="Profile" src={photoPreviewUrl || form.profile_photo_url} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
                ) : (
                  <ProfileIcon size={46} />
                )}
              </div>

              <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
                <h2
                  style={{
                    color: theme.colors.ink,
                    fontFamily: theme.fonts.display,
                    fontSize: 34,
                    letterSpacing: '-0.06em',
                    lineHeight: 0.96,
                    margin: 0,
                    wordBreak: 'break-word',
                  }}
                >
                  {displayName || readValue(user?.email)}
                </h2>
                <p style={{ color: theme.colors.slate, lineHeight: 1.6, margin: 0, wordBreak: 'break-word' }}>{readValue(user?.email)}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <Badge tone="info">{roleLabel}</Badge>
                  <Badge tone={accountStatus.toLowerCase() === 'active' ? 'success' : 'warning'}>{accountStatus}</Badge>
                </div>
              </div>
            </div>

            <SectionGrid columns={2} style={{ alignItems: 'stretch' }}>
              <DetailCard label="Username" value={username} />
              <DetailCard label="Phone" value={readValue(profile?.phone_number)} />
            </SectionGrid>

            <div
              style={{
                background: alpha(theme.colors.panel, 0.72),
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: 0,
                display: 'grid',
                gap: 8,
                padding: 18,
              }}
            >
              <span style={{ color: theme.colors.slate, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Address</span>
              <span style={{ color: theme.colors.ink, lineHeight: 1.7 }}>{address || 'Not available'}</span>
            </div>

            {mapUrl ? (
              <div
                style={{
                  border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  borderRadius: 0,
                  overflow: 'hidden',
                }}
              >
                <iframe src={mapUrl} style={{ border: 0, display: 'block', height: 220, width: '100%' }} title="Administrator location" />
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          className="responsive-panel-auto"
          action={
            <Badge tone={profile ? 'success' : 'info'}>
              {profile ? 'Profile record found' : 'Create profile record'}
            </Badge>
          }
          style={{
            gridTemplateRows: 'auto minmax(0, 1fr)',
            height: profilePanelHeight,
            overflow: 'hidden',
          }}
          subtitle={editMode ? 'Update the administrator profile fields saved in the `profiles` table.' : 'Review the authentication and session details connected to this administrator account.'}
          title={editMode ? 'Edit personal details' : 'Account details'}
        >
          {editMode ? (
            <form className="responsive-scroll-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 18, minHeight: 0, overflowY: 'auto', paddingRight: 6 }}>
              <div className="form-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                {identityFields.map((field) => (
                  <FormField key={field.name} label={field.label}>
                    <Input name={field.name} onChange={handleChange} value={form[field.name] || ''} />
                  </FormField>
                ))}
                <FormField label="Suffix">
                  <select name="suffix" onChange={handleChange} style={selectStyle} value={form.suffix || ''}>
                    {suffixOptions.map((option) => (
                      <option key={option.value || 'none'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <PhilippineAddressFields form={form} setForm={setForm} />

              <FormField hint="Optional. Upload a new profile image to refresh the profile card." label="Profile photo">
                <FileInput accept="image/*" onChange={(event) => setPhotoFile(event.target.files?.[0] || null)} />
              </FormField>

              {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Button disabled={saving} style={{ flex: 1 }} type="submit">
                  {saving ? 'Saving...' : 'Save profile'}
                </Button>
                <Button onClick={() => setEditMode(false)} type="button" variant="ghost">
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="responsive-scroll-form" style={{ display: 'grid', minHeight: 0, overflowY: 'auto', paddingRight: 6 }}>
              <DetailRow label="Auth ID" value={readValue(user?.id)} />
              <DetailRow label="Role" value={roleLabel} />
              <DetailRow label="Joined" value={formatDate(user?.created_at)} />
              <DetailRow label="Last sign-in" value={formatDate(user?.last_sign_in_at)} />
              <DetailRow label="Email" value={readValue(user?.email)} />
              <DetailRow label="Profile state" value={profile ? 'Linked profile record' : 'Auth-only account'} />
              {message ? <div style={{ paddingTop: 14 }}><StatusMessage tone={messageTone}>{message}</StatusMessage></div> : null}
            </div>
          )}
        </Panel>
      </div>

      <Panel>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
            <div
              style={{
                alignItems: 'center',
                background: alpha(theme.colors.sky, 0.12),
                borderRadius: 16,
                color: theme.colors.sky,
                display: 'inline-flex',
                height: 40,
                justifyContent: 'center',
                width: 40,
              }}
            >
              <CalendarIcon size={18} />
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <strong
                style={{
                  color: theme.colors.ink,
                  fontFamily: theme.fonts.display,
                  fontSize: 22,
                  letterSpacing: '-0.04em',
                }}
              >
                Session snapshot
              </strong>
              <span style={{ color: theme.colors.slate, lineHeight: 1.6 }}>
                Authentication values stay visible here while personal fields remain editable in the profile form.
              </span>
            </div>
          </div>

          <SectionGrid columns={3}>
            <DetailCard label="Email" value={readValue(user?.email)} />
            <DetailCard label="Account status" value={accountStatus} />
            <DetailCard label="Profile state" value={profile ? 'Linked profile record' : 'Auth-only account'} />
          </SectionGrid>
        </div>
      </Panel>
    </AdminShell>
  );
}
