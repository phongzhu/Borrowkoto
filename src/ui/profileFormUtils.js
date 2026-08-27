export const suffixOptions = [
  { label: 'No suffix', value: '' },
  { label: 'Jr.', value: 'Jr.' },
  { label: 'Sr.', value: 'Sr.' },
  { label: 'II', value: 'II' },
  { label: 'III', value: 'III' },
  { label: 'IV', value: 'IV' },
  { label: 'V', value: 'V' },
];

export function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const requiredStudentProfileDetails = [
  { label: 'first name', name: 'first_name' },
  { label: 'last name', name: 'last_name' },
  { label: 'username', name: 'username' },
  { label: 'phone number', name: 'phone_number' },
  { label: 'date of birth', name: 'date_of_birth' },
  { label: 'profile photo', name: 'profile_photo_url' },
  { label: 'school', name: 'school_code' },
  { label: 'program', name: 'program_code' },
  { label: 'street address', name: 'street' },
  { label: 'barangay', name: 'barangay' },
  { label: 'city', name: 'city' },
  { label: 'province', name: 'province' },
  { label: 'region', name: 'region' },
  { label: 'country', name: 'country' },
];

export function getMissingStudentProfileDetails(profileValue) {
  return requiredStudentProfileDetails
    .filter(({ name }) => !sanitizeText(profileValue?.[name]))
    .map(({ label }) => label);
}

export function buildProfileForm(user, profile, defaultRole = 'user') {
  const metadata = user?.user_metadata || {};
  return {
    barangay: profile?.barangay || '',
    city: profile?.city || '',
    country: profile?.country || 'Philippines',
    date_of_birth: profile?.date_of_birth || '',
    campus_name: profile?.campus_name || '',
    first_name: profile?.first_name || metadata.first_name || '',
    last_name: profile?.last_name || metadata.last_name || '',
    latitude: profile?.latitude === null || profile?.latitude === undefined ? '' : String(profile.latitude),
    longitude: profile?.longitude === null || profile?.longitude === undefined ? '' : String(profile.longitude),
    middle_name: profile?.middle_name || metadata.middle_name || '',
    phone_number: profile?.phone_number || '',
    profile_photo_url: profile?.profile_photo_url || '',
    province: profile?.province || '',
    region: profile?.region || '',
    role: profile?.role || user?.user_metadata?.role || defaultRole,
    school_code: profile?.school_code || metadata.school_code || '',
    section: profile?.section || metadata.section || '',
    street: profile?.street || '',
    student_number: profile?.student_number || '',
    suffix: profile?.suffix || '',
    program_code: profile?.program_code || metadata.program_code || '',
    username: profile?.username || '',
  };
}

export function normalizePhoneNumber(value) {
  const text = sanitizeText(value);

  if (!text) {
    return '';
  }

  const digits = text.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  if (digits.length === 10 && digits.startsWith('9')) {
    return `+63${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    return `+63${digits.slice(1)}`;
  }

  if (digits.length === 12 && digits.startsWith('63')) {
    return `+${digits}`;
  }

  return text.startsWith('+') ? `+${digits}` : digits;
}

export async function ensureUniquePhoneNumber(supabase, phoneNumber, currentUserId) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  if (!normalizedPhone) {
    return '';
  }

  const { data, error } = await supabase.from('profiles').select('id, phone_number').not('phone_number', 'is', null);

  if (error) {
    throw new Error(error.message);
  }

  const duplicate = (data || []).find((profile) => {
    if (!profile?.phone_number || profile.id === currentUserId) {
      return false;
    }

    return normalizePhoneNumber(profile.phone_number) === normalizedPhone;
  });

  if (duplicate) {
    throw new Error('That mobile number is already assigned to another account.');
  }

  return normalizedPhone;
}

export async function ensureUniqueUsername(supabase, username, currentUserId) {
  const normalizedUsername = sanitizeText(username).toLowerCase();

  if (!normalizedUsername) {
    return '';
  }

  const { data, error } = await supabase.from('profiles').select('id, username').not('username', 'is', null);

  if (error) {
    throw new Error(error.message);
  }

  const duplicate = (data || []).find((profile) => {
    if (!profile?.username || profile.id === currentUserId) {
      return false;
    }

    return sanitizeText(profile.username).toLowerCase() === normalizedUsername;
  });

  if (duplicate) {
    throw new Error('That username already exists. Please choose another one.');
  }

  return sanitizeText(username);
}

export function parseCoordinate(value, label) {
  const text = sanitizeText(value);

  if (!text) {
    return null;
  }

  const parsed = Number(text);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return parsed;
}

export function validateCoordinates(latitudeValue, longitudeValue) {
  const latitude = parseCoordinate(latitudeValue, 'Latitude');
  const longitude = parseCoordinate(longitudeValue, 'Longitude');

  if ((latitude === null) !== (longitude === null)) {
    throw new Error('Latitude and longitude must both be set together.');
  }

  if (latitude !== null && (latitude < -90 || latitude > 90)) {
    throw new Error('Latitude must be between -90 and 90.');
  }

  if (longitude !== null && (longitude < -180 || longitude > 180)) {
    throw new Error('Longitude must be between -180 and 180.');
  }

  return { latitude, longitude };
}

export function buildAddressQuery(form) {
  return [
    sanitizeText(form?.street),
    sanitizeText(form?.barangay),
    sanitizeText(form?.city),
    sanitizeText(form?.province),
    sanitizeText(form?.region),
    sanitizeText(form?.country) || 'Philippines',
  ]
    .filter(Boolean)
    .join(', ');
}

export function buildMapEmbedUrl(latitudeValue, longitudeValue) {
  if (latitudeValue === null || latitudeValue === undefined || sanitizeText(String(latitudeValue)) === '' ||
      longitudeValue === null || longitudeValue === undefined || sanitizeText(String(longitudeValue)) === '') {
    return '';
  }

  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || (latitude === 0 && longitude === 0)) {
    return '';
  }

  const delta = 0.008;
  const minLon = longitude - delta;
  const minLat = latitude - delta;
  const maxLon = longitude + delta;
  const maxLat = latitude + delta;

  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}

export async function geocodePhilippineAddress(query) {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=ph&q=${encodeURIComponent(query)}`
  );

  if (!response.ok) {
    throw new Error(`Map lookup failed (${response.status})`);
  }

  const results = await response.json();
  const firstMatch = results?.[0];

  if (!firstMatch) {
    throw new Error('No map match was found for the selected address.');
  }

  return {
    address: firstMatch.address || null,
    latitude: Number(firstMatch.lat).toFixed(7),
    longitude: Number(firstMatch.lon).toFixed(7),
    label: firstMatch.display_name,
  };
}
