import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { approveDamageClaim, rejectDamageClaim, resolveReportEvidenceUrl } from '../../services/damageClaimsService';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
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
  { label: 'Promotion income', value: 'promotion_income' },
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

function getVerificationStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'verified') {
    return 'approved';
  }

  return String(status || 'Unknown').replace(/[_-]+/g, ' ');
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

function formatLocalDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function joinParts(parts) {
  return parts.filter(Boolean).join(' | ');
}

function buildProfileName(profile) {
  if (!profile) {
    return '';
  }

  return [profile.first_name, profile.middle_name, profile.last_name, profile.suffix].filter(Boolean).join(' ');
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

function normalizePromotionIncome(records, profileById = new Map()) {
  return (records || []).map((item) => ({
    assets: [],
    category: 'promotion_income',
    categoryLabel: 'Promotion income',
    date: item.paid_at,
    details: joinParts([
      `Lender: ${resolveIdentity(profileById, item.lender_id)}`,
      `Item: ${item.item_id}`,
      `Checkout: ${item.paymongo_checkout_session_id}`,
      item.paymongo_payment_id ? `Payment: ${item.paymongo_payment_id}` : '',
    ]),
    id: `promotion-income-${item.id}`,
    paymentAmount: Number(item.amount) || 0,
    reference: item.promotion_id,
    status: item.status,
    subject: `${currencyFormatter.format(Number(item.amount) || 0)} banner promotion`,
  }));
}

export default function ManageReports() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewFeedbackTone, setReviewFeedbackTone] = useState('info');
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
          label: 'promotion_payments',
          normalize: normalizePromotionIncome,
          request: supabase
            .from('promotion_payments')
            .select('id, promotion_id, lender_id, item_id, paymongo_checkout_session_id, paymongo_payment_id, amount, currency, status, paid_at')
            .order('paid_at', { ascending: false })
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
      (resultByLabel.get('promotion_payments') || []).forEach((row) => {
        if (row.lender_id) profileIds.add(row.lender_id);
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
    const invalidDateRange = Boolean(startDate && endDate && startDate > endDate);

    return records.filter((record) => {
      if (invalidDateRange) return false;
      if (categoryFilter !== 'all' && record.category !== categoryFilter) {
        return false;
      }

      if (startDate || endDate) {
        const recordDate = formatLocalDateInput(record.date);
        if (!recordDate || (startDate && recordDate < startDate) || (endDate && recordDate > endDate)) {
          return false;
        }
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
  }, [categoryFilter, endDate, records, searchQuery, startDate]);

  const invalidDateRange = Boolean(startDate && endDate && startDate > endDate);

  function exportFilteredRecordsPdf() {
    if (!filteredRecords.length) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.alert('Allow pop-ups for this page to export the PDF.');
      return;
    }

    const categoryLabel = categoryOptions.find((option) => option.value === categoryFilter)?.label || 'All categories';
    const dateRangeLabel = startDate || endDate
      ? `${startDate || 'Any date'} to ${endDate || 'Any date'}`
      : 'All dates';
    const rows = filteredRecords.map((record) => `
      <tr>
        <td>${escapeHtml(record.categoryLabel)}</td>
        <td>${escapeHtml(record.subject)}</td>
        <td>${escapeHtml(record.reference || '—')}</td>
        <td>${escapeHtml(record.details || '—')}</td>
        <td>${escapeHtml(getVerificationStatusLabel(record.status))}</td>
        <td>${escapeHtml(formatDate(record.date))}</td>
      </tr>`).join('');

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Borrow Ko 'To — Reports</title>
          <style>
            @page { size: landscape; margin: 14mm; }
            * { box-sizing: border-box; }
            body { color: #10233f; font: 10pt Arial, sans-serif; margin: 0; }
            h1 { font-size: 20pt; margin: 0 0 6px; }
            .meta { color: #52647e; display: flex; gap: 24px; margin-bottom: 16px; }
            table { border-collapse: collapse; table-layout: fixed; width: 100%; }
            th, td { border: 1px solid #dbe3f0; overflow-wrap: anywhere; padding: 7px 8px; text-align: left; vertical-align: top; }
            th { background: #f1f3f7; font-size: 8pt; letter-spacing: .06em; text-transform: uppercase; }
            th:nth-child(1) { width: 13%; } th:nth-child(2) { width: 18%; }
            th:nth-child(3) { width: 12%; } th:nth-child(4) { width: 34%; }
            th:nth-child(5) { width: 11%; } th:nth-child(6) { width: 12%; }
            tr { break-inside: avoid; }
          </style>
        </head>
        <body>
          <h1>Reports</h1>
          <div class="meta"><span>Category: ${escapeHtml(categoryLabel)}</span><span>Date range: ${escapeHtml(dateRangeLabel)}</span><span>${filteredRecords.length} records</span></div>
          <table><thead><tr><th>Category</th><th>Subject</th><th>Reference</th><th>Details</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
        </body>
      </html>`);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

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
  const promotionIncome = useMemo(
    () => records.reduce((sum, record) => record.category === 'promotion_income' && record.status === 'paid' ? sum + (Number(record.paymentAmount) || 0) : sum, 0),
    [records]
  );

  if (loading) {
    return (
      <AdminShell subtitle="" title="">
        <DataLoadingScreen label="Loading reports" message="Loading reports and claims from the database." title="Getting report records" />
      </AdminShell>
    );
  }

  return (
    <AdminShell subtitle="" title="">
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
      {reviewFeedback ? <StatusMessage tone={reviewFeedbackTone}>{reviewFeedback}</StatusMessage> : null}

      <Modal
        actions={selectedRecord ? (
          <div className="admin-report-detail-actions">
            {selectedRecord.category === 'damage_claims' ? (
              <Button onClick={() => { setSelectedRecord(null); openDamageClaimReview(selectedRecord); }} type="button" variant="secondary">
                Review damage
              </Button>
            ) : (selectedRecord.assets || []).length ? (
              selectedRecord.assets.map((asset) => (
                <Button as="a" href={asset.url} key={`${selectedRecord.id}-${asset.label}`} rel="noreferrer" target="_blank" variant="secondary">
                  {asset.label}
                </Button>
              ))
            ) : null}
            <Button onClick={() => setSelectedRecord(null)} type="button" variant="ghost">
              Close
            </Button>
          </div>
        ) : null}
        contentClassName="admin-report-details-modal"
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
        </div>
        ) : null}
      </Modal>

      <Modal
        actions={selectedDamageClaim ? (
          <div className="admin-damage-review-actions">
            <Button disabled={damageReviewSaving} onClick={() => setSelectedDamageClaim(null)} type="button" variant="ghost">
              Close
            </Button>
            <Button disabled={damageReviewSaving} onClick={() => handleDamageClaimDecision('reject')} type="button" variant="danger">
              Reject claim
            </Button>
            <Button disabled={damageReviewSaving} onClick={() => handleDamageClaimDecision('approve')} type="button">
              Approve and restrict
            </Button>
          </div>
        ) : null}
        contentClassName="admin-damage-review-modal"
        onClose={() => setSelectedDamageClaim(null)}
        open={Boolean(selectedDamageClaim)}
        title="Damage claim review"
      >
        {selectedDamageClaim ? (
          <div className="admin-damage-review-content">
            <StatusMessage tone="info">
              Approving creates a damage hold for the borrower. Rejecting closes the claim without restricting their account.
            </StatusMessage>

            <SectionGrid className="admin-damage-review-summary" columns={3} style={{ gap: 14 }}>
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
            <ReviewDetailRow label="Item reference" value={selectedDamageClaim.damageItemId} />
            <ReviewDetailRow label="Description" value={selectedDamageClaim.damageDescription} />

            <div className="admin-damage-evidence-grid">
              {damageEvidence.length ? (
                damageEvidence.map((asset) => (
                  <div key={asset.id} className="admin-damage-evidence-card">
                    <strong>
                      {asset.evidence_type || 'photo'}
                    </strong>
                    <a href={asset.display_url || asset.evidence_url} rel="noreferrer" target="_blank">
                      <img
                        alt="Damage evidence"
                        src={asset.display_url || asset.evidence_url}
                      />
                      <span>Open full image</span>
                    </a>
                  </div>
                ))
              ) : (
                <StatusMessage tone="warning">No photo evidence was loaded for this damage claim.</StatusMessage>
              )}
            </div>

            <label className="admin-damage-review-field">
              <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Admin-approved amount</span>
              <Input min="0" onChange={(event) => setDamageReviewAmount(event.target.value)} step="0.01" type="number" value={damageReviewAmount} />
            </label>

            <label className="admin-damage-review-field">
              <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Admin notes</span>
              <Textarea
                onChange={(event) => setDamageReviewNotes(event.target.value)}
                placeholder="Approval notes or rejection reason."
                style={{ minHeight: 104 }}
                value={damageReviewNotes}
              />
            </label>

          </div>
        ) : null}
      </Modal>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SectionGrid className="admin-reports-summary-grid" columns={5} style={{ gap: 16, position: 'relative', zIndex: 1 }}>
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
          <MetricCard
            detail="Total paid lender banner-promotion fees received by the platform."
            icon={<span style={{ fontSize: 18, fontWeight: 700 }}>+</span>}
            label="Promotion Income"
            tone={theme.colors.teal}
            value={loading ? 'Loading...' : currencyFormatter.format(promotionIncome)}
          />
        </SectionGrid>

        <Panel style={{ marginTop: 0, padding: '8px 24px 24px', position: 'relative', zIndex: 0 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="form-grid admin-filter-toolbar admin-report-filter-toolbar" style={{ alignItems: 'end', display: 'grid', gap: 12 }}>
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

              <label style={{ display: 'grid', gap: 10 }}>
                <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Start date</span>
                <Input max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
              </label>

              <label style={{ display: 'grid', gap: 10 }}>
                <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>End date</span>
                <Input min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
              </label>

              <Badge style={{ alignSelf: 'center', justifySelf: 'flex-start', marginBottom: 2 }} tone="info">
                {loading ? 'Loading records' : `${filteredRecords.length} shown`}
              </Badge>
              <Button disabled={!filteredRecords.length} onClick={exportFilteredRecordsPdf} type="button" variant="secondary">
                Export PDF
              </Button>
            </div>

            {invalidDateRange ? <StatusMessage tone="warning">Start date must be on or before the end date.</StatusMessage> : null}
            {loading ? <DataLoadingScreen label="Loading reports" message="Loading reports and claims from the database." title="Getting report records" /> : null}
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
                      <th style={headerCellStyle}>Provider</th>
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
                          <span style={{ color: theme.colors.slate }}>System</span>
                        </td>
                        <td style={bodyCellStyle}>
                          <Badge tone={statusTone(record.status)}>{getVerificationStatusLabel(record.status)}</Badge>
                        </td>
                        <td style={bodyCellStyle}>
                          <span style={{ color: theme.colors.ink }}>{formatDate(record.date)}</span>
                        </td>
                        <td style={bodyCellStyle}>
                          <Button
                            onClick={() => setSelectedRecord(record)}
                            type="button"
                            variant="secondary"
                          >
                            View
                          </Button>
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
