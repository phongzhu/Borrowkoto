import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import {
  formatNubProgram,
  getNubProgram,
  getNubProgramsForSchool,
  getNubSchool,
  NUB_SCHOOLS,
  NUB_STUDENT_NUMBER_PATTERN,
} from '../../data/nubAcademicData';
import { CheckIcon, ReportIcon, UploadIcon, UsersIcon } from '../../ui/icons';
import { Badge, Button, FormField, Input, Modal, Panel, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import { parseNubStudentRegistryFile } from '../../utils/nubStudentRegistryCsv';
import AdminShell from './AdminShell';

const REGISTRY_SELECT = [
  'id',
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
  'auth_user_id',
  'activated_at',
  'imported_at',
  'updated_at',
].join(', ');

const REGISTRY_SYNC_VERSION = 2;

const EMPTY_EDIT_FORM = {
  barangay: '',
  city: '',
  country: 'Philippines',
  date_of_birth: '',
  email: '',
  first_name: '',
  last_name: '',
  middle_name: '',
  phone_number: '',
  program_code: '',
  province: '',
  region: '',
  school_code: '',
  school_status: 'Enrolled',
  section: '',
  street: '',
  student_number: '',
  suffix: '',
  year_level: '1',
};

function buildName(student) {
  return [student.first_name, student.middle_name, student.last_name, student.suffix].filter(Boolean).join(' ');
}

function buildRegistryAddress(student) {
  return [student.street, student.barangay, student.city, student.province, student.region, student.country].filter(Boolean).join(', ');
}

function formatFileSize(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildSchoolLabel(schoolCode) {
  const school = getNubSchool(schoolCode);
  return school ? `${school.code} — ${school.name}` : schoolCode || 'Not available';
}

function buildProgramLabel(programCode) {
  return formatNubProgram(getNubProgram(programCode)) || programCode || 'Not available';
}

function formatAccessDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function getStudentAccess(student) {
  if (student.activated_at) {
    return {
      detail: `Activated ${formatAccessDate(student.activated_at)}`,
      label: 'Accessed',
      tone: 'success',
    };
  }
  if (student.auth_user_id) {
    return {
      detail: 'First login is not complete',
      label: 'Activation started',
      tone: 'warning',
    };
  }
  return {
    detail: 'No login attempt yet',
    label: 'Not accessed',
    tone: 'neutral',
  };
}

function registryFormFromStudent(student) {
  return Object.fromEntries(
    Object.keys(EMPTY_EDIT_FORM).map((key) => [key, String(student?.[key] ?? EMPTY_EDIT_FORM[key])]),
  );
}

function sortRegistryRecords(records) {
  return [...records].sort((left, right) => {
    const lastNameOrder = String(left.last_name || '').localeCompare(String(right.last_name || ''));
    if (lastNameOrder) return lastNameOrder;
    return String(left.first_name || '').localeCompare(String(right.first_name || ''));
  });
}

async function fetchRegistryRecords() {
  const { data, error } = await supabase
    .from('nub_student_registry')
    .select(REGISTRY_SELECT)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });
  if (error) throw error;
  return data || [];
}

const headerCellStyle = {
  borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
  color: theme.colors.slate,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.12em',
  padding: '0 16px 14px',
  textAlign: 'left',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const bodyCellStyle = {
  borderBottom: `1px solid ${alpha(theme.colors.ink, 0.06)}`,
  padding: '16px',
  verticalAlign: 'top',
};

export default function ManageUsers() {
  const [registryRecords, setRegistryRecords] = useState([]);
  const [registryLoading, setRegistryLoading] = useState(true);
  const [registryError, setRegistryError] = useState('');
  const [registryFile, setRegistryFile] = useState(null);
  const [importingRegistry, setImportingRegistry] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [searchQuery, setSearchQuery] = useState('');
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    let mounted = true;

    fetchRegistryRecords()
      .then((records) => {
        if (!mounted) return;
        setRegistryRecords(records);
        setRegistryError('');
      })
      .catch((error) => {
        if (!mounted) return;
        setRegistryRecords([]);
        setRegistryError(error?.message || 'Unable to load the student registry.');
      })
      .finally(() => {
        if (mounted) setRegistryLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const visibleRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return registryRecords.filter((student) => {
      if (!query) return true;
      return [
        buildName(student),
        student.student_number,
        student.email,
        student.phone_number,
        buildRegistryAddress(student),
        buildSchoolLabel(student.school_code),
        buildProgramLabel(student.program_code),
        student.section,
        student.school_status,
        getStudentAccess(student).label,
      ].filter(Boolean).join(' ').toLowerCase().includes(query);
    });
  }, [registryRecords, searchQuery]);

  const availablePrograms = useMemo(
    () => getNubProgramsForSchool(editForm.school_code),
    [editForm.school_code],
  );

  async function refreshRegistry() {
    const records = await fetchRegistryRecords();
    setRegistryRecords(records);
    setRegistryError('');
    return records;
  }

  async function handleRegistryImport(event) {
    event.preventDefault();
    if (!registryFile) {
      setMessage('Choose the official Excel student registry workbook or a compatible CSV file.');
      setMessageTone('warning');
      return;
    }

    setImportingRegistry(true);
    setMessage('');

    try {
      const records = await parseNubStudentRegistryFile(registryFile);
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (sessionError || !token) throw new Error('Your administrator session has expired. Sign in again.');

      const response = await fetch('/api/nub-student-auth', {
        body: JSON.stringify({ action: 'import', records, registry_sync_version: REGISTRY_SYNC_VERSION }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'The registry import failed.');

      if (Number(payload?.registry_sync_version) !== REGISTRY_SYNC_VERSION) {
        await refreshRegistry();
        throw new Error('The local student-registry API is still running an older version. Restart npm start, then import the workbook again.');
      }
      if (Number(payload?.processed) !== records.length) {
        await refreshRegistry();
        throw new Error(`The registry API processed ${Number(payload?.processed) || 0} of ${records.length} rows. No success count was shown because the result was incomplete.`);
      }

      await refreshRegistry();
      const inserted = Number(payload?.inserted) || 0;
      const updated = Number(payload?.updated) || 0;
      const unchanged = Number(payload?.unchanged) || 0;
      const conflictCount = Number(payload?.conflict_count) || 0;
      const conflictDetail = payload?.conflicts?.[0]?.message
        ? ` First conflict: row ${payload.conflicts[0].row} — ${payload.conflicts[0].message}`
        : '';
      setMessage(`Import complete: ${inserted} added, ${updated} updated, ${unchanged} unchanged and skipped, ${conflictCount} conflicted and skipped.${conflictDetail}`);
      setMessageTone(conflictCount ? 'warning' : 'success');
      setRegistryFile(null);
    } catch (error) {
      setMessage(error?.message || 'Unable to import the NUB student registry.');
      setMessageTone('warning');
    } finally {
      setImportingRegistry(false);
    }
  }

  function openStudentEditor(student) {
    setEditTarget(student);
    setEditForm(registryFormFromStudent(student));
    setEditError('');
  }

  function updateEditField(field, value) {
    setEditForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'school_code') {
        const programs = getNubProgramsForSchool(value);
        if (!programs.some((program) => program.code === current.program_code)) {
          next.program_code = programs[0]?.code || '';
        }
      }
      return next;
    });
  }

  async function handleSaveStudent(event) {
    event.preventDefault();
    if (!editTarget) return;

    if (!NUB_STUDENT_NUMBER_PATTERN.test(editForm.student_number.trim())) {
      setEditError('Student number must use the format YYYY-######.');
      return;
    }
    if (!editForm.first_name.trim() || !editForm.last_name.trim()) {
      setEditError('First name and last name are required.');
      return;
    }
    if (!/^[A-Z0-9-]{2,20}$/.test(editForm.section.trim().toUpperCase())) {
      setEditError('Section must contain 2 to 20 letters, numbers, or hyphens, such as ITE231.');
      return;
    }

    setSavingEdit(true);
    setEditError('');

    const updates = {
      barangay: editForm.barangay.trim() || null,
      city: editForm.city.trim() || null,
      country: editForm.country.trim() || 'Philippines',
      date_of_birth: editForm.date_of_birth || null,
      first_name: editForm.first_name.trim(),
      last_name: editForm.last_name.trim(),
      middle_name: editForm.middle_name.trim() || null,
      phone_number: editForm.phone_number.trim() || null,
      program_code: editForm.program_code,
      province: editForm.province.trim() || null,
      region: editForm.region.trim() || null,
      school_code: editForm.school_code,
      school_status: editForm.school_status,
      section: editForm.section.trim().toUpperCase(),
      street: editForm.street.trim() || null,
      student_number: editForm.student_number.trim(),
      suffix: editForm.suffix.trim() || null,
      year_level: Number(editForm.year_level),
    };

    try {
      const { data, error } = await supabase
        .from('nub_student_registry')
        .update(updates)
        .eq('id', editTarget.id)
        .select(REGISTRY_SELECT)
        .single();
      if (error) throw error;

      setRegistryRecords((current) => sortRegistryRecords(current.map((student) => student.id === data.id ? data : student)));
      setMessage(`${buildName(data)} was updated.`);
      setMessageTone('success');
      setEditTarget(null);
    } catch (error) {
      setEditError(error?.message || 'Unable to update this student record.');
    } finally {
      setSavingEdit(false);
    }
  }

  const registryCount = registryError ? null : registryRecords.length;

  return (
    <AdminShell subtitle="" title="">
      {registryError ? <StatusMessage tone="warning">Unable to load the student registry: {registryError}</StatusMessage> : null}

      <Panel className="admin-registry-panel">
        <div className="admin-registry-header">
          <div className="admin-registry-heading">
            <span className="admin-registry-eyebrow">Student access control</span>
            <h2>Official NUB student registry</h2>
            <p>Upload the Registrar-approved roster. Student identity and academic details are taken directly from this registry.</p>
            <div className="admin-registry-access-rule">
              <CheckIcon size={16} />
              <span><strong>Enrolled</strong> students can sign in. Dropped and Graduated students are blocked.</span>
            </div>
          </div>
          <div className="admin-registry-count" aria-label={registryCount === null ? 'Registry count unavailable' : `${registryCount} student records`}>
            <UsersIcon size={19} />
            <div>
              <strong>{registryCount === null ? '—' : registryCount}</strong>
              <span>{registryCount === 1 ? 'Student record' : 'Student records'}</span>
            </div>
          </div>
        </div>

        <div className="admin-registry-workspace">
          <div className="admin-registry-template-card">
            <div className="admin-registry-card-icon"><ReportIcon size={21} /></div>
            <div className="admin-registry-card-copy">
              <strong>Start with the official template</strong>
              <span>All required columns and accepted status values are already included.</span>
            </div>
            <div className="admin-registry-downloads">
              <Button as="a" download href="/nub-student-registry-template.xlsx" icon={<ReportIcon size={16} />} variant="secondary">
                Download Excel
              </Button>
              <a download href="/nub-student-registry-template.csv">Download CSV instead</a>
            </div>
          </div>

          <form className="admin-registry-import-card" onSubmit={handleRegistryImport}>
            <div className="admin-registry-import-heading">
              <strong>Import completed registry</strong>
              <span>Excel (.xlsx) or CSV · Up to 5,000 students. Existing activations and passwords are preserved.</span>
            </div>
            <label className={`admin-registry-file-picker${registryFile ? ' has-file' : ''}`}>
              <input
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                key={`${registryFile?.name || 'empty'}-${registryFile?.lastModified || 0}`}
                onChange={(event) => setRegistryFile(event.target.files?.[0] || null)}
                type="file"
              />
              <span className="admin-registry-file-icon">{registryFile ? <CheckIcon size={20} /> : <UploadIcon size={20} />}</span>
              <span className="admin-registry-file-copy">
                <strong>{registryFile?.name || 'Choose a registry file'}</strong>
                <small>{registryFile ? `${formatFileSize(registryFile.size)} · Ready to import` : 'Browse your computer for the completed template'}</small>
              </span>
              <span className="admin-registry-browse-button">Browse</span>
            </label>
            <Button disabled={importingRegistry || !registryFile} icon={<UploadIcon size={17} />} type="submit">
              {importingRegistry ? 'Importing...' : 'Import registry'}
            </Button>
          </form>
        </div>

        {message ? <div className="admin-registry-message"><StatusMessage tone={messageTone}>{message}</StatusMessage></div> : null}

        <div className="admin-registry-records-header">
          <div>
            <strong>Student records</strong>
            <span>Select Edit to view the complete Registrar record, website access, and enrollment status.</span>
          </div>
          <div className="admin-registry-record-filters">
            <Input aria-label="Search student records" onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search name, email, student number…" value={searchQuery} />
          </div>
        </div>

        {registryLoading ? (
          <div className="admin-registry-message"><StatusMessage tone="info">Loading student records…</StatusMessage></div>
        ) : null}

        {!registryLoading && visibleRecords.length ? (
          <div className="admin-registry-table-wrap" style={{ border: `1px solid ${alpha(theme.colors.ink, 0.08)}`, borderRadius: 12, overflowX: 'auto' }}>
            <table className="admin-registry-student-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 900, width: '100%' }}>
              <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                <tr>
                  <th style={headerCellStyle}>Student ID</th>
                  <th style={headerCellStyle}>Name</th>
                  <th style={headerCellStyle}>Email</th>
                  <th style={headerCellStyle}>Course</th>
                  <th style={headerCellStyle}>Section</th>
                  <th style={headerCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecords.map((student) => (
                    <tr key={student.id}>
                      <td style={bodyCellStyle}><strong style={{ color: theme.colors.ink }}>{student.student_number}</strong></td>
                      <td style={bodyCellStyle}><span className="admin-registry-student-name">{buildName(student)}</span></td>
                      <td style={bodyCellStyle}><span style={{ color: theme.colors.slate }}>{student.email}</span></td>
                      <td style={bodyCellStyle}><Badge tone="info">{student.program_code}</Badge></td>
                      <td style={bodyCellStyle}><strong style={{ color: theme.colors.ink }}>{student.section || 'Not assigned'}</strong></td>
                      <td style={bodyCellStyle}>
                        <Button onClick={() => openStudentEditor(student)} type="button" variant="secondary">Edit</Button>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {!registryLoading && !visibleRecords.length ? (
          <div className="admin-registry-empty">
            <span className="admin-registry-empty-icon"><UsersIcon size={22} /></span>
            <div>
              <strong>{registryRecords.length ? 'No student records match your filters' : 'No student records yet'}</strong>
              <p>{registryRecords.length ? 'Try a different search or school status.' : 'Download the template, complete the roster, then import it above.'}</p>
            </div>
          </div>
        ) : null}
      </Panel>

      <Modal
        actions={
          <div className="admin-user-edit-actions">
            <Button disabled={savingEdit} onClick={() => setEditTarget(null)} type="button" variant="ghost">Cancel</Button>
            <Button disabled={savingEdit} form="student-registry-edit-form" icon={<CheckIcon size={17} />} type="submit">
              {savingEdit ? 'Saving changes…' : 'Save changes'}
            </Button>
          </div>
        }
        contentClassName="admin-registry-edit-modal"
        onClose={() => { if (!savingEdit) setEditTarget(null); }}
        open={Boolean(editTarget)}
        title={editTarget ? `Edit ${buildName(editTarget)}` : 'Edit student record'}
      >
        {editTarget ? (
          <form className="admin-registry-edit-form" id="student-registry-edit-form" onSubmit={handleSaveStudent}>
            <div className="admin-registry-edit-summary">
              <div>
                <span>Institutional login email</span>
                <strong>{editTarget.email}</strong>
              </div>
              <Badge tone={getStudentAccess(editTarget).tone}>{getStudentAccess(editTarget).label}</Badge>
            </div>

            {editError ? <StatusMessage tone="warning">{editError}</StatusMessage> : null}

            <div className="admin-registry-edit-grid">
              <FormField label="Student number" required>
                <Input onChange={(event) => updateEditField('student_number', event.target.value)} required value={editForm.student_number} />
              </FormField>
              <FormField hint="Login identifiers are locked after import." label="Institutional email">
                <Input disabled type="email" value={editForm.email} />
              </FormField>
              <FormField label="First name" required>
                <Input onChange={(event) => updateEditField('first_name', event.target.value)} required value={editForm.first_name} />
              </FormField>
              <FormField label="Middle name">
                <Input onChange={(event) => updateEditField('middle_name', event.target.value)} value={editForm.middle_name} />
              </FormField>
              <FormField label="Last name" required>
                <Input onChange={(event) => updateEditField('last_name', event.target.value)} required value={editForm.last_name} />
              </FormField>
              <FormField label="Suffix">
                <Input onChange={(event) => updateEditField('suffix', event.target.value)} value={editForm.suffix} />
              </FormField>
              <FormField label="Phone number">
                <Input onChange={(event) => updateEditField('phone_number', event.target.value)} value={editForm.phone_number} />
              </FormField>
              <FormField label="Date of birth">
                <Input onChange={(event) => updateEditField('date_of_birth', event.target.value)} type="date" value={editForm.date_of_birth} />
              </FormField>
              <FormField label="Street address">
                <Input onChange={(event) => updateEditField('street', event.target.value)} value={editForm.street} />
              </FormField>
              <FormField label="Barangay">
                <Input onChange={(event) => updateEditField('barangay', event.target.value)} value={editForm.barangay} />
              </FormField>
              <FormField label="City / municipality">
                <Input onChange={(event) => updateEditField('city', event.target.value)} value={editForm.city} />
              </FormField>
              <FormField label="Province">
                <Input onChange={(event) => updateEditField('province', event.target.value)} value={editForm.province} />
              </FormField>
              <FormField label="Region">
                <Input onChange={(event) => updateEditField('region', event.target.value)} value={editForm.region} />
              </FormField>
              <FormField label="Country">
                <Input onChange={(event) => updateEditField('country', event.target.value)} value={editForm.country} />
              </FormField>
              <FormField label="School" required>
                <select onChange={(event) => updateEditField('school_code', event.target.value)} required value={editForm.school_code}>
                  {NUB_SCHOOLS.map((school) => <option key={school.code} value={school.code}>{school.code} — {school.name}</option>)}
                </select>
              </FormField>
              <FormField label="Course" required>
                <select onChange={(event) => updateEditField('program_code', event.target.value)} required value={editForm.program_code}>
                  {availablePrograms.map((program) => <option key={program.code} value={program.code}>{formatNubProgram(program)}</option>)}
                </select>
              </FormField>
              <FormField hint="Example: ITE231" label="Section" required>
                <Input maxLength={20} onChange={(event) => updateEditField('section', event.target.value.toUpperCase())} required value={editForm.section} />
              </FormField>
              <FormField label="Year level" required>
                <select onChange={(event) => updateEditField('year_level', event.target.value)} required value={editForm.year_level}>
                  {Array.from({ length: 8 }, (_, index) => index + 1).map((year) => <option key={year} value={year}>Year {year}</option>)}
                </select>
              </FormField>
              <FormField hint="Only Enrolled students can access the system." label="School status" required>
                <select onChange={(event) => updateEditField('school_status', event.target.value)} required value={editForm.school_status}>
                  <option value="Enrolled">Enrolled</option>
                  <option value="Dropped">Dropped</option>
                  <option value="Graduated">Graduated</option>
                </select>
              </FormField>
            </div>
          </form>
        ) : null}
      </Modal>
    </AdminShell>
  );
}
