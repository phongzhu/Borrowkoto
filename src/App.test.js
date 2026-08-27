import { getNubProgram, getNubProgramsForSchool, getTargetSchoolCodeForPrograms, itemMatchesAcademicFilters, NUB_PROGRAMS, NUB_SCHOOLS } from './data/nubAcademicData';
import { getRecommendedProgramsForListing, NUB_MARKETPLACE_CATEGORIES } from './data/nubMarketplaceCatalog';
import { formatRegistryStudentSummary, isNubStudentEmail, isValidStudentPassword } from './utils/nubStudentAuth';
import { parseNubStudentRegistryCsv } from './utils/nubStudentRegistryCsv';
import { findCityMunicipalityByName, findRegionByName, getRegionLabel, mergeGeocodedAddressFields } from './ui/PhilippineAddressFields';
import { buildMapEmbedUrl, getMissingStudentProfileDetails } from './ui/profileFormUtils';
import { filterListingsByActiveOwners, isMarketplaceOwnerActive, selectPromotedMarketplaceItems } from './utils/marketplaceVisibility';
import { clearListingDraft, readListingDraft, saveListingDraft, updateListingMainCategory, updateListingSubcategory } from './utils/listingDraft';

const { _test: registryImportHelpers } = require('../api/nub-student-auth');

test('contains the five NU Baliwag schools and 13 unique undergraduate programs', () => {
  expect(NUB_SCHOOLS).toHaveLength(5);
  expect(NUB_PROGRAMS).toHaveLength(13);
  expect(new Set(NUB_PROGRAMS.map((program) => program.code)).size).toBe(13);
});

test('keeps Mobile and Web Applications as a BSIT specialization', () => {
  const bsit = getNubProgram('BSIT');
  expect(bsit.specializations).toContain('Mobile and Web Applications');
  expect(NUB_PROGRAMS.some((program) => program.code.includes('MWA'))).toBe(false);
});

test('links each course to its official school for listing targeting', () => {
  expect(getNubProgramsForSchool('SET').map((program) => program.code)).toEqual(['BSCE', 'BSIT', 'BSCPE']);
  expect(getNubProgramsForSchool('STHM').map((program) => program.code)).toEqual(['BSHM', 'BSTM']);
  expect(getTargetSchoolCodeForPrograms(['BSIT', 'BSCPE'])).toBe('SET');
  expect(getTargetSchoolCodeForPrograms(['BSIT', 'BSHM'])).toBe('all');
});

test('classification changes preserve targeting, pricing, and sale settings', () => {
  const form = {
    applicable_program_codes: ['BSIT'],
    applies_to_all_programs: false,
    category_id: 'old-category',
    is_for_sale: true,
    rental_price_per_day: '500',
    sale_inclusions: 'Charger and case',
    sale_price: '25000',
    subcategory_id: 'old-subcategory',
    target_school_code: 'SET',
  };

  const withNewCategory = updateListingMainCategory(form, 'new-category');
  expect(withNewCategory).toMatchObject({
    applicable_program_codes: ['BSIT'],
    category_id: 'new-category',
    is_for_sale: true,
    rental_price_per_day: '500',
    sale_price: '25000',
    subcategory_id: '',
    target_school_code: 'SET',
  });

  expect(updateListingSubcategory(withNewCategory, 'new-subcategory')).toMatchObject({
    applicable_program_codes: ['BSIT'],
    category_id: 'new-category',
    rental_price_per_day: '500',
    sale_inclusions: 'Charger and case',
    subcategory_id: 'new-subcategory',
    target_school_code: 'SET',
  });
});

test('persists unfinished listing fields and add-ons in a user-specific draft', () => {
  const userId = 'student-draft-test';
  const form = {
    applicable_program_codes: ['BSIT'],
    category_id: 'category-one',
    is_for_sale: true,
    rental_price_per_day: '450',
    sale_price: '12000',
    target_school_code: 'SET',
    title: 'Camera',
  };
  const addons = [{ addon_name: 'Tripod', imageFile: { name: 'tripod.jpg' }, imagePreview: 'blob:preview', price: '50' }];

  saveListingDraft(userId, form, addons);
  const restored = readListingDraft(userId, { item_condition: '', title: '' });

  expect(restored.form).toMatchObject(form);
  expect(restored.addons[0]).toMatchObject({ addon_name: 'Tripod', imageFile: null, imagePreview: '', price: '50' });
  clearListingDraft(userId);
  expect(readListingDraft(userId, {})).toBeNull();
});

test('map search preserves address fields omitted by the geocoder', () => {
  const currentAddress = {
    barangay: 'Pagala',
    city: 'Baliwag',
    country: 'Philippines',
    latitude: '',
    longitude: '',
    province: 'Bulacan',
    region: 'Central Luzon (Region III)',
    street: '210 JP Rizal',
  };

  expect(mergeGeocodedAddressFields(currentAddress, {
    barangay: '',
    city: 'Baliuag',
    country: 'Philippines',
    latitude: '14.9549000',
    longitude: '120.8960000',
    province: '',
    region: '',
    street: 'Doña Remedios Trinidad Highway',
  })).toEqual({
    barangay: 'Pagala',
    city: 'Baliuag',
    country: 'Philippines',
    latitude: '14.9549000',
    longitude: '120.8960000',
    province: 'Bulacan',
    region: 'Central Luzon (Region III)',
    street: 'Doña Remedios Trinidad Highway',
  });
});

test('uses the 13 reusable NUB marketplace parent categories, including tourism gear, and omits consumable office supplies', () => {
  expect(NUB_MARKETPLACE_CATEGORIES).toHaveLength(13);
  expect(NUB_MARKETPLACE_CATEGORIES.some((category) => category.name === 'Academic Projects')).toBe(true);
  expect(NUB_MARKETPLACE_CATEGORIES.find((category) => category.name === 'Tourism and Travel Equipment')?.subcategories)
    .toEqual(expect.arrayContaining(['Suitcases and Luggage', 'Travel Bags and Duffel Bags']));
  expect(NUB_MARKETPLACE_CATEGORIES.some((category) => category.name === 'School and Office Supplies')).toBe(false);
});

test('matches explicit listing programs and all-program listings', () => {
  expect(itemMatchesAcademicFilters({ applies_to_all_programs: true, programCodes: [] }, [], ['BSHM'])).toBe(true);
  expect(itemMatchesAcademicFilters({ applies_to_all_programs: false, programCodes: ['BSIT', 'BSCPE'] }, [], ['BSIT'])).toBe(true);
  expect(itemMatchesAcademicFilters({ applies_to_all_programs: false, programCodes: ['BSIT', 'BSCPE'] }, [], ['BSHM'])).toBe(false);
  expect(itemMatchesAcademicFilters({ applies_to_all_programs: false, programCodes: ['BSTM'] }, [], ['BSHM'])).toBe(false);
  expect(itemMatchesAcademicFilters({ applies_to_all_programs: false, programCodes: ['BSTM'] }, ['STHM'], [])).toBe(true);
  expect(itemMatchesAcademicFilters({ applies_to_all_programs: false, programCodes: [] }, [], [])).toBe(false);
});

test('shows marketplace listings only when the owner account is active', () => {
  const activeOwner = { account_status: 'active', id: 'active-owner' };
  const inactiveOwner = { account_status: 'inactive', id: 'inactive-owner' };
  const suspendedOwner = { account_status: 'suspended', id: 'suspended-owner' };
  const items = [
    { id: 'visible-item', owner_id: activeOwner.id },
    { id: 'inactive-item', owner_id: inactiveOwner.id },
    { id: 'suspended-item', owner_id: suspendedOwner.id },
    { id: 'missing-profile-item', owner_id: 'missing-owner' },
  ];

  expect(isMarketplaceOwnerActive(activeOwner)).toBe(true);
  expect(isMarketplaceOwnerActive(inactiveOwner)).toBe(false);
  expect(filterListingsByActiveOwners(items, [activeOwner, inactiveOwner, suspendedOwner])).toEqual([items[0]]);
});

test('shows every promoted listing until a visitor explicitly filters by school or course', () => {
  const items = [
    { applies_to_all_programs: true, id: 'all-programs', programCodes: [] },
    { applies_to_all_programs: false, id: 'civil-engineering', programCodes: ['BSCE'] },
    { applies_to_all_programs: false, id: 'information-technology', programCodes: ['BSIT'] },
  ];
  const promotedIds = ['civil-engineering', 'all-programs', 'information-technology'];

  expect(selectPromotedMarketplaceItems(promotedIds, items).map((item) => item.id)).toEqual(promotedIds);
  expect(selectPromotedMarketplaceItems(promotedIds, items, { programCodes: ['BSIT'] }).map((item) => item.id))
    .toEqual(['all-programs', 'information-technology']);
});

test('recommends category-specific programs for academic project subcategories', () => {
  expect(getRecommendedProgramsForListing('Academic Projects', 'Architectural Models').programCodes).toEqual(['BSARCH']);
  expect(getRecommendedProgramsForListing('Computers and Digital Devices').allPrograms).toBe(true);
  expect(getRecommendedProgramsForListing('Tourism and Travel Equipment').programCodes).toEqual(['BSTM']);
});

test('accepts only the exact NU Baliwag student email domain', () => {
  expect(isNubStudentEmail('sample@students.nu-baliwag.edu.ph')).toBe(true);
  expect(isNubStudentEmail('sample@nu-baliwag.edu.ph')).toBe(false);
  expect(isNubStudentEmail('sample@students.nu-baliwag.edu.ph.example.com')).toBe(false);
});

test('requires student passwords to have 8 characters with uppercase and lowercase letters', () => {
  expect(isValidStudentPassword('Password')).toBe(true);
  expect(isValidStudentPassword('PassWord1')).toBe(true);
  expect(isValidStudentPassword('password')).toBe(false);
  expect(isValidStudentPassword('PASSWORD')).toBe(false);
  expect(isValidStudentPassword('Passwor')).toBe(false);

  expect(registryImportHelpers.isValidStudentPassword('Password')).toBe(true);
  expect(registryImportHelpers.isValidStudentPassword('password')).toBe(false);
  expect(registryImportHelpers.isValidStudentPassword('PASSWORD')).toBe(false);
});

test('requires a username and profile photo before a student profile is complete', () => {
  const completeProfile = {
    barangay: 'Sto. Niño',
    city: 'Plaridel',
    country: 'Philippines',
    date_of_birth: '2004-12-18',
    first_name: 'Paolo Luis',
    last_name: 'Aquino',
    phone_number: '+639170000005',
    profile_photo_url: 'https://example.com/profile.jpg',
    program_code: 'BSA',
    province: 'Bulacan',
    region: 'Region III',
    school_code: 'SBA',
    street: '31 Jacinto Street',
    username: 'paooo',
  };

  expect(getMissingStudentProfileDetails(completeProfile)).toEqual([]);
  expect(getMissingStudentProfileDetails({ ...completeProfile, profile_photo_url: '' })).toContain('profile photo');
  expect(getMissingStudentProfileDetails({ ...completeProfile, username: '' })).toContain('username');
});

test('matches imported PSGC region aliases so province and city options can cascade', () => {
  const regions = [{ code: '030000000', name: 'Central Luzon', regionName: 'Region III' }];
  expect(findRegionByName(regions, 'Region III')).toEqual(regions[0]);
  expect(findRegionByName(regions, 'Central Luzon')).toEqual(regions[0]);
  expect(getRegionLabel(regions[0])).toBe('Central Luzon (Region III)');
});

test('matches shortened registry city names to official PSGC city labels', () => {
  const cities = [
    { code: '0301403000', name: 'City of Baliwag' },
    { code: '0301410000', name: 'City of San Jose del Monte' },
  ];

  expect(findCityMunicipalityByName(cities, 'Baliwag')).toEqual(cities[0]);
  expect(findCityMunicipalityByName(cities, 'Baliuag City')).toEqual(cities[0]);
  expect(findCityMunicipalityByName(cities, 'San Jose del Monte')).toEqual(cities[1]);
});

test('does not render an ocean map when imported coordinates are blank', () => {
  expect(buildMapEmbedUrl('', '')).toBe('');
  expect(buildMapEmbedUrl(null, undefined)).toBe('');
  expect(buildMapEmbedUrl(0, 0)).toBe('');
  expect(buildMapEmbedUrl('14.9544', '120.8969')).toContain('marker=14.9544%2C120.8969');
});

test('formats the university-owned year and program summary', () => {
  expect(formatRegistryStudentSummary({ program_code: 'BSIT', year_level: 4 })).toBe('4th Year BSIT Student');
  expect(formatRegistryStudentSummary({ program_code: 'BSIT', section: 'ITE231', year_level: 4 })).toBe('4th Year BSIT Student · Section ITE231');
});

test('parses an Excel-exported registry with contact, address, and school status', () => {
  const records = parseNubStudentRegistryCsv([
    'student_number,email,first_name,middle_name,last_name,phone_number,date_of_birth,street,barangay,city,province,region,country,school_code,program_code,section,year_level,school_status',
    '2023-123456,student@students.nu-baliwag.edu.ph,Sample,Middle,Student,+639123456789,2004-08-10,123 University Ave,Pagala,Baliuag,Bulacan,Region III,Philippines,SET,BSIT,ITE231,4,Enrolled',
  ].join('\n'));

  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    email: 'student@students.nu-baliwag.edu.ph',
    first_name: 'Sample',
    last_name: 'Student',
    phone_number: '+639123456789',
    program_code: 'BSIT',
    section: 'ITE231',
    school_status: 'Enrolled',
    street: '123 University Ave',
    year_level: 4,
  });
});

test('accepts only the three Registrar school status values', () => {
  const baseHeader = 'student_number,email,first_name,last_name,school_code,program_code,section,year_level,school_status';
  expect(parseNubStudentRegistryCsv(`${baseHeader}\n2023-123456,student@students.nu-baliwag.edu.ph,Sample,Student,SET,BSIT,ITE231,4,Dropped`)[0].school_status).toBe('Dropped');
  expect(() => parseNubStudentRegistryCsv(`${baseHeader}\n2023-123456,student@students.nu-baliwag.edu.ph,Sample,Student,SET,BSIT,ITE231,4,Active`)).toThrow(/Enrolled, Dropped, or Graduated/);
});

test('rejects duplicate student numbers and institutional emails in one registry file', () => {
  const header = 'student_number,email,first_name,last_name,school_code,program_code,section,year_level,school_status';
  expect(() => parseNubStudentRegistryCsv([
    header,
    '2023-123456,first@students.nu-baliwag.edu.ph,First,Student,SET,BSIT,ITE231,4,Enrolled',
    '2023-123456,second@students.nu-baliwag.edu.ph,Second,Student,SET,BSIT,ITE232,4,Enrolled',
  ].join('\n'))).toThrow(/Duplicate student_number/);
  expect(() => parseNubStudentRegistryCsv([
    header,
    '2023-123456,student@students.nu-baliwag.edu.ph,First,Student,SET,BSIT,ITE231,4,Enrolled',
    '2023-654321,STUDENT@students.nu-baliwag.edu.ph,Second,Student,SET,BSIT,ITE232,4,Enrolled',
  ].join('\n'))).toThrow(/Duplicate email/);
});

test('classifies registry imports as new, changed, unchanged, or conflicting', () => {
  const incoming = registryImportHelpers.normalizeImportRecord({
    student_number: '2023-123456',
    email: 'student@students.nu-baliwag.edu.ph',
    first_name: 'Sample',
    last_name: 'Student',
    school_code: 'SET',
    program_code: 'BSIT',
    section: 'ITE231',
    year_level: 4,
    school_status: 'Enrolled',
  }, 0);
  const existing = { id: 'registry-one', auth_user_id: null, activated_at: null, ...incoming };

  expect(registryImportHelpers.classifyRegistryImport([incoming], [existing])).toMatchObject({
    changedRecords: [],
    conflicts: [],
    newRecords: [],
    unchanged: 1,
  });

  const changed = registryImportHelpers.classifyRegistryImport(
    [{ ...incoming, section: 'ITE232' }],
    [existing],
  );
  expect(changed.changedRecords).toHaveLength(1);
  expect(changed.changedRecords[0].record.section).toBe('ITE232');
  expect(changed.unchanged).toBe(0);

  const added = registryImportHelpers.classifyRegistryImport([
    { ...incoming, student_number: '2023-654321', email: 'new@students.nu-baliwag.edu.ph' },
  ], [existing]);
  expect(added.newRecords).toHaveLength(1);

  const otherExisting = {
    ...existing,
    id: 'registry-two',
    student_number: '2023-654321',
    email: 'other@students.nu-baliwag.edu.ph',
  };
  const conflict = registryImportHelpers.classifyRegistryImport([
    { ...incoming, email: otherExisting.email },
  ], [existing, otherExisting]);
  expect(conflict.conflicts).toHaveLength(1);
  expect(conflict.changedRecords).toHaveLength(0);
  expect(conflict.newRecords).toHaveLength(0);
});

test('uses the current registry synchronization response version', () => {
  expect(registryImportHelpers.REGISTRY_SYNC_VERSION).toBe(2);
});

test('allows the fixed student activation code only in explicitly enabled localhost development', () => {
  const localhostRequest = { headers: { host: 'localhost:3000' } };
  const enabledDevelopment = { ENABLE_DEV_STUDENT_OTP_BYPASS: 'true', NODE_ENV: 'development' };

  expect(registryImportHelpers.DEV_STUDENT_OTP).toBe('000000');
  expect(registryImportHelpers.isDevStudentOtpBypassEnabled(localhostRequest, enabledDevelopment)).toBe(true);
  expect(registryImportHelpers.isDevStudentOtpBypassEnabled(
    localhostRequest,
    { ...enabledDevelopment, NODE_ENV: 'production' },
  )).toBe(false);
  expect(registryImportHelpers.isDevStudentOtpBypassEnabled(
    { headers: { host: 'borrowkoto.example.com' } },
    enabledDevelopment,
  )).toBe(false);
  expect(registryImportHelpers.isDevStudentOtpBypassEnabled(
    localhostRequest,
    { ...enabledDevelopment, ENABLE_DEV_STUDENT_OTP_BYPASS: 'false' },
  )).toBe(false);
});

test('preserves Supabase error messages returned as plain objects', () => {
  expect(registryImportHelpers.readableErrorMessage({ message: 'Database trigger failed.' })).toBe('Database trigger failed.');
  expect(registryImportHelpers.readableErrorMessage(null)).toBe('Unexpected student registry error.');
});

test('server validation rejects duplicate student identities in one import', () => {
  const first = registryImportHelpers.normalizeImportRecord({
    student_number: '2023-123456',
    email: 'student@students.nu-baliwag.edu.ph',
    first_name: 'Sample',
    last_name: 'Student',
    school_code: 'SET',
    program_code: 'BSIT',
    section: 'ITE231',
    year_level: 4,
    school_status: 'Enrolled',
  }, 0);

  expect(() => registryImportHelpers.validateUniqueImportRecords([
    first,
    { ...first, email: 'second@students.nu-baliwag.edu.ph' },
  ])).toThrow(/Duplicate student number/);
  expect(() => registryImportHelpers.validateUniqueImportRecords([
    first,
    { ...first, student_number: '2023-654321' },
  ])).toThrow(/Duplicate email/);
});
