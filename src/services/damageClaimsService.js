// ============================================================================
// IMPLEMENTATION GUIDE: Using Damage Claims & Account Restrictions
// ============================================================================
// Code examples for frontend integration with the new damage claims system
// ============================================================================

// ============================================================================
// UTILITY FUNCTIONS - Add to a new file: src/services/damageClaimsService.js
// ============================================================================

import { supabase } from '../api/supabaseClient';

const REPORT_EVIDENCES_BUCKET = 'report-evidences';

export async function resolveReportEvidenceUrl(value) {
  if (!value || /^https?:\/\//i.test(value)) {
    return value || '';
  }

  const { data, error } = await supabase.storage
    .from(REPORT_EVIDENCES_BUCKET)
    .createSignedUrl(value, 60 * 60);

  if (error) {
    console.error('Error creating evidence signed URL:', error);
    return value;
  }

  return data?.signedUrl || value;
}

/**
 * Check if user has active damage hold restriction
 * @param {string} userId - User ID from auth
 * @returns {Promise<boolean>}
 */
export async function userHasActiveDamageHold(userId) {
  try {
    const { data, error } = await supabase.rpc(
      'user_has_active_damage_hold',
      { p_user_id: userId }
    );
    if (error) throw error;
    return data || false;
  } catch (err) {
    console.error('Error checking damage hold:', err);
    return false;
  }
}

/**
 * Get all active restrictions for a user
 * @param {string} userId - User ID from auth
 * @returns {Promise<Array>}
 */
export async function getUserActiveRestrictions(userId) {
  try {
    const { data, error } = await supabase.rpc(
      'get_user_active_restrictions',
      { p_user_id: userId }
    );
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error getting restrictions:', err);
    return [];
  }
}

/**
 * Get damage claims for a user (borrower)
 * @param {string} borrowerId - Borrower user ID
 * @returns {Promise<Array>}
 */
export async function getDamageClaimsForBorrower(borrowerId) {
  try {
    const { data, error } = await supabase
      .from('damage_claims')
      .select(`
        id,
        booking_id,
        item_id,
        damage_description,
        claimed_amount,
        admin_approved_amount,
        amount_due,
        status,
        reviewed_at,
        resolved_at,
        admin_notes,
        created_at,
        report_id
      `)
      .eq('borrower_id', borrowerId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('Error fetching damage claims:', err);
    return [];
  }
}

/**
 * Get damage claim details with evidence
 * @param {string} damageClaimId - Damage claim ID
 * @returns {Promise<Object>}
 */
export async function getDamageClaimWithEvidence(damageClaimId) {
  try {
    const { data: claim, error: claimError } = await supabase
      .from('damage_claims')
      .select('*')
      .eq('id', damageClaimId)
      .single();

    if (claimError) throw claimError;

    const { data: evidence, error: evidenceError } = await supabase
      .from('report_evidences')
      .select('*')
      .eq('report_id', claim.report_id)
      .order('uploaded_at', { ascending: true });

    if (evidenceError) throw evidenceError;

    const evidenceWithUrls = await Promise.all(
      (evidence || []).map(async (item) => ({
        ...item,
        display_url: await resolveReportEvidenceUrl(item.evidence_url),
      }))
    );

    return {
      ...claim,
      evidence: evidenceWithUrls,
    };
  } catch (err) {
    console.error('Error fetching damage claim with evidence:', err);
    return null;
  }
}

/**
 * Create a damage report (owner initiates)
 * @param {Object} reportData
 * @returns {Promise<string>} Report ID
 */
export async function createDamageReport(reportData) {
  const {
    bookingId,
    ownerId,
    borrowerId,
    description,
  } = reportData;

  try {
    const { data, error } = await supabase
      .from('reports')
      .insert([
        {
          booking_id: bookingId,
          reporter_id: ownerId,
          reported_user_id: borrowerId,
          report_type: 'damage',
          description,
          status: 'open',
        },
      ])
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  } catch (err) {
    console.error('Error creating damage report:', err);
    throw err;
  }
}

/**
 * Upload damage evidence photo to Supabase Storage
 * @param {string} reportId - Report ID
 * @param {File} file - Image file
 * @param {string} uploadedBy - User ID
 * @returns {Promise<Object>} { path, publicUrl }
 */
export async function uploadDamageEvidence(reportId, file, uploadedBy) {
  try {
    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${reportId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(REPORT_EVIDENCES_BUCKET)
      .upload(fileName, file);

    if (uploadError) throw uploadError;

    // Get public URL
    // Save evidence record to database
    const { data, error: dbError } = await supabase
      .from('report_evidences')
      .insert([
        {
          report_id: reportId,
          evidence_url: fileName,
          evidence_type: 'photo',
          uploaded_by: uploadedBy,
        },
      ])
      .select('id')
      .single();

    if (dbError) throw dbError;

    return {
      id: data.id,
      path: fileName,
      publicUrl: await resolveReportEvidenceUrl(fileName),
    };
  } catch (err) {
    console.error('Error uploading damage evidence:', err);
    throw err;
  }
}

/**
 * Create damage claim (after evidence is uploaded)
 * @param {Object} claimData
 * @returns {Promise<string>} Damage claim ID
 */
export async function createDamageClaim(claimData) {
  const {
    reportId,
    bookingId,
    itemId,
    ownerId,
    borrowerId,
    damageDescription,
    claimedAmount,
  } = claimData;

  try {
    const { data, error } = await supabase
      .from('damage_claims')
      .insert([
        {
          report_id: reportId,
          booking_id: bookingId,
          item_id: itemId,
          owner_id: ownerId,
          borrower_id: borrowerId,
          damage_description: damageDescription,
          claimed_amount: claimedAmount,
          status: 'pending_admin_review',
        },
      ])
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  } catch (err) {
    console.error('Error creating damage claim:', err);
    throw err;
  }
}

/**
 * Admin approves damage claim
 * @param {string} damageClaimId
 * @param {Object} approvalData
 * @returns {Promise<void>}
 */
export async function approveDamageClaim(damageClaimId, approvalData) {
  const {
    adminId,
    approvedAmount,
    notes = '',
  } = approvalData;

  try {
    const { error } = await supabase
      .from('damage_claims')
      .update({
        status: 'awaiting_payment',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        admin_approved_amount: approvedAmount,
        amount_due: approvedAmount,
        admin_notes: notes,
      })
      .eq('id', damageClaimId);

    if (error) throw error;

    // Trigger will automatically create account restriction
  } catch (err) {
    console.error('Error approving damage claim:', err);
    throw err;
  }
}

/**
 * Admin rejects damage claim
 * @param {string} damageClaimId
 * @param {Object} rejectionData
 * @returns {Promise<void>}
 */
export async function rejectDamageClaim(damageClaimId, rejectionData) {
  const {
    adminId,
    notes = '',
  } = rejectionData;

  try {
    const { error } = await supabase
      .from('damage_claims')
      .update({
        status: 'rejected',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        admin_notes: notes,
      })
      .eq('id', damageClaimId);

    if (error) throw error;
  } catch (err) {
    console.error('Error rejecting damage claim:', err);
    throw err;
  }
}

/**
 * Record damage payment
 * @param {Object} paymentData
 * @returns {Promise<string>} Payment transaction ID
 */
export async function recordDamagePayment(paymentData) {
  const {
    bookingId,
    damageClaimId,
    borrowerId,
    ownerId,
    amount,
    paymentMethod,
    referenceNumber,
    proofUrl,
    adminId,
  } = paymentData;

  try {
    const { data, error } = await supabase
      .from('payment_transactions')
      .insert([
        {
          booking_id: bookingId,
          damage_claim_id: damageClaimId,
          payer_id: borrowerId,
          payee_id: ownerId,
          transaction_type: 'damage_payment',
          amount,
          payment_method: paymentMethod,
          status: 'paid',
          reference_number: referenceNumber,
          proof_url: proofUrl,
          recorded_by: adminId,
          transaction_at: new Date().toISOString(),
        },
      ])
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  } catch (err) {
    console.error('Error recording damage payment:', err);
    throw err;
  }
}

/**
 * Mark damage claim as paid/resolved
 * @param {string} damageClaimId
 * @param {Object} resolutionData
 * @returns {Promise<void>}
 */
export async function resolveDamageClaim(damageClaimId, resolutionData) {
  const {
    adminId,
    status = 'paid', // 'paid', 'waived', or 'resolved'
    notes = '',
  } = resolutionData;

  try {
    const { error } = await supabase
      .from('damage_claims')
      .update({
        status,
        resolved_by: adminId,
        resolved_at: new Date().toISOString(),
        resolution_notes: notes,
      })
      .eq('id', damageClaimId);

    if (error) throw error;

    // Trigger will automatically lift account restriction
  } catch (err) {
    console.error('Error resolving damage claim:', err);
    throw err;
  }
}

// ============================================================================
// COMPONENT INTEGRATION EXAMPLES
// ============================================================================

/*
  1. RENT ITEM PROTECTION (src/pages/user/rent-item.js)
  
  import { userHasActiveDamageHold } from '../../services/damageClaimsService';

  useEffect(() => {
    async function checkRestrictions() {
      if (!user) return;
      const isRestricted = await userHasActiveDamageHold(user.id);
      if (isRestricted) {
        setError('Your account is restricted due to a pending damage claim. Resolve it before renting.');
        setCanProceed(false);
      }
    }
    checkRestrictions();
  }, [user]);

  if (!canProceed) {
    return (
      <StatusMessage tone="warning">
        {error}
        <Button onClick={() => navigate('/user/profile')} variant="secondary">
          View Damage Claims
        </Button>
      </StatusMessage>
    );
  }
*/

/*
  2. LIST ITEM PROTECTION (src/pages/user/MyBookings.js)
  
  import { userHasActiveDamageHold } from '../../services/damageClaimsService';

  async function handleCreateListing(event) {
    event.preventDefault();

    // Check damage restrictions
    const isRestricted = await userHasActiveDamageHold(userId);
    if (isRestricted) {
      setMessage('Cannot list items while damage claim is active. Resolve it first.');
      setMessageTone('warning');
      return;
    }

    // Proceed with listing creation
    // ... rest of listing logic
  }
*/

/*
  3. DAMAGE CLAIM WIDGET (src/pages/user/Profile.js)
  
  import { getDamageClaimsForBorrower } from '../../services/damageClaimsService';

  useEffect(() => {
    async function loadDamageStatus() {
      if (!user) return;
      const claims = await getDamageClaimsForBorrower(user.id);
      const activeClaims = claims.filter(c => 
        ['pending_admin_review', 'approved', 'awaiting_payment'].includes(c.status)
      );
      setActiveDamageCount(activeClaims.length);
    }
    loadDamageStatus();
  }, [user]);

  if (activeDamageCount > 0) {
    return (
      <Card tone="warning">
        <h3>Pending Damage Claims: {activeDamageCount}</h3>
        <p>Your account is restricted. Resolve claims to rent or list items.</p>
        <Button onClick={() => navigate('/damage-claims')}>
          View Claims & Pay
        </Button>
      </Card>
    );
  }
*/

/*
  4. ADMIN DAMAGE REVIEW (src/pages/admin/ManageDamage.js)
  
  import {
    approveDamageClaim,
    rejectDamageClaim,
    getDamageClaimWithEvidence,
  } from '../../services/damageClaimsService';

  async function loadPendingClaims() {
    const { data, error } = await supabase
      .from('damage_claims')
      .select(`
        id,
        borrower_id,
        owner_id,
        damage_description,
        claimed_amount,
        created_at
      `)
      .eq('status', 'pending_admin_review')
      .order('created_at', { ascending: true });

    if (!error) setPendingClaims(data);
  }

  async function handleApprove(claimId, approvedAmount) {
    const { data: user } = await supabase.auth.getUser();
    await approveDamageClaim(claimId, {
      adminId: user.user.id,
      approvedAmount,
      notes: adminNotes,
    });
    // Refresh list
    await loadPendingClaims();
  }

  async function handleReject(claimId) {
    const { data: user } = await supabase.auth.getUser();
    await rejectDamageClaim(claimId, {
      adminId: user.user.id,
      notes: rejectionNotes,
    });
    // Refresh list
    await loadPendingClaims();
  }
*/

const damageClaimsService = {
  userHasActiveDamageHold,
  getUserActiveRestrictions,
  getDamageClaimsForBorrower,
  getDamageClaimWithEvidence,
  createDamageReport,
  uploadDamageEvidence,
  createDamageClaim,
  approveDamageClaim,
  rejectDamageClaim,
  recordDamagePayment,
  resolveDamageClaim,
  resolveReportEvidenceUrl,
};

export default damageClaimsService;
