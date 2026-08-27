export const NUB_STUDENT_EMAIL_DOMAIN = 'students.nu-baliwag.edu.ph';
export const STUDENT_PASSWORD_REQUIREMENTS = 'Use at least 8 characters with at least 1 uppercase and 1 lowercase letter.';

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isNubStudentEmail(value) {
  const email = normalizeEmail(value);
  const parts = email.split('@');
  return parts.length === 2 && Boolean(parts[0]) && parts[1] === NUB_STUDENT_EMAIL_DOMAIN;
}

export function isValidStudentPassword(value) {
  const password = String(value || '');
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password);
}

export function formatYearLevel(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1) return '';
  const suffix = year % 100 >= 11 && year % 100 <= 13
    ? 'th'
    : year % 10 === 1
      ? 'st'
      : year % 10 === 2
        ? 'nd'
        : year % 10 === 3
          ? 'rd'
          : 'th';
  return `${year}${suffix} Year`;
}

export function formatRegistryStudentName(student) {
  return [student?.first_name, student?.middle_name, student?.last_name, student?.suffix]
    .filter(Boolean)
    .join(' ');
}

export function formatRegistryStudentSummary(student) {
  const academicSummary = [formatYearLevel(student?.year_level), student?.program_code, 'Student'].filter(Boolean).join(' ');
  return student?.section ? `${academicSummary} · Section ${student.section}` : academicSummary;
}
