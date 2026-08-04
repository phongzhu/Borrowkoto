import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { approveDamageClaim, rejectDamageClaim, resolveReportEvidenceUrl } from '../../services/damageClaimsService';
import AdminShell from './AdminShell';
import { SectionGrid } from '../../ui/layouts';
import { Badge, Button, Input, MetricCard, Modal, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';

const categoryOptions = [
  { label: 'All categories', value: 'all' },
  { label: 'Reports', value: 'reports' },
  { label: 'Damage claims', value: 'damage_claims' },
  { label: 'Returns', value: 'returns' },
  { label: 'Reviews', value: 'reviews' },
  { label: 'Payments', value: 'payments' },
  { label: 'Verifications', value: 'verifications' },
];

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

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

function statusTone(status) {
  if (!status) {
    return 'info';
  }

  const normalized = status.toLowerCase();

  if (['approved', 'verified', 'active', 'completed', 'finalized', 'paid', 'resolved', 'success'].includes(normalized)) {
    return 'success';
  }

  if (['inactive', 'failed', 'rejected', 'cancelled'].includes(normalized)) {
    return 'danger';
  }

  if (['awaiting_payment', 'open', 'pending', 'pending_admin_review'].includes(normalized)) {
    return 'warning';
  }

  return 'info';
}

function getVerificationPersistedStatus(nextStatus) {
  if (nextStatus === 'approved') {
    return 'verified';
  }

  return nextStatus;
}

function getVerificationStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'verified') {
    return 'approved';
  }

  return status || 'Unknown';
}

function formatDate(value) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }

  return dateFormatter.format(date);
}

function joinParts(parts) {
  return parts.filter(Boolean).join(' | ');
}

function readValue(value, fallback = 'Not set') {
  if (typeof value === 'string') {
    return value.trim() || fallback;
  }

  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  return value;
}

function buildProfileName(profile) {
  if (!profile) {
    return '';
  }

  return [profile.first_name, profile.middle_name, profile.last_name, profile.suffix].filter(Boolean).join(' ');
}

function buildProfileLocation(profile) {
  if (!profile) {
    return '';
  }

  return [profile.street, profile.barangay, profile.city, profile.province, profile.region, profile.country].filter(Boolean).join(', ');
}

function resolveIdentity(profileById, userId) {
  if (!userId) {
    return 'Unknown user';
  }

  const profile = profileById.get(userId);
  if (!profile) {
    return userId;
  }

  const fullName = buildProfileName(profile);
  if (fullName && profile.username) {
    return `${fullName} (@${profile.username})`;
  }

  if (fullName) {
    return fullName;
  }

  if (profile.username) {
    return `@${profile.username}`;
  }

  return userId;
}

function ReviewDetailRow({ label, value }) {
  return (
    <div
      className="responsive-detail-row"
      style={{
        alignItems: 'start',
        borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        display: 'grid',
        gap: 10,
        gridTemplateColumns: '140px minmax(0, 1fr)',
        padding: '10px 0',
      }}
    >
      <span style={{ color: theme.colors.slate, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color: theme.colors.ink, lineHeight: 1.7, wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function normalizeReports(records, profileById = new Map()) {
  return (records || []).map((item) => ({
    assets: item.evidence_url ? [{ label: 'Evidence', url: item.evidence_url }] : [],
    category: 'reports',
    categoryLabel: 'Reports',
    date: item.created_at,
    details: joinParts([
      `Reporter: ${resolveIdentity(profileById, item.reporter_id)}`,
      `Reported: ${resolveIdentity(profileById, item.reported_user_id)}`,
      item.description,
    ]),
    id: `reports-${item.id}`,
    reference: item.booking_id || item.id,
    status: item.status || 'open',
    subject: item.report_type || 'User report',
  }));
}

function normalizeDamageClaims(records, profileById = new Map()) {
  return (records || []).map((item) => ({
    assets: [],
    category: 'damage_claims',
    categoryLabel: 'Damage claims',
    damageAdminAmount: item.admin_approved_amount === null || item.admin_approved_amount === undefined ? item.claimed_amount : item.admin_approved_amount,
    damageAdminNotes: item.admin_notes || '',
    damageBorrowerId: resolveIdentity(profileById, item.borrower_id),
    damageClaimId: item.id,
    damageClaimedAmount: item.claimed_amount,
    damageDescription: item.damage_description,
    damageItemId: item.item_id,
    damageOwnerId: resolveIdentity(profileById, item.owner_id),
    damageReportId: item.report_id,
    date: item.reviewed_at || item.created_at,
    details: joinParts([
      `Owner: ${resolveIdentity(profileById, item.owner_id)}`,
      `Borrower: ${resolveIdentity(profileById, item.borrower_id)}`,
      `Claimed: ${currencyFormatter.format(Number(item.claimed_amount) || 0)}`,
      item.damage_description,
      item.admin_notes,
    ]),
    id: `damage_claims-${item.id}`,
    reference: item.booking_id,
    status: item.status || 'pending_admin_review',
    subject: 'Damage claim',
  }));
}

function normalizeReturns(records) {
  return (records || []).map((item) => ({
    assets: [],
    category: 'returns',
    categoryLabel: 'Returns',
    date: item.finalized_at || item.owner_return_confirmed_at || item.borrower_return_confirmed_at,
    details: joinParts([
      item.returned_condition ? `Condition: ${item.returned_condition}` : '',
      `Deposit: ${item.deposit_decision}`,
      item.deduction_amount ? `Deduction: ${currencyFormatter.format(Number(item.deduction_amount) || 0)}` : '',
      item.owner_notes,
      item.borrower_notes,
    ]),
    id: `returns-${item.id}`,
    reference: item.booking_id,
    status: item.finalized_at ? 'finalized' : item.deposit_decision,
    subject: 'Return record',
  }));
}

function normalizeReviews(records, profileById = new Map()) {
  return (records || []).map((item) => ({
    assets: [],
    category: 'reviews',
    categoryLabel: 'Reviews',
    date: item.created_at,
    details: joinParts([
      `Reviewer: ${resolveIdentity(profileById, item.reviewer_id)}`,
      `Reviewee: ${resolveIdentity(profileById, item.reviewee_id)}`,
      `Role: ${item.reviewer_role}`,
      item.review_text,
    ]),
    id: `reviews-${item.id}`,
    reference: item.booking_id,
    status: 'submitted',
    subject: `${item.rating}/5 rating`,
  }));
}

function normalizePayments(records, profileById = new Map()) {
  return (records || []).map((item) => ({
    assets: item.proof_url ? [{ label: 'Proof', url: item.proof_url }] : [],
    category: 'payments',
    categoryLabel: 'Payments',
    date: item.transaction_at,
    details: joinParts([
      `Payer: ${resolveIdentity(profileById, item.payer_id)}`,
      item.payee_id ? `Payee: ${resolveIdentity(profileById, item.payee_id)}` : '',
      item.payment_method ? `Method: ${item.payment_method}` : '',
      item.reference_number ? `Ref: ${item.reference_number}` : '',
      item.notes,
    ]),
    id: `payments-${item.id}`,
    paymentAmount: Number(item.amount) || 0,
    paymentTransactionType: String(item.transaction_type || '').toLowerCase(),
    reference: item.booking_id,
    status: item.status || 'pending',
    subject: `${currencyFormatter.format(Number(item.amount) || 0)} ${item.transaction_type || 'transaction'}`,
  }));
}

function normalizeVerifications(records) {
  return (records || []).map((item) => ({
    assets: [
      item.id_front_url ? { label: 'Front ID', url: item.id_front_url } : null,
      item.id_back_url ? { label: 'Back ID', url: item.id_back_url } : null,
      item.selfie_url ? { label: 'Selfie', url: item.selfie_url } : null,
    ].filter(Boolean),
    category: 'verifications',
    categoryLabel: 'Verifications',
    date: item.reviewed_at || item.submitted_at,
    details: joinParts([
      buildProfileName(item.profile) ? `Name: ${buildProfileName(item.profile)}` : `User: ${item.user_id}`,
      item.profile?.username ? `Username: ${item.profile.username}` : '',
      item.id_number_masked ? `ID: ${item.id_number_masked}` : '',
      item.remarks,
    ]),
    id: `verifications-${item.id}`,
    reference: buildProfileName(item.profile) || item.user_id,
    reviewAccountStatus: item.profile?.account_status || '',
    reviewJoinedAt: item.profile?.created_at || '',
    reviewId: item.id,
    reviewMaskedId: item.id_number_masked || '',
    reviewProfile: item.profile || null,
    reviewProfileLocation: buildProfileLocation(item.profile),
    reviewProfileName: buildProfileName(item.profile) || item.user_id,
    reviewProfileState: item.profile?.is_profile_complete ? 'Complete' : 'Needs completion',
    reviewRemarks: item.remarks || '',
    reviewSubmittedAt: item.submitted_at,
    reviewUserId: item.user_id,
    status: item.status || 'pending',
    subject: item.id_type || 'Identity verification',
  }));
}

export default function ManageReports() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [selectedVerification, setSelectedVerification] = useState(null);
  const [reviewRemarks, setReviewRemarks] = useState('');
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewFeedbackTone, setReviewFeedbackTone] = useState('info');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [selectedDamageClaim, setSelectedDamageClaim] = useState(null);
  const [damageEvidence, setDamageEvidence] = useState([]);
  const [damageReviewAmount, setDamageReviewAmount] = useState('');
  const [damageReviewNotes, setDamageReviewNotes] = useState('');
  const [damageReviewSaving, setDamageReviewSaving] = useState(false);

  async function loadReportFeeds(showLoader = true) {
      if (showLoader) {
        setLoading(true);
      }

      const queries = [
        {
          label: 'damage_claims',
          normalize: normalizeDamageClaims,
          request: supabase
            .from('damage_claims')
            .select(
              'id, report_id, booking_id, item_id, owner_id, borrower_id, damage_description, claimed_amount, admin_approved_amount, amount_due, status, reviewed_at, admin_notes, created_at'
            )
            .order('created_at', { ascending: false })
            .limit(50),
        },
        {
          label: 'reports',
          normalize: normalizeReports,
          request: supabase
            .from('reports')
            .select('id, booking_id, reporter_id, reported_user_id, report_type, description, evidence_url, status, created_at')
            .order('created_at', { ascending: false })
            .limit(50),
        },
        {
          label: 'return_records',
          normalize: normalizeReturns,
          request: supabase
            .from('return_records')
            .select(
              'id, booking_id, borrower_return_confirmed_at, owner_return_confirmed_at, returned_condition, owner_notes, borrower_notes, deposit_decision, deduction_amount, finalized_at'
            )
            .order('finalized_at', { ascending: false })
            .limit(50),
        },
        {
          label: 'reviews',
          normalize: normalizeReviews,
          request: supabase
            .from('reviews')
            .select('id, booking_id, reviewer_id, reviewee_id, reviewer_role, rating, review_text, created_at')
            .order('created_at', { ascending: false })
            .limit(50),
        },
        {
          label: 'payment_transactions',
          normalize: normalizePayments,
          request: supabase
            .from('payment_transactions')
            .select('id, booking_id, payer_id, payee_id, transaction_type, amount, payment_method, status, reference_number, proof_url, transaction_at, notes')
            .order('transaction_at', { ascending: false })
            .limit(50),
        },
        {
          label: 'identity_verifications',
          normalize: normalizeVerifications,
          request: supabase
            .from('identity_verifications')
            .select(
              'id, user_id, id_type, id_number_masked, id_front_url, id_back_url, selfie_url, submitted_at, reviewed_at, status, remarks, profile:profiles!identity_verifications_user_id_fkey(id, first_name, middle_name, last_name, suffix, username, phone_number, street, barangay, city, province, region, country, account_status, verification_status, is_profile_complete, created_at)'
            )
            .order('submitted_at', { ascending: false })
            .limit(50),
        },
      ];

      const results = await Promise.all(queries.map((query) => query.request));

      const nextRecords = [];
      const errors = [];
      const profileIds = new Set();

      const resultByLabel = new Map();
      results.forEach((result, index) => {
        const label = queries[index].label;
        resultByLabel.set(label, result.data || []);
      });

      (resultByLabel.get('damage_claims') || []).forEach((row) => {
        if (row.owner_id) profileIds.add(row.owner_id);
        if (row.borrower_id) profileIds.add(row.borrower_id);
      });
      (resultByLabel.get('reports') || []).forEach((row) => {
        if (row.reporter_id) profileIds.add(row.reporter_id);
        if (row.reported_user_id) profileIds.add(row.reported_user_id);
      });
      (resultByLabel.get('reviews') || []).forEach((row) => {
        if (row.reviewer_id) profileIds.add(row.reviewer_id);
        if (row.reviewee_id) profileIds.add(row.reviewee_id);
      });
      (resultByLabel.get('payment_transactions') || []).forEach((row) => {
        if (row.payer_id) profileIds.add(row.payer_id);
        if (row.payee_id) profileIds.add(row.payee_id);
      });

      let profileById = new Map();
      if (profileIds.size) {
        const { data: profileRows, error: profileError } = await supabase
          .from('profiles')
          .select('id, first_name, middle_name, last_name, suffix, username')
          .in('id', Array.from(profileIds));

        if (profileError) {
          errors.push(`profiles: ${profileError.message}`);
        } else {
          profileById = new Map((profileRows || []).map((profile) => [profile.id, profile]));
        }
      }

      results.forEach((result, index) => {
        if (result.error) {
          errors.push(`${queries[index].label}: ${result.error.message}`);
          return;
        }

        nextRecords.push(...queries[index].normalize(result.data, profileById));
      });

      nextRecords.sort((left, right) => {
        const leftTime = left.date ? new Date(left.date).getTime() : 0;
        const rightTime = right.date ? new Date(right.date).getTime() : 0;
        return rightTime - leftTime;
      });

      setRecords(nextRecords);
      setError(errors.join(' '));
      setLoading(false);
  }

  useEffect(() => {
    loadReportFeeds();

  }, []);

  function openVerificationReview(record) {
    setSelectedVerification(record);
    setReviewRemarks(record.reviewRemarks || '');
    setReviewFeedback('');
    setReviewFeedbackTone('info');
  }

  async function handleVerificationDecision(nextStatus) {
    if (!selectedVerification || reviewSaving) {
      return;
    }

    const normalizedRemarks = reviewRemarks.trim();

    if (nextStatus === 'rejected' && !normalizedRemarks) {
      setReviewFeedback('State the reason for rejection so the user can see why the submission was declined.');
      setReviewFeedbackTone('warning');
      return;
    }

    setReviewSaving(true);
    setReviewFeedback('');

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Admin account not authenticated.');
      }

      const persistedStatus = getVerificationPersistedStatus(nextStatus);
      const reviewedAt = new Date().toISOString();
      const { error: verificationError } = await supabase
        .from('identity_verifications')
        .update({
          remarks: normalizedRemarks || null,
          reviewed_at: reviewedAt,
          reviewed_by: user.id,
          status: persistedStatus,
        })
        .eq('id', selectedVerification.reviewId);

      if (verificationError) {
        throw new Error(verificationError.message);
      }

      const profileUpdate = {
        is_verified: nextStatus === 'approved',
        verification_status: persistedStatus,
        ...(nextStatus === 'approved' ? { is_profile_complete: true } : {}),
      };

      const { error: profileError } = await supabase.from('profiles').update(profileUpdate).eq('id', selectedVerification.reviewUserId);

      if (profileError) {
        throw new Error(profileError.message);
      }

      setSelectedVerification(null);
      setReviewRemarks('');
      setReviewFeedback(nextStatus === 'approved' ? 'Verification approved.' : 'Verification rejected and reason saved.');
      setReviewFeedbackTone(nextStatus === 'approved' ? 'success' : 'warning');
      await loadReportFeeds(false);
    } catch (reviewError) {
      setReviewFeedback(`Review update failed: ${reviewError.message}`);
      setReviewFeedbackTone('danger');
    } finally {
      setReviewSaving(false);
    }
  }

  async function openDamageClaimReview(record) {
    setSelectedDamageClaim(record);
    setDamageReviewAmount(String(record.damageAdminAmount || ''));
    setDamageReviewNotes(record.damageAdminNotes || '');
    setDamageEvidence([]);
    setReviewFeedback('');
    setReviewFeedbackTone('info');

    const { data, error: evidenceError } = await supabase
      .from('report_evidences')
      .select('id, evidence_url, evidence_type, uploaded_by, uploaded_at')
      .eq('report_id', record.damageReportId)
      .order('uploaded_at', { ascending: true });

    if (evidenceError) {
      setReviewFeedback(`Unable to load damage evidence: ${evidenceError.message}`);
      setReviewFeedbackTone('warning');
      return;
    }

    let evidenceWithUrls = await Promise.all(
      (data || []).map(async (item) => ({
        ...item,
        display_url: await resolveReportEvidenceUrl(item.evidence_url),
      }))
    );

    if (!evidenceWithUrls.length && record.damageReportId) {
      const { data: reportRow, error: reportError } = await supabase
        .from('reports')
        .select('id, evidence_url')
        .eq('id', record.damageReportId)
        .maybeSingle();

      if (!reportError && reportRow?.evidence_url) {
        evidenceWithUrls = [
          {
            display_url: await resolveReportEvidenceUrl(reportRow.evidence_url),
            evidence_type: 'photo',
            evidence_url: reportRow.evidence_url,
            id: `report-${reportRow.id}`,
          },
        ];
      }
    }

    setDamageEvidence(evidenceWithUrls);
  }

  async function handleDamageClaimDecision(nextDecision) {
    if (!selectedDamageClaim || damageReviewSaving) {
      return;
    }

    const notes = damageReviewNotes.trim();
    const approvedAmount = Number(damageReviewAmount);

    if (nextDecision === 'approve' && (!Number.isFinite(approvedAmount) || approvedAmount < 0)) {
      setReviewFeedback('Enter a valid approved damage amount.');
      setReviewFeedbackTone('warning');
      return;
    }

    if (nextDecision === 'reject' && !notes) {
      setReviewFeedback('State why the damage claim is rejected.');
      setReviewFeedbackTone('warning');
      return;
    }

    setDamageReviewSaving(true);
    setReviewFeedback('');

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('Admin account not authenticated.');
      }

      if (nextDecision === 'approve') {
        await approveDamageClaim(selectedDamageClaim.damageClaimId, {
          adminId: user.id,
          approvedAmount,
          notes,
        });
        setReviewFeedback('Damage claim approved. The borrower restriction is now active until the claim is settled.');
        setReviewFeedbackTone('success');
      } else {
        await rejectDamageClaim(selectedDamageClaim.damageClaimId, {
          adminId: user.id,
          notes,
        });
        setReviewFeedback('Damage claim rejected. No borrower restriction was created.');
        setReviewFeedbackTone('warning');
      }

      setSelectedDamageClaim(null);
      setDamageEvidence([]);
      await loadReportFeeds(false);
    } catch (damageReviewError) {
      setReviewFeedback(`Damage review failed: ${damageReviewError.message}`);
      setReviewFeedbackTone('danger');
    } finally {
      setDamageReviewSaving(false);
    }
  }

  const filteredRecords = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return records.filter((record) => {
      if (categoryFilter !== 'all' && record.category !== categoryFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [record.categoryLabel, record.reference, record.subject, record.details, record.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [categoryFilter, records, searchQuery]);

  const totalRecords = records.length;
  const openRecords = useMemo(() => records.filter((record) => ['open', 'pending'].includes((record.status || '').toLowerCase())).length, [records]);
  const resolvedRecords = useMemo(
    () => records.filter((record) => ['approved', 'verified', 'completed', 'finalized', 'paid', 'resolved', 'submitted', 'success'].includes((record.status || '').toLowerCase())).length,
    [records]
  );
  const commissionIncome = useMemo(
    () =>
      records.reduce((sum, record) => {
        if (record.category !== 'payments') {
          return sum;
        }

        const normalizedStatus = String(record.status || '').toLowerCase();
        const isSettled = ['paid', 'recorded', 'completed', 'success', 'resolved'].includes(normalizedStatus);
        if (!isSettled) {
          return sum;
        }

        const normalizedType = String(record.paymentTransactionType || '').toLowerCase();
        const normalizedDetails = String(record.details || '').toLowerCase();
        const isCommission =
          ['platform_fee', 'commission_fee', 'service_fee'].includes(normalizedType) ||
          normalizedDetails.includes('platform commission fee');

        if (!isCommission) {
          return sum;
        }

        return sum + (Number(record.paymentAmount) || 0);
      }, 0),
    [records]
  );

  return (
    <AdminShell subtitle="" title="">
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
      {reviewFeedback ? <StatusMessage tone={reviewFeedbackTone}>{reviewFeedback}</StatusMessage> : null}

      <Modal
        actions={<Button onClick={() => setSelectedRecord(null)} type="button" variant="ghost">Close</Button>}
        onClose={() => setSelectedRecord(null)}
        open={Boolean(selectedRecord)}
        title="Report details"
      >
        {selectedRecord ? (
          <div className="admin-report-detail">
            <div className="admin-report-detail-table-wrap">
              <table className="admin-report-detail-table">
                <tbody>
                  <tr><th>Category</th><td><Badge tone="info">{selectedRecord.categoryLabel}</Badge></td></tr>
                  <tr><th>Status</th><td><Badge tone={statusTone(selectedRecord.status)}>{getVerificationStatusLabel(selectedRecord.status)}</Badge></td></tr>
                  <tr><th>Subject</th><td><strong>{selectedRecord.subject}</strong></td></tr>
                  <tr><th>Date</th><td>{formatDate(selectedRecord.date)}</td></tr>
                  {(selectedRecord.details || 'No additional details saved.').split(' | ').map((detail, index) => (
                    <tr key={`${selectedRecord.id}-detail-${index}`}>
                      <th>{index === 0 ? 'Details' : ''}</th>
                      <td>{detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-report-detail-actions">
              {selectedRecord.category === 'verifications' ? (
                <Button onClick={() => { setSelectedRecord(null); openVerificationReview(selectedRecord); }} type="button" variant="secondary">
                  Review submission
                </Button>
              ) : selectedRecord.category === 'damage_claims' ? (
                <Button onClick={() => { setSelectedRecord(null); openDamageClaimReview(selectedRecord); }} type="button" variant="secondary">
                  Review damage
                </Button>
              ) : (selectedRecord.assets || []).length ? (
                selectedRecord.assets.map((asset) => (
                  <Button as="a" href={asset.url} key={`${selectedRecord.id}-${asset.label}`} rel="noreferrer" target="_blank" variant="secondary">
                    {asset.label}
                  </Button>
                ))
              ) : (
                <span>No attached files.</span>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal onClose={() => setSelectedVerification(null)} open={Boolean(selectedVerification)} title="Verification review">
        {selectedVerification ? (
          <div style={{ display: 'grid', gap: 18 }}>
            <p style={{ color: theme.colors.slate, lineHeight: 1.7, margin: 0 }}>
              Review the submitted identity verification assets, then approve or reject the record. Rejection remarks will be visible on the user side so they can submit again.
            </p>

            <SectionGrid columns={3} style={{ gap: 14 }}>
              <MetricCard
                detail="Current review status of the latest verification submission."
                icon={<span style={{ fontSize: 18, fontWeight: 700 }}>!</span>}
                label="Status"
                style={{ borderRadius: 18, minHeight: 0, padding: 12 }}
                tone={theme.colors.amber}
                value={getVerificationStatusLabel(selectedVerification.status)}
              />
              <MetricCard
                detail={`Masked ID: ${readValue(selectedVerification.reviewMaskedId)}`}
                icon={<span style={{ fontSize: 18, fontWeight: 700 }}>ID</span>}
                label="ID type"
                style={{ borderRadius: 18, minHeight: 0, padding: 12 }}
                tone={theme.colors.sky}
                value={selectedVerification.subject}
              />
              <MetricCard
                detail={`Submitted ${formatDate(selectedVerification.reviewSubmittedAt)}`}
                icon={<span style={{ fontSize: 18, fontWeight: 700 }}>&#10003;</span>}
                label="Member"
                style={{ borderRadius: 18, minHeight: 0, padding: 12 }}
                tone={theme.colors.teal}
                value={selectedVerification.reviewProfileName}
              />
            </SectionGrid>

            <div className="panel-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: '1.1fr 0.9fr' }}>
              <div
                className="glass-panel"
                style={{
                  borderRadius: 22,
                  display: 'grid',
                  gap: 10,
                  minHeight: 0,
                  padding: 18,
                }}
              >
                <strong
                  style={{
                    color: theme.colors.ink,
                    fontFamily: theme.fonts.display,
                    fontSize: 24,
                    letterSpacing: '-0.05em',
                  }}
                >
                  Profile credentials
                </strong>
                {selectedVerification.reviewProfile ? (
                  <div style={{ display: 'grid' }}>
                    <ReviewDetailRow label="Name" value={readValue(selectedVerification.reviewProfileName)} />
                    <ReviewDetailRow
                      label="Username"
                      value={selectedVerification.reviewProfile?.username ? `@${selectedVerification.reviewProfile.username}` : 'Not set'}
                    />
                    <ReviewDetailRow label="Phone" value={readValue(selectedVerification.reviewProfile?.phone_number)} />
                    <ReviewDetailRow label="Address" value={readValue(selectedVerification.reviewProfileLocation)} />
                    <ReviewDetailRow label="Account status" value={readValue(selectedVerification.reviewAccountStatus, 'Active')} />
                    <ReviewDetailRow label="Profile state" value={readValue(selectedVerification.reviewProfileState)} />
                  </div>
                ) : (
                  <StatusMessage tone="info">No linked profile snapshot was returned for this verification record.</StatusMessage>
                )}
              </div>

              <div
                className="glass-panel"
                style={{
                  borderRadius: 22,
                  display: 'grid',
                  gap: 10,
                  minHeight: 0,
                  padding: 18,
                }}
              >
                <strong
                  style={{
                    color: theme.colors.ink,
                    fontFamily: theme.fonts.display,
                    fontSize: 24,
                    letterSpacing: '-0.05em',
                  }}
                >
                  Submission record
                </strong>
                <div style={{ display: 'grid' }}>
                  <ReviewDetailRow label="User ID" value={selectedVerification.reviewUserId} />
                  <ReviewDetailRow label="ID type" value={selectedVerification.subject} />
                  <ReviewDetailRow label="Masked ID" value={readValue(selectedVerification.reviewMaskedId)} />
                  <ReviewDetailRow label="Submitted" value={formatDate(selectedVerification.reviewSubmittedAt)} />
                  <ReviewDetailRow label="Profile joined" value={formatDate(selectedVerification.reviewJoinedAt)} />
                  <ReviewDetailRow label="Current status" value={getVerificationStatusLabel(selectedVerification.status)} />
                </div>
              </div>
            </div>

            <div className="panel-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {selectedVerification.assets.map((asset) => (
                <div
                  key={`${selectedVerification.id}-${asset.label}`}
                  className="glass-panel"
                  style={{
                    borderRadius: 22,
                    display: 'grid',
                    gap: 8,
                    minHeight: 0,
                    overflow: 'hidden',
                    padding: 12,
                  }}
                >
                  <strong
                    style={{
                      color: theme.colors.ink,
                      fontFamily: theme.fonts.display,
                      fontSize: 16,
                      letterSpacing: '-0.04em',
                    }}
                  >
                    {asset.label}
                  </strong>
                  <div
                    style={{
                      background: alpha(theme.colors.ink, 0.04),
                      border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                      borderRadius: 18,
                      height: 150,
                      overflow: 'hidden',
                    }}
                  >
                    <img
                      alt={asset.label}
                      src={asset.url}
                      style={{
                        display: 'block',
                        height: '100%',
                        objectFit: 'cover',
                        width: '100%',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <label style={{ display: 'grid', gap: 10 }}>
              <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Review remarks / rejection reason</span>
              <Textarea
                onChange={(event) => setReviewRemarks(event.target.value)}
                placeholder="State why this verification is being rejected, or leave an approval note."
                style={{ minHeight: 104 }}
                value={reviewRemarks}
              />
            </label>

            {selectedVerification.reviewRemarks ? <StatusMessage tone="info">Previous remarks: {selectedVerification.reviewRemarks}</StatusMessage> : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
              <Button onClick={() => setSelectedVerification(null)} type="button" variant="ghost">
                Close
              </Button>
              <Button disabled={reviewSaving} onClick={() => handleVerificationDecision('rejected')} type="button" variant="danger">
                Reject
              </Button>
              <Button disabled={reviewSaving} onClick={() => handleVerificationDecision('approved')} type="button">
                Approve
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal onClose={() => setSelectedDamageClaim(null)} open={Boolean(selectedDamageClaim)} title="Damage claim review">
        {selectedDamageClaim ? (
          <div style={{ display: 'grid', gap: 18 }}>
            <StatusMessage tone="info">
              Approving creates the borrower damage hold. Rejecting leaves the borrower able to rent and list.
            </StatusMessage>

            <SectionGrid columns={3} style={{ gap: 14 }}>
              <MetricCard
                detail={`Booking ${selectedDamageClaim.reference}`}
                icon={<span style={{ fontSize: 18, fontWeight: 700 }}>!</span>}
                label="Status"
                style={{ borderRadius: 18, minHeight: 0, padding: 12 }}
                tone={theme.colors.amber}
                value={getVerificationStatusLabel(selectedDamageClaim.status)}
              />
              <MetricCard
                detail="Owner submitted claimed amount."
                icon={<span style={{ fontSize: 18, fontWeight: 700 }}>PHP</span>}
                label="Claimed"
                style={{ borderRadius: 18, minHeight: 0, padding: 12 }}
                tone={theme.colors.coral}
                value={currencyFormatter.format(Number(selectedDamageClaim.damageClaimedAmount) || 0)}
              />
              <MetricCard
                detail={`Borrower ${selectedDamageClaim.damageBorrowerId}`}
                icon={<span style={{ fontSize: 18, fontWeight: 700 }}>ID</span>}
                label="Borrower"
                style={{ borderRadius: 18, minHeight: 0, padding: 12 }}
                tone={theme.colors.sky}
                value="Damage hold target"
              />
            </SectionGrid>

            <ReviewDetailRow label="Owner" value={selectedDamageClaim.damageOwnerId} />
            <ReviewDetailRow label="Borrower" value={selectedDamageClaim.damageBorrowerId} />
            <ReviewDetailRow label="Item" value={selectedDamageClaim.damageItemId} />
            <ReviewDetailRow label="Description" value={selectedDamageClaim.damageDescription} />

            <div className="panel-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              {damageEvidence.length ? (
                damageEvidence.map((asset) => (
                  <div
                    key={asset.id}
                    className="glass-panel"
                    style={{
                      borderRadius: 22,
                      display: 'grid',
                      gap: 8,
                      minHeight: 0,
                      overflow: 'hidden',
                      padding: 12,
                    }}
                  >
                    <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 16, letterSpacing: '-0.04em' }}>
                      {asset.evidence_type || 'photo'}
                    </strong>
                    <a href={asset.display_url || asset.evidence_url} rel="noreferrer" target="_blank">
                      <img
                        alt="Damage evidence"
                        src={asset.display_url || asset.evidence_url}
                        style={{
                          background: alpha(theme.colors.ink, 0.04),
                          border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                          borderRadius: 18,
                          display: 'block',
                          height: 150,
                          objectFit: 'cover',
                          width: '100%',
                        }}
                      />
                    </a>
                  </div>
                ))
              ) : (
                <StatusMessage tone="warning">No photo evidence was loaded for this damage claim.</StatusMessage>
              )}
            </div>

            <label style={{ display: 'grid', gap: 10 }}>
              <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Admin-approved amount</span>
              <Input min="0" onChange={(event) => setDamageReviewAmount(event.target.value)} step="0.01" type="number" value={damageReviewAmount} />
            </label>

            <label style={{ display: 'grid', gap: 10 }}>
              <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Admin notes</span>
              <Textarea
                onChange={(event) => setDamageReviewNotes(event.target.value)}
                placeholder="Approval notes or rejection reason."
                style={{ minHeight: 104 }}
                value={damageReviewNotes}
              />
            </label>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' }}>
              <Button disabled={damageReviewSaving} onClick={() => setSelectedDamageClaim(null)} type="button" variant="ghost">
                Close
              </Button>
              <Button disabled={damageReviewSaving} onClick={() => handleDamageClaimDecision('reject')} type="button" variant="danger">
                Reject
              </Button>
              <Button disabled={damageReviewSaving} onClick={() => handleDamageClaimDecision('approve')} type="button">
                Approve and restrict
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionGrid columns={4} style={{ gap: 16, position: 'relative', zIndex: 1 }}>
          <MetricCard
            detail="Combined records loaded from the report-related tables in Supabase."
            icon={<span style={{ fontSize: 18, fontWeight: 700 }}>#</span>}
            label="Records"
            tone={theme.colors.coral}
            value={loading ? 'Loading...' : `${totalRecords}`}
          />
          <MetricCard
            detail="Rows that still read as open or pending across the combined report feed."
            icon={<span style={{ fontSize: 18, fontWeight: 700 }}>!</span>}
            label="Open"
            tone={theme.colors.amber}
            value={loading ? 'Loading...' : `${openRecords}`}
          />
          <MetricCard
            detail="Rows already resolved, finalized, submitted, or otherwise completed."
            icon={<span style={{ fontSize: 18, fontWeight: 700 }}>&#10003;</span>}
            label="Resolved"
            tone={theme.colors.teal}
            value={loading ? 'Loading...' : `${resolvedRecords}`}
          />
          <MetricCard
            detail="Total settled platform commission fee transactions."
            icon={<span style={{ fontSize: 18, fontWeight: 700 }}>₱</span>}
            label="Commission Income"
            tone={theme.colors.sky}
            value={loading ? 'Loading...' : currencyFormatter.format(commissionIncome)}
          />
        </SectionGrid>

        <Panel style={{ marginTop: 0, padding: '8px 24px 24px', position: 'relative', zIndex: 0 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="form-grid admin-filter-toolbar" style={{ alignItems: 'end', display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) 280px auto' }}>
              <label style={{ display: 'grid', gap: 10 }}>
                <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Search records</span>
                <Input name="report_search" onChange={(event) => setSearchQuery(event.target.value)} value={searchQuery} />
              </label>

              <label style={{ display: 'grid', gap: 10 }}>
                <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Category</span>
                <select
                  name="category_filter"
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  style={{
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
                  }}
                  value={categoryFilter}
                >
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <Badge style={{ alignSelf: 'center', justifySelf: 'flex-start', marginBottom: 2 }} tone="info">
                {loading ? 'Loading records' : `${filteredRecords.length} shown`}
              </Badge>
            </div>

            {loading ? <StatusMessage tone="info">Loading report records.</StatusMessage> : null}
            {!loading && !filteredRecords.length ? <StatusMessage tone="info">No records match the current search and category filter.</StatusMessage> : null}

            {!loading && filteredRecords.length ? (
              <div
                style={{
                  border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                  overflowX: 'auto',
                }}
              >
                <table className="admin-report-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 760, width: '100%' }}>
                  <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                    <tr>
                      <th style={headerCellStyle}>Category</th>
                      <th style={headerCellStyle}>Subject</th>
                      <th style={headerCellStyle}>Status</th>
                      <th style={headerCellStyle}>Date</th>
                      <th style={headerCellStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((record) => (
                      <tr key={record.id}>
                        <td style={bodyCellStyle}>
                          <Badge tone="info">{record.categoryLabel}</Badge>
                        </td>
                        <td style={bodyCellStyle}>
                          <strong
                            style={{
                              color: theme.colors.ink,
                              fontFamily: theme.fonts.display,
                              fontSize: 17,
                              letterSpacing: '-0.03em',
                            }}
                          >
                            {record.subject}
                          </strong>
                        </td>
                        <td style={bodyCellStyle}>
                          <Badge tone={statusTone(record.status)}>{getVerificationStatusLabel(record.status)}</Badge>
                        </td>
                        <td style={bodyCellStyle}>
                          <span style={{ color: theme.colors.ink }}>{formatDate(record.date)}</span>
                        </td>
                        <td style={bodyCellStyle}>
                          <Button onClick={() => setSelectedRecord(record)} type="button" variant="secondary">View</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>
    </AdminShell>
  );
}
