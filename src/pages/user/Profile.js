import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { CalendarIcon, ProfileIcon, ShieldIcon, UploadIcon } from '../../ui/icons';
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
  sanitizeText,
  suffixOptions,
  validateMaskedIdNumber,
  validateBaliwagLocation,
  validateCoordinates,
} from '../../ui/profileFormUtils';

const identityFields = [
  { name: 'first_name', label: 'First name' },
  { name: 'middle_name', label: 'Middle name' },
  { name: 'last_name', label: 'Last name' },
  { name: 'username', label: 'Username' },
  { name: 'phone_number', label: 'Phone number' },
];

const requiredProfileDetails = [
  { label: 'first name', name: 'first_name' },
  { label: 'last name', name: 'last_name' },
  { label: 'username', name: 'username' },
  { label: 'phone number', name: 'phone_number' },
  { label: 'date of birth', name: 'date_of_birth' },
  { label: 'street address', name: 'street' },
  { label: 'barangay', name: 'barangay' },
  { label: 'city', name: 'city' },
  { label: 'province', name: 'province' },
  { label: 'region', name: 'region' },
  { label: 'country', name: 'country' },
];

function getMissingProfileDetails(profileValue) {
  return requiredProfileDetails
    .filter(({ name }) => !sanitizeText(profileValue?.[name]))
    .map(({ label }) => label);
}

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

function normalizeDiditDecision(decision) {
  const idVerification = decision?.id_verifications?.[0] || decision?.id_verification || decision?.verification || decision?.result || {};
  const contactDetails = decision?.contact_details?.[0] || decision?.contact_details || {};
  const parsedAddress = idVerification?.parsed_address || contactDetails?.parsed_address || {};

  return {
    date_of_birth: String(idVerification?.date_of_birth || contactDetails?.date_of_birth || '').trim(),
    first_name: String(idVerification?.first_name || contactDetails?.first_name || '').trim(),
    last_name: String(idVerification?.last_name || contactDetails?.last_name || '').trim(),
    middle_name: String(contactDetails?.middle_name || '').trim(),
    region: String(parsedAddress?.region || '').trim(),
    street: String(parsedAddress?.street_1 || parsedAddress?.street || contactDetails?.address || '').trim(),
  };
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

export default function Profile({ verificationPage = false }) {
  const navigate = useNavigate();
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
  const [verification, setVerification] = useState(null);
  const [verifForm, setVerifForm] = useState({ id_type: '', id_number_masked: '' });
  const [idFront, setIdFront] = useState(null);
  const [idBack, setIdBack] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [verifMsg, setVerifMsg] = useState('');
  const [verifTone, setVerifTone] = useState('success');
  const [diditSessionUrl, setDiditSessionUrl] = useState('');
  const [diditSessionId, setDiditSessionId] = useState('');
  const [diditSessionLoading, setDiditSessionLoading] = useState(false);
  const [diditSessionError, setDiditSessionError] = useState('');

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
      const { data: verificationRows } = await supabase
        .from('identity_verifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('submitted_at', { ascending: false })
        .limit(20);

      const verificationData = (verificationRows || []).find((row) => isAcceptedVerificationStatus(row.status))
        || verificationRows?.[0]
        || null;

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

  async function startDiditSession() {
    setVerifMsg('');
    setVerifTone('success');
    setDiditSessionError('');
    setDiditSessionLoading(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const response = await fetch('/api/didit', {
        body: JSON.stringify({
          action: 'create-session',
          workflow_id: '8f902160-00ff-4cc2-823c-af17f4bc99b3',
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        method: 'POST',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to start Didit verification.');
      }

      setDiditSessionId(payload?.session_id || '');
      setDiditSessionUrl(payload?.url || '');
      if (!payload?.url) {
        throw new Error('Didit returned no verification URL.');
      }
    } catch (error) {
      setDiditSessionError(`Didit session failed: ${error.message}`);
      setVerifTone('danger');
    } finally {
      setDiditSessionLoading(false);
    }
  }

  useEffect(() => {
    if (!diditSessionId) {
      return undefined;
    }

    let mounted = true;
    let pollInProgress = false;
    let timer = null;

    async function pollDecision() {
      if (pollInProgress) return;
      pollInProgress = true;

      try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return;
      }

      const response = await fetch('/api/didit', {
        body: JSON.stringify({
          action: 'session-decision',
          session_id: diditSessionId,
        }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        method: 'POST',
      });

      const payload = await response.json().catch(() => null);
      if (!mounted) {
        return;
      }

      if (!response.ok) {
        setDiditSessionError(payload?.error || 'Unable to retrieve the Didit verification result.');
        setVerifMsg(payload?.error || 'Unable to retrieve the Didit verification result.');
        setVerifTone('danger');

        if ([401, 403].includes(response.status)) {
          setDiditSessionId('');
        }
        return;
      }

      if (!payload?.verified) {
        return;
      }

      const diditFields = normalizeDiditDecision(payload?.decision);
      const updates = {};

      if (diditFields.first_name) updates.first_name = diditFields.first_name;
      if (diditFields.middle_name) updates.middle_name = diditFields.middle_name;
      if (diditFields.last_name) updates.last_name = diditFields.last_name;
      if (diditFields.date_of_birth) updates.date_of_birth = diditFields.date_of_birth;
      if (diditFields.region) updates.region = diditFields.region;
      if (diditFields.street) updates.street = diditFields.street;

      if (Object.keys(updates).length) {
        const { error } = await supabase.from('profiles').update(updates).eq('id', profile.id);
        if (!error) {
          setProfile((current) => ({ ...current, ...updates }));
          setForm((current) => ({ ...current, ...updates }));
        }
      }

      setProfile((current) => ({
        ...current,
        is_verified: true,
        verification_status: 'verified',
      }));

      setVerification((current) => ({
        ...(current || {}),
        ...(payload?.verification || {}),
        id_type: payload?.verification?.id_type || current?.id_type || verifForm.id_type || 'Didit verification',
        status: 'verified',
      }));
      setDiditSessionId('');
      setDiditSessionUrl('');
      setVerifMsg(
        payload?.document_import_error
          ? `Didit verified your identity, but the document copy could not be saved: ${payload.document_import_error}`
          : 'Didit verification completed. Profile fields and document copies were saved.'
      );
      setVerifTone(payload?.document_import_error ? 'warning' : 'success');
      } finally {
        pollInProgress = false;
      }
    }

    timer = window.setInterval(pollDecision, 5000);
    pollDecision();

    return () => {
      mounted = false;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [diditSessionId, profile?.id, verifForm.id_type]);

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
      const diditApproved = isAcceptedVerificationStatus(verification?.status)
        || profile?.is_verified
        || isAcceptedVerificationStatus(profile?.verification_status);

      if (diditApproved) {
        updateData.is_verified = true;
        updateData.verification_status = 'verified';
      }
      const missingDetails = getMissingProfileDetails(updateData);

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

      const shouldSubmitVerification = Boolean(verifForm.id_type && verifForm.id_number_masked && (idFront || idBack || selfie));

      if (shouldSubmitVerification) {
        const normalizedMaskedIdNumber = validateMaskedIdNumber(verifForm.id_type, verifForm.id_number_masked);
        const [idFrontUrl, idBackUrl, selfieUrl] = await Promise.all([
          uploadVerificationFile('id-verifications', 'front', idFront),
          uploadVerificationFile('id-verifications', 'back', idBack),
          uploadVerificationFile('id-verifications', 'selfie', selfie),
        ]);
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const verificationResponse = await fetch('/api/didit', {
          body: JSON.stringify({
            id_back_url: idBackUrl,
            id_front_url: idFrontUrl,
            id_number_masked: normalizedMaskedIdNumber,
            id_type: verifForm.id_type,
            selfie_url: selfieUrl,
          }),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
          method: 'POST',
        });

        const verificationBody = await verificationResponse.json().catch(() => null);

        if (!verificationResponse.ok) {
          throw new Error(verificationBody?.error || 'Verification failed.');
        }

        if (verificationBody?.profile_updates) {
          setProfile((current) => ({ ...current, ...verificationBody.profile_updates }));
          setForm((current) => ({ ...current, ...verificationBody.profile_updates }));
        }

        setVerification(verificationBody?.verification || null);
        setVerifMsg(
          verificationBody?.status === 'verified'
            ? 'ID verified and your profile details were auto-filled from Didit.'
            : 'ID uploaded and submitted for verification.'
        );
        setVerifTone('success');
        setVerifForm({ id_type: '', id_number_masked: '' });
        setIdFront(null);
        setIdBack(null);
        setSelfie(null);
      }

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
  const profileVerificationAccepted = Boolean(profile?.is_verified)
    || isAcceptedVerificationStatus(profile?.verification_status);
  const storedVerificationStatus = profileVerificationAccepted
    ? 'verified'
    : verification?.status || profile?.verification_status || '';
  const verificationStatus = getVerificationStatusLabel(storedVerificationStatus);
  const rawVerificationStatus = String(verification?.status || '').toLowerCase();
  const canResubmitVerification = !profileVerificationAccepted && rawVerificationStatus === 'rejected';
  const verificationAccepted = profileVerificationAccepted || isAcceptedVerificationStatus(verification?.status);
  const joinedAt = formatDate(profile.created_at || user?.created_at);
  const lastSignIn = formatDate(user?.last_sign_in_at);
  const missingProfileDetails = getMissingProfileDetails(profile);
  const profileDetailsComplete = missingProfileDetails.length === 0;
  const profileCompletion = profileDetailsComplete ? 'Complete' : 'Needs completion';
  const accountStatus = readValue(profile.account_status, 'Active');
  const latestAdultBirthDate = formatDateInputValue(getLatestAdultBirthDate());
  const verificationModalTitle = verification ? (verificationAccepted ? 'Verified ID credentials' : 'ID submission details') : 'Didit verification';

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
            Your verified profile is ready. You can now return to your member workspace.
          </p>
        </div>
      </Modal>

      <Modal
        contentClassName="profile-verification-page"
        inline={verificationPage}
        onClose={() => navigate('/user/profile')}
        open={verificationPage}
        title={verificationModalTitle}
      >
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
                <Button onClick={() => navigate('/user/profile')} type="button" variant="ghost">
                  Back to profile
                </Button>
              </div>
            </div>
          ) : (
            <>
              <StatusMessage tone="info">
                Didit verification now opens as a hosted session. Start it from the edit form to scan your ID and selfie, then we will auto-fill supported profile fields.
              </StatusMessage>

              {diditSessionUrl ? (
                <div className="didit-inline-session">
                  <div className="didit-qr-card">
                    <QRCodeSVG level="M" marginSize={2} size={220} value={diditSessionUrl} />
                    <strong>Scan with your phone</strong>
                    <span>Use your phone camera to open the secure Didit ID and selfie verification.</span>
                  </div>
                  <div className="didit-session-copy">
                    <StatusMessage tone="info">Your verification session is ready. Scan the QR or open it on this device.</StatusMessage>
                    <Button as="a" href={diditSessionUrl} rel="noreferrer" target="_blank" type="button">
                      Open verification
                    </Button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 18 }}>
                  <p style={{ color: theme.colors.slate, lineHeight: 1.7, margin: 0 }}>
                    Start the hosted verification session to scan your ID and complete selfie capture with Didit.
                  </p>
                  {diditSessionError ? <StatusMessage tone={verifTone}>{diditSessionError}</StatusMessage> : null}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Button disabled={diditSessionLoading} onClick={startDiditSession} type="button">
                      {diditSessionLoading ? 'Starting verification...' : 'Start Didit verification'}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {!verificationPage ? <div style={{ display: 'grid', gap: 20 }}>
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
                      <Badge tone={toneFromStatus(verificationStatus)}>{verificationStatus}</Badge>
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
            title={editMode ? 'Edit personal details' : 'Identity and account record'}
          >
            {editMode ? (
              <form className="responsive-scroll-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 18, maxHeight: '78vh', overflowY: 'auto', paddingRight: 6 }}>
                {!verificationAccepted ? <section className="profile-form-section">
                  <div className="profile-form-section-heading">
                    <strong>Didit verification</strong>
                    <span>Start here first. Scan the QR with your phone to capture your ID and selfie, then supported details will populate automatically.</span>
                  </div>

                  {diditSessionUrl ? (
                    <div className="didit-inline-session">
                      <div className="didit-qr-card">
                        <QRCodeSVG level="M" marginSize={2} size={220} value={diditSessionUrl} />
                        <strong>Scan to verify your identity</strong>
                        <span>Open your phone camera and scan this code to continue in Didit.</span>
                      </div>
                      <div className="didit-session-copy">
                        <strong>Verification session ready</strong>
                        <span>Didit will capture the front and back of your ID and your selfie. Keep this page open while completing the steps.</span>
                        <div className="didit-action-row">
                          <Button as="a" className="didit-primary-action" href={diditSessionUrl} rel="noreferrer" target="_blank" type="button">
                            Open on this device
                          </Button>
                          <Button className="didit-secondary-action" disabled={diditSessionLoading} onClick={startDiditSession} type="button" variant="ghost">
                            Start a new session
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Button disabled={diditSessionLoading} onClick={startDiditSession} type="button">
                        {diditSessionLoading ? 'Starting verification...' : 'Start Didit verification'}
                      </Button>
                    </div>
                  )}
                  {diditSessionError ? <StatusMessage tone={verifTone}>{diditSessionError}</StatusMessage> : null}
                </section> : null}

                <section className="profile-form-section">
                  <div className="profile-form-section-heading">
                    <strong>Personal details</strong>
                    <span>Complete the profile after verification. Didit will fill supported fields automatically when available.</span>
                  </div>

                  <div className="form-grid profile-three-column-grid">
                  {identityFields.slice(0, 3).map((field) => (
                    <FormField key={field.name} label={field.label} required={['first_name', 'last_name'].includes(field.name)}>
                      <Input name={field.name} onChange={handleChange} required={['first_name', 'last_name'].includes(field.name)} value={form[field.name] || ''} />
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

                  <FormField hint="Optional. Upload a new profile image." label="Profile photo">
                    <FileInput accept="image/*" onChange={(event) => setPhotoFile(event.target.files?.[0] || null)} />
                  </FormField>
                  </div>
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
                  <Button style={{ flex: 1 }} type="submit">
                    Save profile and verify ID
                  </Button>
                  <Button onClick={() => setEditMode(false)} type="button" variant="ghost">
                    Cancel
                  </Button>
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

      </div> : null}
    </UserShell>
  );
}
