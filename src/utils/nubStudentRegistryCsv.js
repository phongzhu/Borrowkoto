import { readSheet } from 'read-excel-file/browser';

export const NUB_STUDENT_REGISTRY_COLUMNS = [
  'student_number',
  'email',
  'first_name',
  'middle_name',
  'last_name',
  'suffix',
  'phone_number',
  'date_of_birth',
  'street',
  'barangay',
  'city',
  'province',
  'region',
  'country',
  'school_code',
  'program_code',
  'section',
  'year_level',
  'school_status',
];

const REQUIRED_COLUMNS = [
  'student_number',
  'email',
  'first_name',
  'last_name',
  'school_code',
  'program_code',
  'section',
  'year_level',
  'school_status',
];

const SCHOOL_STATUSES = new Map([
  ['enrolled', 'Enrolled'],
  ['dropped', 'Dropped'],
  ['graduated', 'Graduated'],
]);

function parseCsvRows(text) {
  const rows = [];
  let cell = '';
  let row = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function cellToText(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').trim();
}

function parseRegistryRows(rows, sourceLabel) {
  if (rows.length < 2) throw new Error(`The ${sourceLabel} must contain a header and at least one student row.`);

  const headers = rows[0].map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}.`);

  const records = rows.slice(1).filter((values) => values.some((value) => cellToText(value))).map((values, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, cellToText(values[index])]));
    const yearLevel = Number(record.year_level);
    const schoolStatus = SCHOOL_STATUSES.get(record.school_status.toLowerCase());
    const section = record.section.toUpperCase();

    if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 8) {
      throw new Error(`Row ${rowIndex + 2} has an invalid year_level.`);
    }
    if (!schoolStatus) {
      throw new Error(`Row ${rowIndex + 2} school_status must be Enrolled, Dropped, or Graduated.`);
    }
    if (!/^[A-Z0-9-]{2,20}$/.test(section)) {
      throw new Error(`Row ${rowIndex + 2} section must contain 2 to 20 letters, numbers, or hyphens.`);
    }
    if (record.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(record.date_of_birth)) {
      throw new Error(`Row ${rowIndex + 2} date_of_birth must use YYYY-MM-DD.`);
    }

    return {
      barangay: record.barangay || null,
      city: record.city || null,
      country: record.country || 'Philippines',
      date_of_birth: record.date_of_birth || null,
      email: record.email,
      first_name: record.first_name,
      last_name: record.last_name,
      middle_name: record.middle_name || null,
      phone_number: record.phone_number || null,
      program_code: record.program_code,
      province: record.province || null,
      region: record.region || null,
      school_code: record.school_code,
      school_status: schoolStatus,
      section,
      street: record.street || null,
      student_number: record.student_number,
      suffix: record.suffix || null,
      year_level: yearLevel,
    };
  });

  const studentNumberRows = new Map();
  const emailRows = new Map();
  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const normalizedStudentNumber = record.student_number.toLowerCase();
    const normalizedEmail = record.email.toLowerCase();
    if (studentNumberRows.has(normalizedStudentNumber)) {
      throw new Error(`Duplicate student_number ${record.student_number} appears on rows ${studentNumberRows.get(normalizedStudentNumber)} and ${rowNumber}.`);
    }
    if (emailRows.has(normalizedEmail)) {
      throw new Error(`Duplicate email ${record.email} appears on rows ${emailRows.get(normalizedEmail)} and ${rowNumber}.`);
    }
    studentNumberRows.set(normalizedStudentNumber, rowNumber);
    emailRows.set(normalizedEmail, rowNumber);
  });

  return records;
}

export function parseNubStudentRegistryCsv(text) {
  return parseRegistryRows(parseCsvRows(String(text || '')), 'CSV');
}

export async function parseNubStudentRegistryFile(file) {
  const fileName = String(file?.name || '').toLowerCase();
  if (fileName.endsWith('.xlsx')) {
    const rows = await readSheet(file, 1);
    return parseRegistryRows(rows, 'Excel workbook');
  }
  if (fileName.endsWith('.csv')) {
    return parseNubStudentRegistryCsv(await file.text());
  }
  throw new Error('Choose an .xlsx Excel workbook or a .csv file.');
}
