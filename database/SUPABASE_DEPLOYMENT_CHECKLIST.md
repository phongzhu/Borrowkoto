// ============================================================================
// SUPABASE DEPLOYMENT CHECKLIST
// ============================================================================
// Follow these steps in order to deploy the damage claims system
// ============================================================================

// ============================================================================
// STEP 1: EXECUTE DATABASE MIGRATION
// ============================================================================

/*
  1. Go to: https://app.supabase.com → Select your project
  2. Navigate to: SQL Editor (left sidebar)
  3. Click "New Query"
  4. Copy the entire contents of migration_damage_claims_and_restrictions.sql
  5. Paste into the SQL editor
  6. Click "Run"
  7. Verify all 8 steps completed without errors
  8. Check Tables panel: you should now see:
     - damage_claims
     - account_restrictions
     - report_evidences
     (payment_transactions modified with new damage_claim_id column)

  Expected Output:
  ✓ Step 1/8: Create enums for damage_claim_status, account_restriction_type, account_restriction_status
  ✓ Step 2/8: Create report_evidences table
  ✓ Step 3/8: Create damage_claims table
  ✓ Step 4/8: Create account_restrictions table
  ✓ Step 5/8: Add damage_claim_id column to payment_transactions
  ✓ Step 6/8: Create trigger function sync_damage_restriction_after_admin_review
  ✓ Step 7/8: Create helper functions
  ✓ Step 8/8: Create timestamp update triggers
*/

// ============================================================================
// STEP 2: VERIFY STORAGE BUCKET & POLICIES
// ============================================================================

/*
  1. Go to: https://app.supabase.com → Storage (left sidebar)
  2. Verify bucket named "report-evidences" exists
     If not, create it:
     - Click "New Bucket"
     - Name: "report-evidences"
     - Make it: Public (requires RLS policies for auth)
     - Click "Create Bucket"

  3. Configure Policies for report-evidences bucket:
     
     POLICY 1: Users can upload their own evidence
     - Click on bucket → Policies
     - "New Policy" → "For insert"
     - Template: "Enable insert for authenticated users"
     - Configure as:
       Target: authenticated users
       Allow: All
       Description: "Allow authenticated users to upload evidence"

     POLICY 2: Authenticated can select (view evidence)
     - "New Policy" → "For select"
     - Template: "Enable select for authenticated users"
     - Configure as:
       Target: authenticated users
       Allow: All
       Description: "Allow authenticated users to view evidence"

     POLICY 3: Users can update their own files
     - "New Policy" → "For update"
     - Template: "Enable update for users based on user_id"
     - Configure as:
       (authenticated.user_id = (storage.foldername (name))::uuid)
     - Description: "Allow users to update own files"

     POLICY 4: Users can delete their own files
     - "New Policy" → "For delete"
     - Template: "Enable delete for users based on user_id"
     - Configure as:
       (authenticated.user_id = (storage.foldername (name))::uuid)
     - Description: "Allow users to delete own files"

  4. Verify policies are enabled (toggle on)
*/

// ============================================================================
// STEP 3: TEST DATABASE FUNCTIONS
// ============================================================================

/*
  Run in SQL Editor to verify functions work:

  -- Test 1: Check if user has damage hold
  SELECT public.user_has_active_damage_hold('PASTE_A_USER_UUID_HERE'::uuid);
  Result: Returns false if no damage hold, true if has active restriction

  -- Test 2: Get user restrictions
  SELECT * FROM public.get_user_active_restrictions('PASTE_A_USER_UUID_HERE'::uuid);
  Result: Returns empty array if no restrictions, array of restrictions if active

  -- Test 3: Verify trigger exists
  SELECT * FROM pg_trigger WHERE tgname = 'trigger_sync_damage_restriction_after_admin_review';
  Result: Should return one row

  -- Test 4: Verify timestamp triggers
  SELECT * FROM pg_trigger WHERE tgname LIKE 'trigger_update_damage_claims_%';
  Result: Should return trigger rows
*/

// ============================================================================
// STEP 4: CONFIGURE ROW-LEVEL SECURITY (RLS) FOR NEW TABLES
// ============================================================================

/*
  1. Go to: Authentication → Policies (left sidebar)

  2. For damage_claims table:
     - Click "New Policy" for "SELECT"
     - Template: "Enable read access for one row"
     - Condition: (user_id = auth.uid()) OR (auth.jwt() -> 'user_metadata' -> 'role' = '"admin"')
     - Description: "Allow borrower/owner/admin to view damage claims"
     
     - Click "New Policy" for "UPDATE"
     - Condition: (auth.jwt() -> 'user_metadata' -> 'role' = '"admin"')
     - Description: "Allow admin to update damage claims"

  3. For report_evidences table:
     - Click "New Policy" for "SELECT"
     - Template: "Enable read access for all"
     - Description: "Allow all authenticated users to view evidence"
     
     - Click "New Policy" for "INSERT"
     - Condition: (auth.uid() = uploaded_by)
     - Description: "Allow users to upload own evidence"

  4. For account_restrictions table:
     - Click "New Policy" for "SELECT"
     - Condition: (user_id = auth.uid()) OR (auth.jwt() -> 'user_metadata' -> 'role' = '"admin"')
     - Description: "Allow user/admin to view restrictions"
     
     - Click "New Policy" for "UPDATE"
     - Condition: (auth.jwt() -> 'user_metadata' -> 'role' = '"admin"')
     - Description: "Allow admin to update restrictions"

  5. For payment_transactions (existing table, add new policy):
     - Click "New Policy" for "INSERT"
     - Condition: (payer_id = auth.uid()) OR (auth.jwt() -> 'user_metadata' -> 'role' = '"admin"')
     - Description: "Allow payer or admin to record damage payments"
*/

// ============================================================================
// STEP 5: UPDATE ADMIN ROLE IN DATABASE
// ============================================================================

/*
  Ensure admin users have role='admin' in profiles table:

  UPDATE profiles
  SET role = 'admin'
  WHERE email = 'admin@example.com';

  Verify:
  SELECT id, email, role FROM profiles WHERE role = 'admin';
*/

// ============================================================================
// STEP 6: INSTALL FRONTEND SERVICE FILE
// ============================================================================

/*
  1. Create new file: src/services/damageClaimsService.js
     (Already created in previous step - damageClaimsService.js)

  2. Verify it includes all these functions:
     ✓ userHasActiveDamageHold()
     ✓ getUserActiveRestrictions()
     ✓ getDamageClaimsForBorrower()
     ✓ getDamageClaimWithEvidence()
     ✓ createDamageReport()
     ✓ uploadDamageEvidence()
     ✓ createDamageClaim()
     ✓ approveDamageClaim()
     ✓ rejectDamageClaim()
     ✓ recordDamagePayment()
     ✓ resolveDamageClaim()

  3. Test import:
     npm run build
     Check for any import errors
*/

// ============================================================================
// STEP 7: INTEGRATE CHECKS IN EXISTING COMPONENTS
// ============================================================================

/*
  A. UPDATE src/pages/user/rent-item.js
     Add before proceeding with booking:

     import { userHasActiveDamageHold } from '../../services/damageClaimsService';

     // In component, before handleCheckout:
     const [isRestricted, setIsRestricted] = useState(false);

     useEffect(() => {
       async function checkDamageHold() {
         if (!user) return;
         const hasDamageHold = await userHasActiveDamageHold(user.id);
         setIsRestricted(hasDamageHold);
       }
       checkDamageHold();
     }, [user]);

     // In return JSX, before rental form:
     if (isRestricted) {
       return (
         <Panel style={{ backgroundColor: theme.colors.status.warning }}>
           <h2>Account Restricted</h2>
           <p>You cannot rent items while a damage claim is pending.</p>
           <Button onClick={() => navigate('/damage-claims')}>
             View Damage Claims
           </Button>
         </Panel>
       );
     }

  B. UPDATE src/pages/user/MyBookings.js
     Add before handleAddListing:

     import { userHasActiveDamageHold } from '../../services/damageClaimsService';

     // In handleAddListing, first check:
     const isRestricted = await userHasActiveDamageHold(userId);
     if (isRestricted) {
       setError('Cannot list items while damage claim is active.');
       return;
     }
     // Continue with listing creation...

  C. UPDATE src/pages/user/UserDashboard.js
     Add damage claims widget:

     import { getDamageClaimsForBorrower } from '../../services/damageClaimsService';

     useEffect(() => {
       async function loadDamageStatus() {
         const claims = await getDamageClaimsForBorrower(userId);
         const activeClaims = claims.filter(c =>
           ['pending_admin_review', 'approved', 'awaiting_payment'].includes(c.status)
         );
         if (activeClaims.length > 0) {
           setShowDamageAlert(true);
           setDamageClaimsCount(activeClaims.length);
         }
       }
       loadDamageStatus();
     }, [userId]);

     // In JSX:
     {showDamageAlert && (
       <Card style={{ borderLeft: `4px solid ${theme.colors.status.warning}` }}>
         <h3>{damageClaimsCount} Active Damage Claim(s)</h3>
         <p>Your account has restrictions. Resolve to rent/list items.</p>
         <Button onClick={() => navigate('/damage-claims')}>
           View & Pay
         </Button>
       </Card>
     )}

  D. CREATE NEW src/pages/user/DamageClaimsPage.js
     This page shows:
     - List of all damage claims (pending, approved, paid, rejected)
     - Evidence photos for each claim
     - Payment status and links
     - Current restriction status if any

  E. CREATE NEW src/pages/admin/DamageReviewDashboard.js
     This page shows:
     - Pending damage claims for admin review
     - Evidence photos gallery
     - Approve/Reject buttons with reason fields
     - Damage payment tracking
     - User restriction status
*/

// ============================================================================
// STEP 8: TEST THE COMPLETE FLOW (LOCAL)
// ============================================================================

/*
  1. Start dev server:
     npm start

  2. Test Restriction Check:
     - Go to browser console
     - const { userHasActiveDamageHold } = await import('./services/damageClaimsService.js')
     - userHasActiveDamageHold('test-user-uuid')
     - Should return Promise<boolean>

  3. Test Query (in SQL Editor):
     SELECT * FROM damage_claims LIMIT 1;
     SELECT * FROM account_restrictions LIMIT 1;
     SELECT * FROM report_evidences LIMIT 1;
     All should return empty arrays (no data yet)

  4. Test Storage:
     - Go to Storage tab
     - Verify report-evidences bucket exists
     - Policies enabled

  5. Test RLS:
     - Create test damage claim in SQL with test user ID
     - Log in as test user
     - Verify can see own damage claims
     - Verify cannot see other user's claims
*/

// ============================================================================
// STEP 9: DEPLOY TO PRODUCTION
// ============================================================================

/*
  Prerequisites:
  ✓ Migration executed and verified
  ✓ Storage bucket configured
  ✓ RLS policies set
  ✓ Frontend components integrated
  ✓ damageClaimsService.js in place
  ✓ Tests passed locally

  Deployment:
  1. Merge PR with updated files to main branch
  2. Deploy to production:
     npm run build
     Deploy build/ folder to hosting (same as before)

  3. Monitor:
     - Check browser console for errors
     - Test user cannot rent while restricted
     - Test admin can approve claims
     - Test damage payments work

  Post-Deployment:
  1. Verify migration in production Supabase
  2. Test flow with real account
  3. Monitor error logs for 24 hours
*/

// ============================================================================
// STEP 10: ADMIN OPERATIONS MANUAL
// ============================================================================

/*
  FOR ADMINS: Review Pending Damage Claims

  1. Navigate to Admin Dashboard
  2. Click "Damage Claims" (or equivalent menu item)
  3. View "Pending Review" tab
  4. For each claim:
     - Review damage description
     - View evidence photos (click thumbnail to enlarge)
     - Make decision:

     Option A: APPROVE
     - Enter approved damage amount (may differ from claimed)
     - Add admin notes (if any)
     - Click "Approve"
     - System automatically:
       * Sets status to 'awaiting_payment'
       * Creates account_restrictions entry
       * Borrower is notified
       * Borrower cannot rent/list until resolved

     Option B: REJECT
     - Add rejection reason in notes
     - Click "Reject"
     - System automatically:
       * Sets status to 'rejected'
       * No restrictions created
       * Owner is notified

  5. Monitor Payments
     - Go to "Damage Payments" tab
     - Shows all awaiting_payment claims
     - Verify payment received
     - Click "Mark as Paid" when verified
     - System automatically:
       * Sets status to 'paid'
       * Lifts account restrictions
       * Borrower is notified

  6. Resolve Claims
     - After payment confirmed or decision made
     - Click "Resolve"
     - Enter resolution notes
     - Status changes to 'resolved'
     - Restrictions lifted
*/

// ============================================================================
// TROUBLESHOOTING
// ============================================================================

/*
  ISSUE: "user_has_active_damage_hold is not a function"
  SOLUTION:
  - Verify migration executed successfully
  - Check SQL Editor for any error messages
  - Re-run the migration
  - Refresh browser page

  ISSUE: Can't upload evidence photos
  SOLUTION:
  - Check report-evidences bucket exists in Storage
  - Verify RLS policies enabled
  - Check browser console for storage errors
  - Verify user is authenticated

  ISSUE: Admin can't approve damage claims
  SOLUTION:
  - Verify user has role='admin' in profiles table
  - Check RLS policies for damage_claims table
  - Verify admin user is signed in
  - Check browser console for permission errors

  ISSUE: Account restrictions not being applied
  SOLUTION:
  - Verify trigger function exists:
    SELECT * FROM pg_trigger WHERE tgname LIKE '%sync_damage%';
  - Check damage_claims status is 'awaiting_payment' or 'approved'
  - Verify account_restrictions table has entries
  - Check the timestamp the trigger should have fired

  ISSUE: Borrower can still rent while restricted
  SOLUTION:
  - Verify userHasActiveDamageHold() is called in rent-item.js
  - Check that user_has_active_damage_hold() returns true
  - Verify the UI blocking code is present
  - Check browser console for any errors

  ISSUE: Storage files not accessible
  SOLUTION:
  - Check storage policy rules
  - Verify uploaded_by matches authenticated user
  - Check file permissions in bucket settings
  - Try deleting and re-uploading file
*/

// ============================================================================
// FILE CHECKLIST FOR DEPLOYMENT
// ============================================================================

/*
  Required Files Created:
  ✓ database/migration_damage_claims_and_restrictions.sql
  ✓ database/TRANSACTION_FLOW_DOCUMENTATION.md
  ✓ src/services/damageClaimsService.js
  ✓ database/SUPABASE_DEPLOYMENT_CHECKLIST.md (this file)

  Files to Update:
  ✓ src/pages/user/rent-item.js (add damage hold check)
  ✓ src/pages/user/MyBookings.js (add damage hold check)
  ✓ src/pages/user/UserDashboard.js (add damage widget)

  Files to Create:
  ✓ src/pages/user/DamageClaimsPage.js (borrower view)
  ✓ src/pages/admin/DamageReviewDashboard.js (admin review)

  Supabase Configuration:
  ✓ Execute migration SQL
  ✓ Set up storage bucket policies
  ✓ Configure RLS policies for new tables
  ✓ Verify admin roles set
*/

export const deploymentChecklist = {
  step1_migration: false,
  step2_storage: false,
  step3_functions: false,
  step4_rls: false,
  step5_admin_role: false,
  step6_frontend_service: false,
  step7_component_integration: false,
  step8_local_tests: false,
  step9_production_deploy: false,
  step10_admin_trained: false,
};
