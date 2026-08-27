import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { formatNubProgram, getNubProgram, getNubSchool } from '../../data/nubAcademicData';
import { CalendarIcon, ProfileIcon, ShieldIcon } from '../../ui/icons';
import { SectionGrid } from '../../ui/layouts';
import { Badge, Button, FileInput, FormField, Input, Modal, Panel, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import UserShell from './UserShell';
import './Profile.css';
import PhilippineAddressFields from '../../ui/PhilippineAddressFields';
import {
  buildMapEmbedUrl,
  buildProfileForm,
  ensureUniquePhoneNumber,
  ensureUniqueUsername,
  getMissingStudentProfileDetails,
  sanitizeText,
  suffixOptions,
  validateCoordinates,
} from '../../ui/profileFormUtils';

const identityFields = [
  { name: 'first_name', label: 'First name' },
  { name: 'middle_name', label: 'Middle name' },
  { name: 'last_name', label: 'Last name' },
  { name: 'username', label: 'Username' },
  { name: 'phone_number', label: 'Phone number' },
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

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLatestAdultBirthDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date;
}

function validateAdultDateOfBirth(value) {
  const normalized = sanitizeText(value);

  if (!normalized) {
    throw new Error('Date of birth is required.');
  }

  const birthDate = new Date(`${normalized}T00:00:00`);

  if (Number.isNaN(birthDate.getTime())) {
    throw new Error('Date of birth is invalid.');
  }

  if (birthDate > getLatestAdultBirthDate()) {
    throw new Error('You must be at least 18 years old to complete your profile.');
  }

  return normalized;
}

function buildName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function readValue(value, fallback = 'Not available') {
  if (typeof value === 'string') {
    return value.trim() || fallback;
  }

  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return value;
}

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

function toneFromStatus(status) {
  const normalized = String(status || '').toLowerCase();

  if (['approved', 'verified', 'active', 'complete'].includes(normalized)) {
    return 'success';
  }

  if (['pending', 'under review', 'draft'].includes(normalized)) {
    return 'warning';
  }

  if (['rejected', 'inactive', 'suspended'].includes(normalized)) {
    return 'danger';
  }

  return 'info';
}

function SummaryTile({ icon, label, value }) {
  return (
    <div
      style={{
        alignContent: 'start',
        background: alpha('#ffffff', 0.9),
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: 0,
        display: 'grid',
        gap: 8,
        minHeight: 0,
        padding: 16,
      }}
    >
      <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
        <span
          style={{
            alignItems: 'center',
            background: alpha(theme.colors.sky, 0.08),
            borderRadius: 12,
            color: theme.colors.sky,
            display: 'inline-flex',
            height: 32,
            justifyContent: 'center',
            width: 32,
          }}
        >
          {icon}
        </span>
        <span style={{ color: theme.colors.slate, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <span
        style={{
          color: theme.colors.ink,
          fontFamily: theme.fonts.display,
          fontSize: 18,
          letterSpacing: '-0.03em',
          lineHeight: 1.35,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function RecordItem({ label, value }) {
  return (
    <div className="profile-record-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SectionCard({ children, style, title }) {
  return (
    <div
      style={{
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: 0,
        display: 'grid',
        gap: 12,
        minHeight: 0,
        padding: 18,
        ...style,
      }}
    >
      {title ? (
        <span style={{ color: theme.colors.slate, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{title}</span>
      ) : null}
      {children}
    </div>
  );
}

export default function Profile() {
  const location = useLocation();
  const completingActivation = Boolean(location.state?.completeProfile);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({});
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [profileCompleteModalOpen, setProfileCompleteModalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function fetchProfile() {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();

      if (!currentUser || !mounted) {
        setLoading(false);
        return;
      }

      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();

      if (!mounted) {
        return;
      }

      setUser(currentUser);
      setProfile(profileData || null);
      setForm(buildProfileForm(currentUser, profileData, 'user'));
      setEditMode(completingActivation || getMissingStudentProfileDetails(profileData).length > 0);
      setLoading(false);
    }

    fetchProfile();

    return () => {
      mounted = false;
    };
  }, [completingActivation]);

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
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'school_code' && getNubProgram(current.program_code)?.schoolCode !== value ? { program_code: '' } : {}),
    }));
  }

  async function uploadPhoto() {
    if (!photoFile) {
      return form.profile_photo_url || null;
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
    setMessage('');

    if (!profile) {
      return;
    }

    try {
      const profilePhotoUrl = await uploadPhoto();
      const normalizedPhoneNumber = await ensureUniquePhoneNumber(supabase, form.phone_number, profile.id);
      const normalizedUsername = await ensureUniqueUsername(supabase, form.username, profile.id);
      const normalizedDateOfBirth = validateAdultDateOfBirth(form.date_of_birth);
      const { latitude, longitude } = validateCoordinates(form.latitude, form.longitude);
      const selectedProgram = getNubProgram(profile.program_code);
      if (!profile.nub_registry_managed || !selectedProgram || selectedProgram.schoolCode !== profile.school_code) {
        throw new Error('This profile is not linked to a valid NU Baliwag registry record.');
      }
      const updateData = {
        barangay: sanitizeText(form.barangay),
        city: sanitizeText(form.city),
        country: sanitizeText(form.country) || 'Philippines',
        date_of_birth: normalizedDateOfBirth,
        first_name: sanitizeText(profile.first_name),
        last_name: sanitizeText(profile.last_name),
        latitude,
        longitude,
        middle_name: sanitizeText(profile.middle_name),
        phone_number: normalizedPhoneNumber,
        profile_photo_url: profilePhotoUrl,
        province: sanitizeText(form.province),
        region: sanitizeText(form.region),
        school_code: selectedProgram.schoolCode,
        street: sanitizeText(form.street),
        suffix: sanitizeText(profile.suffix),
        program_code: selectedProgram.code,
        username: normalizedUsername,
        is_verified: true,
        verification_status: 'verified',
      };
      const missingDetails = getMissingStudentProfileDetails(updateData);

      if (missingDetails.length) {
        throw new Error(`Complete these required profile details: ${missingDetails.join(', ')}.`);
      }

      updateData.is_profile_complete = true;
      const { error } = await supabase.from('profiles').update(updateData).eq('id', profile.id);

      if (error) {
        throw new Error(error.message);
      }

      setProfile((current) => ({ ...current, ...updateData }));
      setForm((current) => ({ ...current, ...buildProfileForm(user, { ...current, ...updateData }, 'user') }));

      setPhotoFile(null);
      setMessage('');
      setEditMode(false);
      setProfileCompleteModalOpen(true);
      window.dispatchEvent(
        new CustomEvent('profile-photo-updated', {
          detail: { profilePhotoUrl: profilePhotoUrl || '' },
        })
      );
    } catch (uploadError) {
      const rawMessage = String(uploadError?.message || '');
      const friendlyMessage = rawMessage.includes('profiles_username_key')
        ? 'That username already exists. Please choose another one.'
        : rawMessage;
      setMessage(`Update failed: ${friendlyMessage}`);
      setMessageTone('danger');
    }
  }

  if (loading) {
    return (
      <UserShell subtitle="" title="">
        <Panel title="Loading profile" subtitle="Pulling your account details from Supabase." />
      </UserShell>
    );
  }

  if (!profile) {
    return (
      <UserShell subtitle="" title="">
        <StatusMessage tone="warning">No profile record was found for the current user.</StatusMessage>
      </UserShell>
    );
  }

  const liveProfile = editMode ? { ...profile, ...form, profile_photo_url: photoPreviewUrl || form.profile_photo_url } : profile;
  const formalName = buildName(liveProfile);
  const emailHandle = sanitizeText(user?.email?.split('@')[0]);
  const displayName = formalName || sanitizeText(liveProfile.username) || emailHandle || 'Profile';
  const username = liveProfile.username ? `@${liveProfile.username}` : 'No username saved';
  const fullAddress = [
    liveProfile.street,
    liveProfile.barangay,
    liveProfile.city,
    liveProfile.province,
    liveProfile.region,
    liveProfile.country,
  ]
    .filter(Boolean)
    .join(', ');
  const locationSummary = [liveProfile.city, liveProfile.province, liveProfile.country].filter(Boolean).join(', ');
  const mapUrl = buildMapEmbedUrl(liveProfile.latitude, liveProfile.longitude);
  const registryStatus = profile.nub_registry_managed ? 'Registry verified' : 'Registry unavailable';
  const joinedAt = formatDate(profile.created_at || user?.created_at);
  const lastSignIn = formatDate(user?.last_sign_in_at);
  const missingProfileDetails = getMissingStudentProfileDetails(profile);
  const profileDetailsComplete = missingProfileDetails.length === 0;
  const profileCompletion = profileDetailsComplete ? 'Complete' : 'Needs completion';
  const accountStatus = readValue(profile.account_status, 'Active');
  const latestAdultBirthDate = formatDateInputValue(getLatestAdultBirthDate());

  return (
    <UserShell subtitle="" title="">
      <Modal
        actions={
          <Button onClick={() => setProfileCompleteModalOpen(false)} type="button">
            Continue
          </Button>
        }
        onClose={() => setProfileCompleteModalOpen(false)}
        open={profileCompleteModalOpen}
        title="Profile credentials completed"
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ color: theme.colors.ink, lineHeight: 1.7, margin: 0 }}>
            Your profile credentials have been completed and saved successfully.
          </p>
          <p style={{ color: theme.colors.slate, lineHeight: 1.65, margin: 0 }}>
            Your registry-confirmed NU Baliwag profile is ready for borrowing and listing.
          </p>
        </div>
      </Modal>

      <div style={{ display: 'grid', gap: 20 }}>
        <Panel
          className="profile-summary-panel"
          style={{
            borderRadius: 0,
            overflow: 'hidden',
            padding: 0,
          }}
        >
          <div
            className="profile-hero-banner"
            style={{
              background: `
                linear-gradient(108deg, ${alpha(theme.colors.ink, 0.94)} 0%, ${alpha('#344757', 0.9)} 52%, ${alpha('#7a8d98', 0.74)} 100%)
              `,
              borderBottom: `1px solid ${alpha('#ffffff', 0.18)}`,
              minHeight: 104,
              position: 'relative',
            }}
          >
            <div
              style={{
                background: alpha('#ffffff', 0.04),
                borderRadius: '50%',
                height: 96,
                position: 'absolute',
                right: -12,
                top: 18,
                width: 96,
              }}
            />
            <div
              style={{
                background: alpha('#ffffff', 0.03),
                borderRadius: '50%',
                height: 64,
                left: 38,
                position: 'absolute',
                top: 22,
                width: 64,
              }}
            />
            <div
              style={{
                borderTop: `1px solid ${alpha('#ffffff', 0.14)}`,
                left: 34,
                position: 'absolute',
                right: 34,
                top: 38,
              }}
            />
          </div>

          <div className="profile-summary-body" style={{ marginTop: -32, padding: '0 30px 22px', position: 'relative' }}>
            <div style={{ display: 'grid', gap: 18 }}>
              <div className="responsive-flex-stack-start" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'space-between' }}>
                <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 18, minWidth: 0 }}>
                  <div
                    className="profile-avatar"
                    style={{
                      alignItems: 'center',
                      background: '#ffffff',
                      border: `5px solid ${alpha('#ffffff', 0.98)}`,
                      borderRadius: '50%',
                      boxShadow: '0 12px 24px rgba(24, 33, 46, 0.1)',
                      color: theme.colors.sky,
                      display: 'inline-flex',
                      flexShrink: 0,
                      height: 108,
                      justifyContent: 'center',
                      overflow: 'hidden',
                      width: 108,
                    }}
                  >
                    {photoPreviewUrl || form.profile_photo_url ? (
                      <img alt="Profile" src={photoPreviewUrl || form.profile_photo_url} style={{ height: '100%', objectFit: 'cover', width: '100%' }} />
                    ) : (
                      <ProfileIcon size={40} />
                    )}
                  </div>

                  <div style={{ display: 'grid', gap: 8, maxWidth: 760, minWidth: 0 }}>
                    <h1
                      style={{
                        color: theme.colors.ink,
                        fontFamily: theme.fonts.display,
                        fontSize: 'clamp(1.8rem, 3vw, 2.6rem)',
                        letterSpacing: '-0.05em',
                        lineHeight: 1,
                        margin: 0,
                        paintOrder: 'stroke fill',
                        textShadow: `
                          0 0 0 ${theme.colors.panel},
                          2px 0 0 ${theme.colors.panel},
                          -2px 0 0 ${theme.colors.panel},
                          0 2px 0 ${theme.colors.panel},
                          0 -2px 0 ${theme.colors.panel},
                          1.5px 1.5px 0 ${theme.colors.panel},
                          -1.5px 1.5px 0 ${theme.colors.panel},
                          1.5px -1.5px 0 ${theme.colors.panel},
                          -1.5px -1.5px 0 ${theme.colors.panel}
                        `,
                        WebkitTextStroke: `1px ${alpha(theme.colors.panel, 0.96)}`,
                        wordBreak: 'break-word',
                      }}
                    >
                      {displayName}
                    </h1>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ color: theme.colors.slate, lineHeight: 1.6, wordBreak: 'break-word' }}>{readValue(user?.email)}</span>
                      {locationSummary ? <span style={{ color: alpha(theme.colors.slate, 0.86) }}>• {locationSummary}</span> : null}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <Badge tone="info">Member record</Badge>
                      <Badge tone={toneFromStatus(accountStatus)}>{accountStatus}</Badge>
                      <Badge tone="success">{registryStatus}</Badge>
                      {profile.program_code && profile.section ? <Badge tone="info">{profile.program_code} · {profile.section}</Badge> : null}
                    </div>
                  </div>
                </div>

              <div className="responsive-action-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <Button
                    onClick={() => {
                      setEditMode((current) => !current);
                    }}
                    style={{
                      minWidth: 144,
                    }}
                    type="button"
                    variant={editMode ? 'ghost' : 'secondary'}
                  >
                    {editMode ? 'Close editor' : 'Edit profile'}
                  </Button>
                </div>
              </div>

              <SectionGrid columns={4} style={{ gap: 12 }}>
                <SummaryTile icon={<CalendarIcon size={16} />} label="Joined" value={joinedAt} />
                <SummaryTile icon={<CalendarIcon size={16} />} label="Last sign-in" value={lastSignIn} />
                <SummaryTile icon={<ProfileIcon size={16} />} label="Username" value={username} />
                <SummaryTile icon={<ShieldIcon size={16} />} label="Profile state" value={profileCompletion} />
              </SectionGrid>
            </div>
          </div>
        </Panel>

        <div className="two-column profile-content" style={{ alignItems: 'stretch', display: 'grid', gap: 20, gridTemplateColumns: '1fr' }}>
          <Panel
            className="profile-details-panel"
            style={{ borderRadius: 0, height: '100%' }}
            subtitle={
              editMode
                ? 'Update the saved profile fields from this formal account record.'
                : 'A formal view of your personal record, trust state, and account timeline.'
            }
            title={editMode ? 'Edit personal details' : 'Student and account record'}
          >
            {editMode ? (
              <form className="responsive-scroll-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 18, maxHeight: '78vh', overflowY: 'auto', paddingRight: 6 }}>
                {!profileDetailsComplete ? (
                  <StatusMessage tone="info">Complete your username, profile photo, and all required personal and address details to finish setting up your account.</StatusMessage>
                ) : null}
                <section className="profile-form-section">
                  <div className="profile-form-section-heading">
                    <strong>Personal details</strong>
                    <span>Your university-managed name is locked. Complete the remaining contact and personal details.</span>
                  </div>

                  <div className="form-grid profile-three-column-grid">
                  {identityFields.slice(0, 3).map((field) => (
                    <FormField key={field.name} label={field.label} required={['first_name', 'last_name'].includes(field.name)}>
                      <Input disabled name={field.name} value={form[field.name] || ''} />
                    </FormField>
                  ))}

                  <FormField label="Suffix">
                    <select disabled name="suffix" style={selectStyle} value={form.suffix || ''}>
                      {suffixOptions.map((option) => (
                        <option key={option.value || 'none'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FormField>

                  {identityFields.slice(3).map((field) => (
                    <FormField key={field.name} label={field.label} required={['username', 'phone_number'].includes(field.name)}>
                      <Input name={field.name} onChange={handleChange} required={['username', 'phone_number'].includes(field.name)} value={form[field.name] || ''} />
                    </FormField>
                  ))}

                  <FormField hint="Borrowers must be at least 18 years old." label="Date of birth" required>
                    <Input
                      max={latestAdultBirthDate}
                      name="date_of_birth"
                      onChange={handleChange}
                      required
                      type="date"
                      value={form.date_of_birth || ''}
                    />
                  </FormField>

                  <FormField hint={form.profile_photo_url ? 'Upload a file only if you want to replace the saved photo.' : 'Required to complete your account.'} label="Profile photo" required>
                    <FileInput accept="image/*" onChange={(event) => setPhotoFile(event.target.files?.[0] || null)} required={!form.profile_photo_url} />
                  </FormField>
                  </div>
                </section>

                <section className="profile-form-section">
                  <div className="profile-form-section-heading">
                    <strong>NU Baliwag academic details</strong>
                    <span>These details come from the official student registry and cannot be edited here.</span>
                  </div>
                  <div className="form-grid profile-three-column-grid">
                    <FormField label="School">
                      <Input disabled value={getNubSchool(profile.school_code) ? `${profile.school_code} — ${getNubSchool(profile.school_code).name}` : 'Not available'} />
                    </FormField>
                    <FormField label="Program">
                      <Input disabled value={formatNubProgram(getNubProgram(profile.program_code)) || 'Not available'} />
                    </FormField>
                    <FormField label="Section">
                      <Input disabled value={profile.section || 'Not assigned'} />
                    </FormField>
                    <FormField label="Student number">
                      <Input disabled name="student_number" value={profile.student_number || 'Not available'} />
                    </FormField>
                    <FormField label="Year level">
                      <Input disabled value={profile.year_level ? `Year ${profile.year_level}` : 'Not available'} />
                    </FormField>
                  </div>
                  <StatusMessage tone="success">Enrollment and identity were confirmed from the administrator-managed NUB registry.</StatusMessage>
                </section>

                <section className="profile-form-section">
                  <div className="profile-form-section-heading">
                    <strong>Address</strong>
                    <span>Your location and community details.</span>
                  </div>
                  <PhilippineAddressFields
                    columnCount={3}
                    flatMap
                    form={form}
                    requiredFields={['street', 'region', 'province', 'city', 'barangay', 'country']}
                    setForm={setForm}
                    showCoordinates={false}
                  />
                </section>

                {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <Button style={{ flex: 1 }} type="submit">{profileDetailsComplete ? 'Save profile' : 'Complete profile'}</Button>
                  {profileDetailsComplete ? (
                    <Button onClick={() => setEditMode(false)} type="button" variant="ghost">
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="profile-record-sections">
                  <SectionCard title="Personal information">
                    <div className="profile-record-grid">
                      <RecordItem label="Username" value={username} />
                      <RecordItem label="Phone number" value={readValue(profile.phone_number)} />
                      <RecordItem label="Date of birth" value={profile.date_of_birth ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(`${profile.date_of_birth}T00:00:00`)) : 'Not available'} />
                      <div className="profile-record-address">
                        <RecordItem label="Address" value={readValue(fullAddress)} />
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title="NU Baliwag academic record">
                    <div className="profile-record-grid">
                      <RecordItem label="Campus" value={readValue(profile.campus_name, 'NU BALIWAG')} />
                      <RecordItem label="School" value={getNubSchool(profile.school_code) ? `${profile.school_code} — ${getNubSchool(profile.school_code).name}` : 'Not selected'} />
                      <RecordItem label="Program" value={formatNubProgram(getNubProgram(profile.program_code)) || 'Not selected'} />
                      <RecordItem label="Section" value={readValue(profile.section, 'Not assigned')} />
                      <RecordItem label="Student number" value={readValue(profile.student_number)} />
                      <RecordItem label="Year level" value={profile.year_level ? `Year ${profile.year_level}` : 'Not available'} />
                      <RecordItem label="Source" value="Official NUB student registry" />
                    </div>
                  </SectionCard>

                  <SectionCard title="Location map">
                    {mapUrl ? (
                      <iframe className="profile-record-map" src={mapUrl} title="Saved profile location" />
                    ) : (
                      <StatusMessage tone="info">Search for your address or use your current location while editing your profile to add the map.</StatusMessage>
                    )}
                  </SectionCard>
                </div>

                {message && messageTone !== 'success' ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
              </div>
            )}
          </Panel>
        </div>

      </div>
    </UserShell>
  );
}
