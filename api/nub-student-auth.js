const { createClient } = require('@supabase/supabase-js');

const NUB_STUDENT_DOMAIN = 'students.nu-baliwag.edu.ph';
const REGISTRY_SYNC_VERSION = 2;
const DEV_STUDENT_OTP = '000000';
const requestWindows = new Map();

function text(value) {
  return String(value || '').trim();
}

function readableErrorMessage(error, fallback = 'Unexpected student registry error.') {
  if (error instanceof Error && text(error.message)) return text(error.message);
  if (error && typeof error === 'object' && text(error.message)) return text(error.message);
  if (typeof error === 'string' && text(error)) return text(error);
  return fallback;
}

function normalizeEmail(value) {
  return text(value).toLowerCase();
}

function isNubStudentEmail(value) {
  const parts = normalizeEmail(value).split('@');
  return parts.length === 2 && Boolean(parts[0]) && parts[1] === NUB_STUDENT_DOMAIN;
}

function isValidStudentPassword(value) {
  const password = String(value || '');
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password);
}

function isRegistryActivationRequired(registry) {
  return !text(registry?.activated_at);
}

function isDevStudentOtpBypassEnabled(request, environment = process.env) {
  const host = text(request?.headers?.host).toLowerCase();
  const isLocalHost = /^(localhost|127[.]0[.]0[.]1|\[::1\])(?::\d+)?$/.test(host);
  return environment.NODE_ENV === 'development'
    && text(environment.ENABLE_DEV_STUDENT_OTP_BYPASS).toLowerCase() === 'true'
    && isLocalHost;
}

function getAdminClient() {
  const url = text(process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL)
    || 'https://fndvviirhvqrocuycpfr.supabase.co';
  const serviceRoleKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!serviceRoleKey) {
    throw new Error('Student registry login is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.');
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isRateLimited(request, email) {
  const forwarded = text(request.headers['x-forwarded-for']).split(',')[0];
  const key = `${forwarded || request.socket?.remoteAddress || 'unknown'}:${email}`;
  const now = Date.now();
  const windowStart = now - 15 * 60 * 1000;
  const attempts = (requestWindows.get(key) || []).filter((timestamp) => timestamp >= windowStart);
  attempts.push(now);
  requestWindows.set(key, attempts);
  return attempts.length > 10;
}

function authMetadata(registry) {
  return {
    first_name: registry.first_name,
    last_name: registry.last_name,
    middle_name: registry.middle_name || '',
    nub_registry_managed: true,
    program_code: registry.program_code,
    school_code: registry.school_code,
    school_status: registry.school_status,
    section: registry.section || '',
    student_number: registry.student_number,
    suffix: registry.suffix || '',
    year_level: registry.year_level,
  };
}

async function findAuthUserByEmail(supabase, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data?.users || [];
    const match = users.find((user) => normalizeEmail(user.email) === email);
    if (match) return match;
    if (users.length < 1000) break;
  }
  return null;
}

async function ensureRegistryAuthUser(supabase, registry) {
  let user = null;

  if (registry.auth_user_id) {
    const { data, error } = await supabase.auth.admin.getUserById(registry.auth_user_id);
    if (!error && normalizeEmail(data?.user?.email) === registry.email) user = data?.user || null;
  }

  if (!user) user = await findAuthUserByEmail(supabase, registry.email);

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: registry.email,
      email_confirm: false,
      user_metadata: authMetadata(registry),
    });
    if (error) throw error;
    user = data?.user || null;
  }

  if (!user?.id) throw new Error('The student login account could not be provisioned.');

  const { error: metadataError } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { ...(user.user_metadata || {}), ...authMetadata(registry) },
  });
  if (metadataError) throw metadataError;

  const linkChanged = registry.auth_user_id !== user.id;
  if (linkChanged) {
    const { error: linkError } = await supabase
      .from('nub_student_registry')
      .update({ auth_user_id: user.id })
      .eq('id', registry.id);
    if (linkError) throw linkError;
  }

  return { activationRequired: isRegistryActivationRequired(registry), user };
}

async function assertAdmin(supabase, request) {
  const token = text(request.headers.authorization).replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || String(profile?.role || '').toLowerCase() !== 'admin') return null;
  return user;
}

function normalizeImportRecord(record, index) {
  const email = normalizeEmail(record?.email);
  const yearLevel = Number(record?.year_level);
  const schoolStatusLookup = {
    enrolled: 'Enrolled',
    dropped: 'Dropped',
    graduated: 'Graduated',
  };
  const schoolStatus = schoolStatusLookup[text(record?.school_status).toLowerCase()];
  const normalized = {
    barangay: text(record?.barangay) || null,
    city: text(record?.city) || null,
    country: text(record?.country) || 'Philippines',
    date_of_birth: text(record?.date_of_birth) || null,
    email,
    first_name: text(record?.first_name),
    last_name: text(record?.last_name),
    middle_name: text(record?.middle_name) || null,
    phone_number: text(record?.phone_number) || null,
    program_code: text(record?.program_code).toUpperCase(),
    province: text(record?.province) || null,
    region: text(record?.region) || null,
    school_code: text(record?.school_code).toUpperCase(),
    school_status: schoolStatus,
    section: text(record?.section).toUpperCase(),
    status: schoolStatus === 'Enrolled' ? 'active' : schoolStatus === 'Graduated' ? 'graduated' : 'inactive',
    street: text(record?.street) || null,
    student_number: text(record?.student_number),
    suffix: text(record?.suffix) || null,
    year_level: yearLevel,
  };

  if (!isNubStudentEmail(email)) throw new Error(`Row ${index + 2} does not use an NU Baliwag student email.`);
  if (!normalized.first_name || !normalized.last_name) throw new Error(`Row ${index + 2} is missing the student's name.`);
  if (!/^\d{4}-\d{6}$/.test(normalized.student_number)) throw new Error(`Row ${index + 2} has an invalid student number.`);
  if (!normalized.school_code || !normalized.program_code) throw new Error(`Row ${index + 2} is missing a school or program code.`);
  if (!/^[A-Z0-9-]{2,20}$/.test(normalized.section)) throw new Error(`Row ${index + 2} has an invalid section.`);
  if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 8) throw new Error(`Row ${index + 2} has an invalid year level.`);
  if (!schoolStatus) throw new Error(`Row ${index + 2} school_status must be Enrolled, Dropped, or Graduated.`);
  if (normalized.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(normalized.date_of_birth)) {
    throw new Error(`Row ${index + 2} has an invalid date of birth. Use YYYY-MM-DD.`);
  }
  return normalized;
}

const REGISTRY_SYNC_FIELDS = [
  'barangay',
  'city',
  'country',
  'date_of_birth',
  'email',
  'first_name',
  'last_name',
  'middle_name',
  'phone_number',
  'program_code',
  'province',
  'region',
  'school_code',
  'school_status',
  'section',
  'status',
  'street',
  'student_number',
  'suffix',
  'year_level',
];

function buildRegistrySyncPayload(record) {
  return Object.fromEntries(REGISTRY_SYNC_FIELDS.map((field) => [field, record?.[field] ?? null]));
}

function validateUniqueImportRecords(records) {
  const studentNumbers = new Map();
  const emails = new Map();
  records.forEach((record, index) => {
    const rowNumber = index + 2;
    if (studentNumbers.has(record.student_number)) {
      throw new Error(`Duplicate student number ${record.student_number} appears on rows ${studentNumbers.get(record.student_number)} and ${rowNumber}.`);
    }
    if (emails.has(record.email)) {
      throw new Error(`Duplicate email ${record.email} appears on rows ${emails.get(record.email)} and ${rowNumber}.`);
    }
    studentNumbers.set(record.student_number, rowNumber);
    emails.set(record.email, rowNumber);
  });
}

function registryValuesMatch(existing, incoming) {
  return REGISTRY_SYNC_FIELDS.every((field) => {
    const existingValue = existing?.[field] === undefined || existing?.[field] === '' ? null : existing[field];
    const incomingValue = incoming?.[field] === undefined || incoming?.[field] === '' ? null : incoming[field];
    return existingValue === incomingValue || String(existingValue ?? '') === String(incomingValue ?? '');
  });
}

async function listRegistryRecords(supabase) {
  const pageSize = 1000;
  const records = [];
  for (let from = 0; from < 100000; from += pageSize) {
    const { data, error } = await supabase
      .from('nub_student_registry')
      .select(['id', 'auth_user_id', 'activated_at', ...REGISTRY_SYNC_FIELDS].join(', '))
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    records.push(...page);
    if (page.length < pageSize) break;
  }
  return records;
}

async function updateLinkedAuthIdentity(supabase, existing, incoming) {
  if (!existing.auth_user_id) return null;

  const { data, error } = await supabase.auth.admin.getUserById(existing.auth_user_id);
  if (error) throw error;
  const user = data?.user;
  if (!user) throw new Error('The linked authentication account was not found.');

  const previous = {
    email: user.email,
    emailConfirmed: Boolean(user.email_confirmed_at),
    metadata: user.user_metadata || {},
  };
  const mergedRegistry = { ...existing, ...incoming };
  const attributes = {
    user_metadata: { ...previous.metadata, ...authMetadata(mergedRegistry) },
  };
  if (normalizeEmail(user.email) !== incoming.email) {
    attributes.email = incoming.email;
    attributes.email_confirm = previous.emailConfirmed;
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(existing.auth_user_id, attributes);
  if (updateError) throw updateError;

  return async function rollbackAuthIdentity() {
    await supabase.auth.admin.updateUserById(existing.auth_user_id, {
      email: previous.email,
      email_confirm: previous.emailConfirmed,
      user_metadata: previous.metadata,
    });
  };
}

async function updateRegistryRecord(supabase, existing, incoming) {
  const rollbackAuthIdentity = await updateLinkedAuthIdentity(supabase, existing, incoming);
  const { error } = await supabase
    .from('nub_student_registry')
    .update(buildRegistrySyncPayload(incoming))
    .eq('id', existing.id);
  if (error) {
    if (rollbackAuthIdentity) await rollbackAuthIdentity();
    throw error;
  }
}

function classifyRegistryImport(normalizedRecords, existingRecords) {
  const byStudentNumber = new Map(existingRecords.map((record) => [record.student_number, record]));
  const byEmail = new Map(existingRecords.map((record) => [normalizeEmail(record.email), record]));
  const newRecords = [];
  const changedRecords = [];
  const conflicts = [];
  let unchanged = 0;

  normalizedRecords.forEach((record, index) => {
    const studentNumberMatch = byStudentNumber.get(record.student_number);
    const emailMatch = byEmail.get(record.email);
    if (studentNumberMatch && emailMatch && studentNumberMatch.id !== emailMatch.id) {
      conflicts.push({
        message: 'The student number and email belong to different existing records.',
        row: index + 2,
        student_number: record.student_number,
      });
      return;
    }

    const existing = studentNumberMatch || emailMatch;
    if (!existing) {
      newRecords.push({ record, row: index + 2 });
      return;
    }
    if (registryValuesMatch(existing, record)) {
      unchanged += 1;
      return;
    }
    changedRecords.push({ existing, record, row: index + 2 });
  });

  return { changedRecords, conflicts, newRecords, unchanged };
}

async function handleImport(supabase, request, response) {
  const admin = await assertAdmin(supabase, request);
  if (!admin) return response.status(403).json({ error: 'Administrator access is required.' });

  const records = Array.isArray(request.body?.records) ? request.body.records : [];
  if (!records.length) return response.status(400).json({ error: 'No student records were supplied.' });
  if (records.length > 5000) return response.status(400).json({ error: 'Import at most 5,000 student records at a time.' });

  const normalizedRecords = records.map(normalizeImportRecord);
  validateUniqueImportRecords(normalizedRecords);

  const existingRecords = await listRegistryRecords(supabase);
  const { changedRecords, conflicts, newRecords, unchanged } = classifyRegistryImport(normalizedRecords, existingRecords);

  let inserted = 0;
  for (let index = 0; index < newRecords.length; index += 500) {
    const batch = newRecords.slice(index, index + 500);
    const { data, error } = await supabase
      .from('nub_student_registry')
      .insert(batch.map((entry) => buildRegistrySyncPayload(entry.record)))
      .select('id');
    if (error) throw error;
    inserted += data?.length || batch.length;
  }

  let updated = 0;
  for (const entry of changedRecords) {
    try {
      await updateRegistryRecord(supabase, entry.existing, entry.record);
      updated += 1;
    } catch (error) {
      conflicts.push({
        message: error?.message || 'The existing record could not be updated.',
        row: entry.row,
        student_number: entry.record.student_number,
      });
    }
  }

  return response.status(200).json({
    conflicts: conflicts.slice(0, 20),
    conflict_count: conflicts.length,
    inserted,
    processed: normalizedRecords.length,
    registry_sync_version: REGISTRY_SYNC_VERSION,
    unchanged,
    updated,
  });
}

async function handleDeleteUser(supabase, request, response) {
  const admin = await assertAdmin(supabase, request);
  if (!admin) return response.status(403).json({ error: 'Administrator access is required.' });

  const userId = text(request.body?.user_id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    return response.status(400).json({ error: 'A valid user ID is required.' });
  }
  if (userId === admin.id) {
    return response.status(400).json({ error: 'You cannot remove your own administrator account.' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) return response.status(404).json({ error: 'The selected user profile no longer exists.' });
  if (String(profile.role || '').toLowerCase() === 'admin') {
    return response.status(400).json({ error: 'Administrator accounts cannot be removed from Manage Users.' });
  }

  const { data: registry, error: registryError } = await supabase
    .from('nub_student_registry')
    .select('id, school_status, status')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (registryError) throw registryError;

  if (registry) {
    const { error: deactivateError } = await supabase
      .from('nub_student_registry')
      .update({ school_status: 'Dropped', status: 'inactive' })
      .eq('id', registry.id);
    if (deactivateError) throw deactivateError;
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
  if (deleteError) {
    if (registry) {
      await supabase
        .from('nub_student_registry')
        .update({ school_status: registry.school_status, status: registry.status })
        .eq('id', registry.id);
    }
    throw deleteError;
  }

  return response.status(200).json({ removed: true });
}

async function handleDevStudentActivation(supabase, request, response) {
  if (!isDevStudentOtpBypassEnabled(request)) {
    return response.status(404).json({ error: 'Development student activation is unavailable.' });
  }

  const email = normalizeEmail(request.body?.email);
  const otp = text(request.body?.otp);
  const password = String(request.body?.password || '');
  if (!isNubStudentEmail(email)) {
    return response.status(400).json({ error: `Use an @${NUB_STUDENT_DOMAIN} student email.` });
  }
  if (otp !== DEV_STUDENT_OTP) {
    return response.status(400).json({ error: 'Invalid development activation code.' });
  }
  if (!isValidStudentPassword(password)) {
    return response.status(400).json({ error: 'Use at least 8 characters with at least 1 uppercase and 1 lowercase letter.' });
  }
  if (isRateLimited(request, email)) {
    return response.status(429).json({ error: 'Too many activation attempts. Please wait before trying again.' });
  }

  const { data: registry, error: registryError } = await supabase
    .from('nub_student_registry')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (registryError) throw registryError;
  if (!registry || String(registry.school_status || '').toLowerCase() !== 'enrolled') {
    return response.status(403).json({ error: 'Only an Enrolled student registry record can be activated.' });
  }

  const { user } = await ensureRegistryAuthUser(supabase, registry);
  const { error: authError } = await supabase.auth.admin.updateUserById(user.id, {
    email_confirm: true,
    password,
    user_metadata: { ...(user.user_metadata || {}), ...authMetadata(registry) },
  });
  if (authError) throw authError;

  const { error: activationError } = await supabase
    .from('nub_student_registry')
    .update({ activated_at: registry.activated_at || new Date().toISOString() })
    .eq('id', registry.id);
  if (activationError) throw activationError;

  return response.status(200).json({ activated: true, development_only: true });
}

async function handleLoginLookup(supabase, request, response) {
  const email = normalizeEmail(request.body?.email);
  if (!isNubStudentEmail(email)) {
    return response.status(400).json({ error: `Use your @${NUB_STUDENT_DOMAIN} email address.` });
  }
  if (isRateLimited(request, email)) {
    return response.status(429).json({ error: 'Too many login attempts. Please wait before trying again.' });
  }

  const { data: registry, error } = await supabase
    .from('nub_student_registry')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  if (!registry || String(registry.school_status || '').toLowerCase() !== 'enrolled') {
    return response.status(403).json({
      error: 'This email is not listed as an enrolled NU Baliwag student. Dropped and graduated students cannot access the system.',
    });
  }

  const { activationRequired } = await ensureRegistryAuthUser(supabase, registry);
  return response.status(200).json({
    activation_required: activationRequired,
  });
}

module.exports = async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  try {
    const supabase = getAdminClient();
    if (request.body?.action === 'import') return await handleImport(supabase, request, response);
    if (request.body?.action === 'delete-user') return await handleDeleteUser(supabase, request, response);
    if (request.body?.action === 'dev-activate-student') return await handleDevStudentActivation(supabase, request, response);
    return await handleLoginLookup(supabase, request, response);
  } catch (error) {
    const message = readableErrorMessage(error);
    if (process.env.NODE_ENV === 'development') {
      console.error('Student registry API error:', {
        code: error?.code,
        details: error?.details,
        message,
      });
    }
    const configurationError = message.includes('not configured');
    return response.status(configurationError ? 503 : 500).json({ error: message });
  }
};

module.exports._test = {
  buildRegistrySyncPayload,
  classifyRegistryImport,
  DEV_STUDENT_OTP,
  isDevStudentOtpBypassEnabled,
  isRegistryActivationRequired,
  isValidStudentPassword,
  normalizeImportRecord,
  readableErrorMessage,
  REGISTRY_SYNC_VERSION,
  validateUniqueImportRecords,
};
