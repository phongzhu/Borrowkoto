import { useEffect, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { CalendarIcon, CheckIcon, ProfileIcon, ShieldIcon, UploadIcon } from '../../ui/icons';
import { SectionGrid } from '../../ui/layouts';
import { Badge, Button, FileInput, FormField, Input, Modal, Panel, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import UserShell from './UserShell';
import PhilippineAddressFields from '../../ui/PhilippineAddressFields';
import {
  buildMapEmbedUrl,
  buildProfileForm,
  ensureUniquePhoneNumber,
  ensureUniqueUsername,
  getVerificationIdTypeRule,
  normalizeMaskedIdNumber,
  sanitizeText,
  suffixOptions,
  validateMaskedIdNumber,
  validateBaliwagLocation,
  validateCoordinates,
  verificationIdTypeOptions,
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

function maskSensitiveCredential(value, fallback = 'Not available') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();

  if (!normalized) {
    return fallback;
  }

  const prefixLength = normalized.length > 4 ? 2 : 1;
  const suffixLength = normalized.length > 6 ? 1 : 0;
  const maskLength = Math.max(2, normalized.length - prefixLength - suffixLength);

  return `${normalized.slice(0, prefixLength)}${'•'.repeat(maskLength)}${suffixLength ? normalized.slice(-suffixLength) : ''}`;
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

function isAcceptedVerificationStatus(status) {
  return ['approved', 'verified'].includes(String(status || '').toLowerCase());
}

function getVerificationStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'verified') {
    return 'approved';
  }

  return status || 'Not submitted';
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

function DetailRow({ label, value }) {
  return (
    <div
      className="responsive-detail-row"
      style={{
        alignItems: 'start',
        borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        display: 'grid',
        gap: 10,
        gridTemplateColumns: '150px minmax(0, 1fr)',
        padding: '12px 0',
      }}
    >
      <span style={{ color: theme.colors.slate, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color: theme.colors.ink, lineHeight: 1.75, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function ContactCard({ label, style, value }) {
  return (
    <div
      style={{
        background: alpha(theme.colors.panel, 0.82),
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: 0,
        display: 'grid',
        gap: 6,
        minHeight: 106,
        padding: 16,
        ...style,
      }}
    >
      <span style={{ color: theme.colors.slate, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
      <span
        style={{
          color: theme.colors.ink,
          fontFamily: theme.fonts.display,
          fontSize: 18,
          letterSpacing: '-0.04em',
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
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
  const [verificationModalOpen, setVerificationModalOpen] = useState(false);
  const [verification, setVerification] = useState(null);
  const [verifForm, setVerifForm] = useState({ id_type: '', id_number_masked: '' });
  const [idFront, setIdFront] = useState(null);
  const [idBack, setIdBack] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [verifMsg, setVerifMsg] = useState('');
  const [verifTone, setVerifTone] = useState('success');

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
      const { data: verificationData } = await supabase
        .from('identity_verifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .single();

      if (!mounted) {
        return;
      }

      setUser(currentUser);
      setProfile(profileData || null);
      setForm(buildProfileForm(currentUser, profileData, 'user'));
      setVerification(verificationData || null);
      setLoading(false);
    }

    fetchProfile();

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

  function handleVerifChange(event) {
    const { name, value } = event.target;

    setVerifForm((current) => {
      if (name === 'id_type') {
        return { ...current, id_number_masked: '', [name]: value };
      }

      if (name === 'id_number_masked') {
        return { ...current, [name]: normalizeMaskedIdNumber(value) };
      }

      return { ...current, [name]: value };
    });
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

  async function uploadVerificationFile(bucketName, pathPrefix, file) {
    if (!file || !profile) {
      return '';
    }

    const storagePath = `public/${profile.id}/${pathPrefix}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from(bucketName).upload(storagePath, file, { upsert: true });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from(bucketName).getPublicUrl(storagePath);
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
      validateBaliwagLocation({ city: form.city, province: form.province, region: form.region });
      const updateData = {
        barangay: sanitizeText(form.barangay),
        city: sanitizeText(form.city),
        country: sanitizeText(form.country) || 'Philippines',
        date_of_birth: normalizedDateOfBirth,
        first_name: sanitizeText(form.first_name),
        last_name: sanitizeText(form.last_name),
        latitude,
        longitude,
        middle_name: sanitizeText(form.middle_name),
        phone_number: normalizedPhoneNumber,
        profile_photo_url: profilePhotoUrl,
        province: sanitizeText(form.province),
        region: sanitizeText(form.region),
        street: sanitizeText(form.street),
        suffix: sanitizeText(form.suffix),
        username: normalizedUsername,
      };
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

  async function handleVerificationSubmit(event) {
    event.preventDefault();
    setVerifMsg('');

    if (!profile) {
      return;
    }

    try {
      const normalizedMaskedIdNumber = validateMaskedIdNumber(verifForm.id_type, verifForm.id_number_masked);
      const [idFrontUrl, idBackUrl, selfieUrl] = await Promise.all([
        uploadVerificationFile('id-verifications', 'front', idFront),
        uploadVerificationFile('id-verifications', 'back', idBack),
        uploadVerificationFile('id-verifications', 'selfie', selfie),
      ]);

      const { data, error } = await supabase
        .from('identity_verifications')
        .insert([
          {
            id_back_url: idBackUrl,
            id_front_url: idFrontUrl,
            id_number_masked: normalizedMaskedIdNumber,
            id_type: verifForm.id_type,
            selfie_url: selfieUrl,
            status: 'pending',
            user_id: profile.id,
          },
        ])
        .select()
        .single();

      if (error) {
        throw new Error(error.message);
      }

      setVerification(data);
      setVerifMsg('Verification submitted. An admin review is now pending.');
      setVerifTone('success');
      setVerifForm({ id_type: '', id_number_masked: '' });
      setIdFront(null);
      setIdBack(null);
      setSelfie(null);
    } catch (submitError) {
      setVerifMsg(`Verification submission failed: ${submitError.message}`);
      setVerifTone('danger');
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
  const phone = readValue(liveProfile.phone_number);
  const address = [
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
  const verificationStatus = getVerificationStatusLabel(verification?.status);
  const rawVerificationStatus = String(verification?.status || '').toLowerCase();
  const canResubmitVerification = rawVerificationStatus === 'rejected';
  const verificationAccepted = isAcceptedVerificationStatus(verification?.status);
  const joinedAt = formatDate(profile.created_at || user?.created_at);
  const lastSignIn = formatDate(user?.last_sign_in_at);
  const profileCompletion = profile.is_profile_complete ? 'Complete' : 'Needs completion';
  const accountStatus = readValue(profile.account_status, 'Active');
  const verificationIdRule = getVerificationIdTypeRule(verifForm.id_type);
  const latestAdultBirthDate = formatDateInputValue(getLatestAdultBirthDate());
  const verificationActionLabel = verification
    ? verificationAccepted
      ? 'View ID'
      : canResubmitVerification
        ? 'Submit ID again'
        : 'View ID submission'
    : 'Submit ID verification';
  const verificationModalTitle = verification
    ? verificationAccepted
      ? 'Verified ID credentials'
      : canResubmitVerification
        ? 'Resubmit ID verification'
        : 'ID submission details'
    : 'Submit ID verification';

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
            You can continue updating your verification details or return to your member workspace.
          </p>
        </div>
      </Modal>

      <Modal onClose={() => setVerificationModalOpen(false)} open={verificationModalOpen} title={verificationModalTitle}>
        <div style={{ display: 'grid', gap: 18 }}>
          {verification && !canResubmitVerification ? (
            <div style={{ display: 'grid', gap: 18 }}>
              <p style={{ color: theme.colors.slate, lineHeight: 1.7, margin: 0 }}>
                Review the latest identity verification record attached to your member account.
              </p>

              <SectionGrid columns={3} style={{ gap: 14 }}>
                <SummaryTile icon={<ShieldIcon size={16} />} label="Status" value={verificationStatus} />
                <SummaryTile icon={<ProfileIcon size={16} />} label="ID type" value={readValue(verification.id_type)} />
                <SummaryTile icon={<CalendarIcon size={16} />} label="Submitted" value={formatDate(verification.submitted_at)} />
              </SectionGrid>

              <div className="panel-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                {[
                  ['Front ID', verification.id_front_url],
                  ['Back ID', verification.id_back_url],
                  ['Selfie', verification.selfie_url],
                ].map(([label, url]) => (
                  <div
                    key={label}
                    className="glass-panel interactive-panel"
                    style={{
                      borderRadius: 22,
                      color: theme.colors.ink,
                      display: 'grid',
                      gap: 10,
                      minHeight: 244,
                      overflow: 'hidden',
                      padding: 18,
                    }}
                  >
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
                      <UploadIcon size={16} />
                    </div>
                    <div
                      style={{
                        background: alpha(theme.colors.ink, 0.04),
                        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                        borderRadius: 16,
                        height: 148,
                        overflow: 'hidden',
                      }}
                    >
                      {url ? (
                        <img
                          alt={label}
                          src={url}
                          style={{
                            display: 'block',
                            height: '100%',
                            objectFit: 'cover',
                            width: '100%',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            alignItems: 'center',
                            color: theme.colors.slate,
                            display: 'flex',
                            height: '100%',
                            justifyContent: 'center',
                            lineHeight: 1.6,
                            padding: 16,
                            textAlign: 'center',
                          }}
                        >
                          No uploaded asset available
                        </div>
                      )}
                    </div>
                    <strong
                      style={{
                        fontFamily: theme.fonts.display,
                        fontSize: 18,
                        letterSpacing: '-0.04em',
                      }}
                    >
                      {label}
                    </strong>
                    <span style={{ color: theme.colors.slate, lineHeight: 1.65 }}>
                      {url ? 'Preview of the uploaded verification asset.' : 'No uploaded asset available.'}
                    </span>
                  </div>
                ))}
              </div>

              {verification.remarks ? <StatusMessage tone="info">Remarks: {verification.remarks}</StatusMessage> : null}
              {verifMsg ? <StatusMessage tone={verifTone}>{verifMsg}</StatusMessage> : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={() => setVerificationModalOpen(false)} type="button" variant="ghost">
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p style={{ color: theme.colors.slate, lineHeight: 1.7, margin: 0 }}>
                Upload the selected government ID, its supporting images, and a selfie so your member account can enter the trust review queue.
              </p>

              {canResubmitVerification ? (
                <StatusMessage tone="warning">
                  Your previous submission was rejected. {verification?.remarks ? `Reason: ${verification.remarks}` : 'Review the requirements and submit a corrected ID set.'}
                </StatusMessage>
              ) : null}

              <form onSubmit={handleVerificationSubmit} style={{ display: 'grid', gap: 18 }}>
                <div className="form-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  <FormField hint="Choose the government ID you are uploading for review." label="ID type">
                    <select name="id_type" onChange={handleVerifChange} required style={selectStyle} value={verifForm.id_type}>
                      {verificationIdTypeOptions.map((option) => (
                        <option key={option.value || 'none'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField
                    hint={verifForm.id_type ? `${verificationIdRule.description} Example: ${verificationIdRule.example}.` : verificationIdRule.description}
                    label="Masked ID number"
                  >
                    <Input
                      maxLength={verificationIdRule.maxLength}
                      name="id_number_masked"
                      onChange={handleVerifChange}
                      placeholder={verificationIdRule.placeholder}
                      required
                      value={verifForm.id_number_masked}
                    />
                  </FormField>
                </div>

                <div className="form-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                  <FormField label="Upload ID front">
                    <FileInput accept="image/*" onChange={(event) => setIdFront(event.target.files?.[0] || null)} required />
                  </FormField>
                  <FormField label="Upload ID back">
                    <FileInput accept="image/*" onChange={(event) => setIdBack(event.target.files?.[0] || null)} required />
                  </FormField>
                  <FormField label="Upload selfie">
                    <FileInput accept="image/*" onChange={(event) => setSelfie(event.target.files?.[0] || null)} required />
                  </FormField>
                </div>

                {verifMsg ? <StatusMessage tone={verifTone}>{verifMsg}</StatusMessage> : null}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
                  <Button onClick={() => setVerificationModalOpen(false)} type="button" variant="ghost">
                    Cancel
                  </Button>
                  <Button icon={<CheckIcon size={16} />} type="submit">
                    Submit verification
                  </Button>
                </div>
              </form>
            </>
          )}
        </div>
      </Modal>

      <div style={{ display: 'grid', gap: 20 }}>
        <Panel
          style={{
            borderRadius: 0,
            overflow: 'hidden',
            padding: 0,
          }}
        >
          <div
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

          <div style={{ marginTop: -32, padding: '0 30px 22px', position: 'relative' }}>
            <div style={{ display: 'grid', gap: 18 }}>
              <div className="responsive-flex-stack-start" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'space-between' }}>
                <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 18, minWidth: 0 }}>
                  <div
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
                      <Badge tone={toneFromStatus(verificationStatus)}>{verificationStatus}</Badge>
                    </div>
                  </div>
                </div>

                <div className="responsive-action-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {!verification ? (
                    <Button
                      onClick={() => {
                        setVerifMsg('');
                        setVerificationModalOpen(true);
                      }}
                      style={{ minWidth: 182 }}
                      type="button"
                      variant="secondary"
                    >
                      {verificationActionLabel}
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        setVerifMsg('');
                        setVerificationModalOpen(true);
                      }}
                      style={{ minWidth: 182 }}
                      type="button"
                      variant="secondary"
                    >
                      {verificationActionLabel}
                    </Button>
                  )}
                  <Button
                    onClick={() => setEditMode((current) => !current)}
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

        <div className="two-column" style={{ alignItems: 'stretch', display: 'grid', gap: 20, gridTemplateColumns: 'minmax(300px, 0.82fr) minmax(0, 1.18fr)' }}>
          <Panel
            style={{ borderRadius: 0, height: '100%' }}
            subtitle="The public-facing member details associated with your account."
            title="Contact record"
          >
            <div style={{ display: 'grid', gap: 14, gridTemplateRows: mapUrl ? 'repeat(3, auto) minmax(286px, 1fr)' : 'repeat(3, auto)' }}>
              <ContactCard label="Username" value={username} />
              <ContactCard label="Phone" value={phone} />
              <ContactCard label="Address" value={readValue(address)} />

              {mapUrl ? (
                <div
                  style={{
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 0,
                    minHeight: 286,
                    overflow: 'hidden',
                  }}
                >
                  <iframe src={mapUrl} style={{ border: 0, display: 'block', height: '100%', minHeight: 286, width: '100%' }} title="Member location" />
                </div>
              ) : (
                <StatusMessage tone="info">Set your address coordinates to show a member location preview.</StatusMessage>
              )}
            </div>
          </Panel>

          <Panel
            style={{ borderRadius: 0, height: '100%' }}
            subtitle={
              editMode
                ? 'Update the saved profile fields from this formal account record.'
                : 'A formal view of your personal record, trust state, and account timeline.'
            }
            title={editMode ? 'Edit personal details' : 'Identity and account record'}
          >
            {editMode ? (
              <form className="responsive-scroll-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 18, maxHeight: '78vh', overflowY: 'auto', paddingRight: 6 }}>
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

                  <FormField hint="Borrowers must be at least 18 years old." label="Date of birth">
                    <Input
                      max={latestAdultBirthDate}
                      name="date_of_birth"
                      onChange={handleChange}
                      required
                      type="date"
                      value={form.date_of_birth || ''}
                    />
                  </FormField>
                </div>

                <PhilippineAddressFields form={form} setForm={setForm} />

                <FormField hint="Optional. Upload a new profile image to refresh the formal profile header." label="Profile photo">
                  <FileInput accept="image/*" onChange={(event) => setPhotoFile(event.target.files?.[0] || null)} />
                </FormField>

                {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  <Button style={{ flex: 1 }} type="submit">
                    Save profile
                  </Button>
                  <Button onClick={() => setEditMode(false)} type="button" variant="ghost">
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                <SectionCard
                  style={{
                    background: alpha(theme.colors.sky, 0.05),
                    border: `1px solid ${alpha(theme.colors.sky, 0.12)}`,
                    minHeight: 106,
                  }}
                >
                  <strong
                    style={{
                      color: theme.colors.ink,
                      fontFamily: theme.fonts.display,
                      fontSize: 20,
                      letterSpacing: '-0.04em',
                    }}
                  >
                    Trust status
                  </strong>
                  <span style={{ color: theme.colors.slate, lineHeight: 1.7 }}>
                    {verification
                      ? `Your latest verification is ${verificationStatus}. ${verification.id_type ? `Document type: ${verification.id_type}.` : ''}`
                      : 'You have not submitted an identity verification yet.'}
                  </span>
                </SectionCard>

                <div style={{ display: 'grid', gap: 14, gridTemplateRows: 'repeat(2, minmax(286px, 1fr))' }}>
                  <SectionCard style={{ minHeight: 286, padding: '14px 18px 10px' }} title="Personal identity">
                    <div style={{ display: 'grid', maxHeight: 220, overflowY: 'auto' }}>
                      <DetailRow label="Email" value={readValue(user?.email)} />
                      <DetailRow label="First name" value={readValue(profile.first_name)} />
                      <DetailRow label="Middle name" value={readValue(profile.middle_name)} />
                      <DetailRow label="Last name" value={readValue(profile.last_name)} />
                      <DetailRow label="Suffix" value={readValue(profile.suffix)} />
                      <DetailRow label="Date of birth" value={profile.date_of_birth ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(`${profile.date_of_birth}T00:00:00`)) : 'Not available'} />
                    </div>
                  </SectionCard>

                  <SectionCard style={{ minHeight: 286, padding: '14px 18px 10px' }} title="Account timeline">
                    <div style={{ display: 'grid', maxHeight: 220, overflowY: 'auto' }}>
                      <DetailRow label="Verification" value={verificationStatus} />
                      <DetailRow label="Verification ID type" value={readValue(verification?.id_type)} />
                      <DetailRow label="Masked ID" value={maskSensitiveCredential(verification?.id_number_masked)} />
                    <DetailRow label="Joined" value={joinedAt} />
                      <DetailRow label="Last sign-in" value={lastSignIn} />
                      <DetailRow label="Profile completion" value={profileCompletion} />
                      <DetailRow label="Account status" value={accountStatus} />
                      {verification?.remarks ? <DetailRow label="Verification remarks" value={verification.remarks} /> : null}
                    </div>
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
