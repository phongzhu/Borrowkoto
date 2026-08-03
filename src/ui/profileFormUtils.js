export const suffixOptions = [
  { label: 'No suffix', value: '' },
  { label: 'Jr.', value: 'Jr.' },
  { label: 'Sr.', value: 'Sr.' },
  { label: 'II', value: 'II' },
  { label: 'III', value: 'III' },
  { label: 'IV', value: 'IV' },
  { label: 'V', value: 'V' },
];

export const verificationIdTypeOptions = [
  { label: 'Select ID type', value: '' },
  { label: 'PhilSys National ID', value: 'PhilSys National ID' },
  { label: 'Passport', value: 'Passport' },
  { label: "Driver's License", value: "Driver's License" },
  { label: 'UMID / SSS', value: 'UMID / SSS' },
  { label: 'PRC ID', value: 'PRC ID' },
  { label: 'Postal ID', value: 'Postal ID' },
  { label: "Voter's ID", value: "Voter's ID" },
  { label: 'Senior Citizen ID', value: 'Senior Citizen ID' },
  { label: 'Other Government ID', value: 'Other Government ID' },
];

const verificationIdTypeRules = {
  'PhilSys National ID': {
    description: 'Use 16 characters in four groups of four. Digits may be hidden with X.',
    example: 'XXXX-XXXX-1234-5678',
    maxLength: 19,
    placeholder: 'XXXX-XXXX-1234-5678',
    regex: /^[0-9X]{4}-[0-9X]{4}-[0-9X]{4}-[0-9X]{4}$/i,
  },
  Passport: {
    description: 'Use the passport reference as 8 to 9 letters or digits. Hidden characters may use X.',
    example: 'PX34567X',
    maxLength: 9,
    placeholder: 'PX34567X',
    regex: /^[A-Z0-9X]{8,9}$/i,
  },
  "Driver's License": {
    description: 'Use the license number in three groups. Letters or digits may be hidden with X.',
    example: 'N01-23-456789',
    maxLength: 13,
    placeholder: 'N01-23-456789',
    regex: /^[A-Z0-9X]{1,4}-[A-Z0-9X]{2}-[A-Z0-9X]{6}$/i,
  },
  'UMID / SSS': {
    description: 'Use the UMID or SSS number in the standard three-part format.',
    example: 'XXXX-1234567-8',
    maxLength: 14,
    placeholder: 'XXXX-1234567-8',
    regex: /^[0-9X]{4}-[0-9X]{7}-[0-9X]$/i,
  },
  'PRC ID': {
    description: 'Use the seven-digit PRC number. Hidden digits may use X.',
    example: 'XXX4567',
    maxLength: 7,
    placeholder: 'XXX4567',
    regex: /^[0-9X]{7}$/i,
  },
  'Postal ID': {
    description: 'Use the printed Postal ID reference. Letters or digits may be hidden with X.',
    example: 'XX-123456789-0',
    maxLength: 20,
    placeholder: 'XX-123456789-0',
    regex: /^[A-Z0-9X-]{8,20}$/i,
  },
  "Voter's ID": {
    description: 'Use the voter reference exactly as printed. Letters or digits may be hidden with X.',
    example: 'XXXX-XXXX-1234',
    maxLength: 20,
    placeholder: 'XXXX-XXXX-1234',
    regex: /^[A-Z0-9X-]{8,20}$/i,
  },
  'Senior Citizen ID': {
    description: 'Use the card number as printed. Letters or digits may be hidden with X.',
    example: 'SC-XXXX-123456',
    maxLength: 20,
    placeholder: 'SC-XXXX-123456',
    regex: /^[A-Z0-9X-]{6,20}$/i,
  },
  'Other Government ID': {
    description: 'Use the official government ID reference. Letters or digits may be hidden with X.',
    example: 'ID-XXXX-123456',
    maxLength: 24,
    placeholder: 'ID-XXXX-123456',
    regex: /^[A-Z0-9X-]{6,24}$/i,
  },
};

const fallbackVerificationIdRule = {
  description: 'Select an ID type to load the correct masked number format.',
  example: '',
  maxLength: 24,
  placeholder: '',
  regex: /^[A-Z0-9X-]{6,24}$/i,
};

export function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeMaskedIdNumber(value) {
  return sanitizeText(value).toUpperCase();
}

export function getVerificationIdTypeRule(idType) {
  return verificationIdTypeRules[idType] || fallbackVerificationIdRule;
}

export function validateMaskedIdNumber(idType, value) {
  const selectedIdType = sanitizeText(idType);
  const maskedValue = normalizeMaskedIdNumber(value);

  if (!selectedIdType) {
    throw new Error('Select an ID type before entering the masked ID number.');
  }

  if (!maskedValue) {
    throw new Error('Masked ID number is required.');
  }

  const rule = getVerificationIdTypeRule(selectedIdType);

  if (!rule.regex.test(maskedValue)) {
    throw new Error(`Masked ID number must follow this format: ${rule.example}.`);
  }

  return maskedValue;
}

export function buildProfileForm(user, profile, defaultRole = 'user') {
  return {
    barangay: profile?.barangay || '',
    city: profile?.city || '',
    country: profile?.country || 'Philippines',
    date_of_birth: profile?.date_of_birth || '',
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    latitude: profile?.latitude === null || profile?.latitude === undefined ? '' : String(profile.latitude),
    longitude: profile?.longitude === null || profile?.longitude === undefined ? '' : String(profile.longitude),
    middle_name: profile?.middle_name || '',
    phone_number: profile?.phone_number || '',
    profile_photo_url: profile?.profile_photo_url || '',
    province: profile?.province || '',
    region: profile?.region || '',
    role: profile?.role || user?.user_metadata?.role || defaultRole,
    street: profile?.street || '',
    suffix: profile?.suffix || '',
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

export function validateBaliwagLocation({ city, province, region }) {
  const normalizedCity = sanitizeText(city).toLowerCase();
  const normalizedProvince = sanitizeText(province).toLowerCase();
  const normalizedRegion = sanitizeText(region).toLowerCase();
  const cityAllowed =
    normalizedCity === 'baliwag' ||
    normalizedCity === 'baliuag' ||
    normalizedCity === 'city of baliwag' ||
    normalizedCity.includes('baliwag') ||
    normalizedCity.includes('baliuag');

  if (!cityAllowed || normalizedProvince !== 'bulacan' || (normalizedRegion && !normalizedRegion.includes('region iii') && !normalizedRegion.includes('central luzon'))) {
    throw new Error('Location is limited to Baliwag/Baliuag, Bulacan only.');
  }
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
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
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
