import catalog from './nubAcademicCatalog.json';

export const NUB_SCHOOLS = Object.freeze(catalog.schools);
export const NUB_PROGRAMS = Object.freeze(catalog.programs);
export const NUB_STUDENT_NUMBER_PATTERN = /^\d{4}-\d{6}$/;

export function getNubSchool(code) {
  return NUB_SCHOOLS.find((school) => school.code === String(code || '').toUpperCase()) || null;
}

export function getNubProgram(code) {
  return NUB_PROGRAMS.find((program) => program.code === String(code || '').toUpperCase()) || null;
}

export function getNubProgramsForSchool(schoolCode) {
  const normalized = String(schoolCode || '').toUpperCase();
  return normalized ? NUB_PROGRAMS.filter((program) => program.schoolCode === normalized) : NUB_PROGRAMS;
}

export function getTargetSchoolCodeForPrograms(programCodes = []) {
  const schoolCodes = new Set(
    (programCodes || [])
      .map((programCode) => getNubProgram(programCode)?.schoolCode)
      .filter(Boolean)
  );

  return schoolCodes.size === 1 ? Array.from(schoolCodes)[0] : 'all';
}

export function itemMatchesAcademicFilters(record, schoolCodes = [], programCodes = []) {
  if (record?.applies_to_all_programs) return true;

  const applicablePrograms = new Set(
    (record?.programCodes || record?.item_programs || [])
      .map((entry) => typeof entry === 'string' ? entry : entry?.program_code)
      .filter(Boolean)
  );
  const requestedPrograms = (programCodes || []).filter(Boolean);
  const requestedSchools = new Set((schoolCodes || []).filter(Boolean));

  if (!applicablePrograms.size) return false;

  if (requestedPrograms.length) {
    return requestedPrograms.some((code) => applicablePrograms.has(code));
  }
  if (!requestedSchools.size) return true;

  return Array.from(applicablePrograms).some((programCode) => {
    const program = getNubProgram(programCode);
    return Boolean(program?.schoolCode && requestedSchools.has(program.schoolCode));
  });
}

export function formatNubProgram(program) {
  return program ? `${program.displayCode} — ${program.name}` : '';
}
