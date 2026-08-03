// ============================================================================
// TRANSACTION FLOW DOCUMENTATION
// ============================================================================
// Complete transaction lifecycle for: add-ons, rent, buy item, damage/late fee
// reporting, and account restrictions
//
// All database operations should enforce the user_has_active_damage_hold()
// check before allowing rent or list operations.
// ============================================================================

// ============================================================================
// FLOW 1: RENTAL TRANSACTION (Rent Add-ons + Item Rental)
// ============================================================================

/*
  STEP 1: Borrower Browse Items
    - User sees item listings on the marketplace
    - If user has active damage_hold restriction:
        → Show warning: "Your account is restricted due to pending damage claim"
        → HIDE "Rent an Item" button
        → Block rent flow at the checkout

  STEP 2: Borrower Selects Add-ons
    - Borrower chooses optional add-ons (insurance, delivery, protection plan, etc.)
    - Each addon has:
      * addon_name
      * price
      * pricing_type (per_rental, per_day, per_quantity)
      * is_required (boolean)
    - App calculates total addon cost based on rental duration

  STEP 3: Borrower Selects Dates & Creates Booking
    - Borrower chooses rental start/end dates
    - System validates:
        a. Dates are within min_rental_days and max_rental_days
        b. Dates don't conflict with item_availability_blocks
        c. Borrower does NOT have active damage_hold (use user_has_active_damage_hold())
    - If check fails → Block booking
    - If check passes → Create booking record

  STEP 4: Calculate Rental Fees
    - rental_fee_total = rental_price_per_day * rental_days
    - addon_total = SUM(addon prices based on pricing_type)
    - total_due = rental_fee_total + addon_total + security_deposit

  STEP 5: Create Booking & Add-ons Records
    INSERT INTO bookings (
      item_id, borrower_id, owner_id,
      requested_start, requested_end,
      rental_days, rental_price_per_day, rental_fee_total,
      security_deposit, total_due,
      status
    ) VALUES (...) RETURNING id;

    INSERT INTO booking_addons (
      booking_id, item_addon_id,
      addon_name_snapshot, price_snapshot, pricing_type_snapshot,
      quantity, total_amount
    ) VALUES (...);

  STEP 6: Process Payment (PayMongo integration)
    - Create payment transaction
    - Record payment details (reference_number, proof_url, status)

  STEP 7: Owner Approval (if manual approval required)
    - Owner sees pending booking
    - Owner approves or rejects
    - If approved → booking.status = 'approved'
    - If rejected → booking.status = 'rejected'

  STEP 8: Booking Confirmed
    - booking.status = 'confirmed' or 'approved'
    - Notification sent to both parties
    - Meetup scheduled (pickup/delivery details)
*/

// ============================================================================
// FLOW 2: DAMAGE REPORTING & ADMIN APPROVAL
// ============================================================================

/*
  STEP 1: Item Returned & Owner Notices Damage
    - Booking ends: booking.status = 'returned'
    - Owner examines returned item
    - If damage found → Owner initiates damage report

  STEP 2: Owner Submits Damage Report
    INSERT INTO reports (
      booking_id,
      reporter_id,      -- Owner ID
      reported_user_id, -- Borrower ID
      report_type,      -- 'damage'
      description,      -- Description of damage
      status            -- 'open' (waiting for evidence)
    ) RETURNING id;

  STEP 3: Owner Uploads Photo Evidence
    - Owner uploads photos to Supabase Storage bucket: 'report-evidences'
    - Each photo returns a URL
    - For each photo:
        INSERT INTO report_evidences (
          report_id,
          evidence_url,
          evidence_type, -- 'photo'
          uploaded_by    -- Owner ID
        ) VALUES (...);

  STEP 4: Create Damage Claim
    INSERT INTO damage_claims (
      report_id,
      booking_id,
      item_id,
      owner_id,
      borrower_id,
      damage_description,
      claimed_amount,
      status -- 'pending_admin_review'
    ) RETURNING id;

    → Borrower is NOT frozen yet
    → Borrower can still log in and view their account

  STEP 5: Admin Reviews Evidence
    - Admin dashboard shows pending damage claims
    - Admin reviews uploaded photos
    - Admin decides: approve, reject, or request more evidence

  STEP 6A: Admin Approves Damage Claim
    UPDATE damage_claims
    SET
      status = 'approved',
      reviewed_by = 'ADMIN_ID',
      reviewed_at = now(),
      admin_approved_amount = 450.00,  -- May differ from claimed_amount
      amount_due = 450.00,
      admin_notes = 'Damage confirmed. Approved for 450 PHP.'
    WHERE id = 'DAMAGE_CLAIM_ID';

    → Trigger fires: sync_damage_restriction_after_admin_review()
    → INSERT INTO account_restrictions:
        - user_id = borrower_id
        - restriction_type = 'damage_hold'
        - status = 'active'
        - reason = "Admin-approved damage claim"

    → Borrower can still login BUT:
      - Cannot rent new items (blocked by user_has_active_damage_hold())
      - Cannot list new items
      - Can view the damage claim and pay

  STEP 6B: Admin Rejects Damage Claim
    UPDATE damage_claims
    SET
      status = 'rejected',
      reviewed_by = 'ADMIN_ID',
      reviewed_at = now(),
      admin_notes = 'Insufficient evidence.'
    WHERE id = 'DAMAGE_CLAIM_ID';

    → No account restriction created
    → Borrower not affected

  STEP 7: Borrower Views Damage Claim
    - App queries:
        SELECT * FROM damage_claims
        WHERE borrower_id = auth.user_id
        AND status IN ('approved', 'awaiting_payment', ...);
    - Display damage details, amount due, evidence photos
    - Show payment options

  STEP 8: Borrower Pays Damage Amount
    INSERT INTO payment_transactions (
      booking_id,
      damage_claim_id,
      payer_id,        -- Borrower ID
      payee_id,        -- Owner ID or Platform ID
      transaction_type, -- 'damage_payment'
      amount,
      payment_method,
      status,           -- 'pending' or 'paid'
      reference_number,
      proof_url,
      recorded_by
    ) RETURNS id;

  STEP 9: Admin Marks Claim as Paid/Resolved
    UPDATE damage_claims
    SET
      status = 'paid',  -- or 'waived' or 'resolved'
      resolved_by = 'ADMIN_ID',
      resolved_at = now(),
      resolution_notes = 'Damage payment verified.'
    WHERE id = 'DAMAGE_CLAIM_ID';

    → Trigger fires: sync_damage_restriction_after_admin_review()
    → UPDATE account_restrictions:
        - status = 'lifted'
        - lifted_at = now()
        - lifted_by = admin_id

    → Borrower can now rent and list items again
*/

// ============================================================================
// FLOW 3: LATE FEE REPORTING
// ============================================================================

/*
  STEP 1: Booking Marked as Returned (Due Date Passed)
    - Owner marks item as returned
    - System checks if return is late
    - If late:
        → Calculate late fee: feePerDay * daysLate
        → Owner shares: 70% of late fee
        → Admin/Platform shares: 30% of late fee

  STEP 2: Create Late Fee Payment Transaction
    INSERT INTO payment_transactions (
      booking_id,
      payer_id,         -- Borrower ID
      payee_id,         -- Owner ID (for owner share)
      transaction_type, -- 'late_fee_owner_share'
      amount,           -- Late fee amount
      payment_method,   -- 'late_fee' (system-generated)
      status,           -- 'pending'
      recorded_by       -- Admin or system
    );

    -- Platform share transaction
    INSERT INTO payment_transactions (
      booking_id,
      payer_id,         -- Borrower ID
      payee_id,         -- NULL or Platform ID
      transaction_type, -- 'late_fee_admin_share'
      amount,           -- Late fee amount
      payment_method,   -- 'late_fee'
      status,           -- 'pending'
      recorded_by       -- Admin or system
    );

  STEP 3: Borrower Pays Late Fee
    - Borrower sees late fee in booking details
    - Borrower pays the amount
    - Payment status updated to 'paid'

  STEP 4: Admin Marks Late Fee as Settled
    - Late fee transactions marked as 'completed'
    - Notification sent to owner
    - Booking moves to 'completed' status

  NOTE: Late fees do NOT create account restrictions
        (Only damage claims with admin approval do)
*/

// ============================================================================
// FLOW 4: BLOCKING RENT & LIST OPERATIONS
// ============================================================================

/*
  In the rent-item.js and my-bookings.js (add listing) components:

  BEFORE allowing user to proceed:
    const isDamageRestricted = await supabase.rpc(
      'user_has_active_damage_hold',
      { p_user_id: auth.user.id }
    );

    if (isDamageRestricted) {
      setError('Your account is restricted. Resolve pending damage claims to rent or list items.');
      // Show damage claim details and payment options
      return;
    }

    // Otherwise proceed with rent/listing flow

  OR use the helper function to get details:

    const restrictions = await supabase.rpc(
      'get_user_active_restrictions',
      { p_user_id: auth.user.id }
    );

    if (restrictions.length > 0) {
      // Display restriction reason and related damage claim
      console.log('Active restrictions:', restrictions);
    }
*/

// ============================================================================
// DATABASE QUERY PATTERNS
// ============================================================================

/*
  1. CHECK IF USER IS RESTRICTED
    SELECT public.user_has_active_damage_hold('USER_ID'::uuid);
    -- Returns true/false

  2. GET ALL DAMAGE CLAIMS FOR USER
    SELECT dc.*, dr.id as report_id, dr.status as report_status
    FROM damage_claims dc
    LEFT JOIN reports dr ON dc.report_id = dr.id
    WHERE dc.borrower_id = 'USER_ID'::uuid
    ORDER BY dc.created_at DESC;

  3. GET DAMAGE CLAIM EVIDENCE
    SELECT * FROM report_evidences
    WHERE report_id = 'REPORT_ID'::uuid
    ORDER BY uploaded_at;

  4. GET ALL ACTIVE RESTRICTIONS FOR USER
    SELECT * FROM public.get_user_active_restrictions('USER_ID'::uuid);

  5. GET BOOKING WITH ADD-ONS
    SELECT
      b.*,
      json_agg(
        json_build_object(
          'id', ba.id,
          'addon_name', ba.addon_name_snapshot,
          'price', ba.price_snapshot,
          'pricing_type', ba.pricing_type_snapshot,
          'quantity', ba.quantity,
          'total_amount', ba.total_amount
        )
      ) as addons
    FROM bookings b
    LEFT JOIN booking_addons ba ON b.id = ba.booking_id
    WHERE b.id = 'BOOKING_ID'::uuid
    GROUP BY b.id;

  6. GET PAYMENT TRANSACTIONS (including damage)
    SELECT * FROM payment_transactions
    WHERE booking_id = 'BOOKING_ID'::uuid
       OR damage_claim_id = 'DAMAGE_CLAIM_ID'::uuid
    ORDER BY transaction_at DESC;
*/

// ============================================================================
// ADMIN DASHBOARD QUERIES
// ============================================================================

/*
  PENDING DAMAGE CLAIMS FOR REVIEW
    SELECT
      dc.*,
      i.title as item_title,
      p_borrower.first_name || ' ' || p_borrower.last_name as borrower_name,
      p_owner.first_name || ' ' || p_owner.last_name as owner_name,
      COUNT(re.id) as evidence_count
    FROM damage_claims dc
    LEFT JOIN items i ON dc.item_id = i.id
    LEFT JOIN profiles p_borrower ON dc.borrower_id = p_borrower.id
    LEFT JOIN profiles p_owner ON dc.owner_id = p_owner.id
    LEFT JOIN report_evidences re ON dc.report_id = re.report_id
    WHERE dc.status = 'pending_admin_review'
    GROUP BY dc.id
    ORDER BY dc.created_at ASC;

  USERS WITH ACTIVE DAMAGE HOLDS
    SELECT DISTINCT
      ar.user_id,
      p.first_name,
      p.last_name,
      p.email,
      ar.reason,
      ar.started_at,
      dc.claimed_amount,
      dc.admin_approved_amount,
      dc.status
    FROM account_restrictions ar
    LEFT JOIN profiles p ON ar.user_id = p.id
    LEFT JOIN damage_claims dc ON ar.related_damage_claim_id = dc.id
    WHERE ar.status = 'active'
    AND ar.restriction_type = 'damage_hold'
    ORDER BY ar.started_at DESC;

  DAMAGE PAYMENT STATUS
    SELECT
      dc.id,
      dc.borrower_id,
      dc.owner_id,
      dc.claimed_amount,
      dc.admin_approved_amount,
      dc.amount_due,
      dc.status,
      COALESCE(pt.amount, 0) as paid_amount,
      COALESCE(pt.status, 'not_paid') as payment_status
    FROM damage_claims dc
    LEFT JOIN payment_transactions pt ON dc.id = pt.damage_claim_id
    WHERE dc.status IN ('awaiting_payment', 'paid', 'resolved')
    ORDER BY dc.created_at DESC;
*/

// ============================================================================
// FRONTEND INTEGRATION CHECKLIST
// ============================================================================

/*
  ✅ Login Flow:
     - User can log in even with damage_hold restriction
     - Show banner: "Your account has a pending damage claim"

  ✅ Rental Flow:
     - Check user_has_active_damage_hold() before showing "Rent" button
     - Block checkout if restricted

  ✅ Listing Flow:
     - Check user_has_active_damage_hold() before showing "List Item" button
     - Block form submission if restricted

  ✅ Dashboard:
     - Show damage claims widget
     - Link to view damage details and evidence
     - Link to payment if awaiting_payment

  ✅ Return Process:
     - Owner can upload damage photos after return
     - Owner can claim damage amount
     - System creates damage_claims record

  ✅ Admin Dashboard:
     - Show pending damage claims for review
     - Display uploaded evidence photos
     - Approve/reject with admin notes
     - Track payment status

  ✅ Restrictions:
     - Show reason for restriction
     - Link to related damage claim
     - Show lift date (if resolved)

  ✅ Payment Gateway:
     - Damage payments go through PayMongo
     - Record payment transaction
     - Admin confirms payment
     - Restriction automatically lifted
*/

// ============================================================================
// KEY RULES
// ============================================================================

/*
  1. Damage claims MUST have evidence photos before admin review
  2. Account restrictions are created ONLY after admin approves
  3. Borrower can login even with damage_hold restriction
  4. Borrower CANNOT rent or list items while restricted
  5. Restriction is lifted when damage is paid, waived, or resolved
  6. Late fees do NOT trigger restrictions
  7. Multiple damage claims on different bookings can coexist
  8. One active damage_hold per user at a time (per user_id)
*/

// ============================================================================
// SUPABASE STORAGE SETUP (Already Configured)
// ============================================================================

/*
  Bucket: report-evidences
  
  Policies in place:
  - Users can upload report evidence
  - Authenticated users can view report evidence
  - Users can update their own evidence
  - Users can delete their own evidence

  Upload path format: /[report-id]/[timestamp]-[filename].jpg
*/
