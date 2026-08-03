-- ============================================================================
-- MIGRATION: Damage Claims and Account Restrictions System
-- ============================================================================
-- This migration adds comprehensive support for damage reporting, admin approval,
-- and temporary account restrictions (without freezing login).
--
-- Tables Added:
--   - report_evidences: Store multiple photos per damage report
--   - damage_claims: Damage-specific details with admin approval flow
--   - account_restrictions: Temporary restrictions that don't block login
--
-- Modified:
--   - payment_transactions: Add damage_claim_id column
--
-- Triggers:
--   - sync_damage_restriction_after_admin_review: Auto-freeze/unfreeze on status change
--
-- Helper Functions:
--   - user_has_active_damage_hold(): Check if user has active damage restriction
-- ============================================================================

-- ============================================================================
-- STEP 1: Create Enums for Damage Claims and Restrictions
-- ============================================================================

DO $$BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'damage_claim_status'
  ) THEN
    CREATE TYPE public.damage_claim_status AS ENUM (
      'pending_admin_review',
      'approved',
      'rejected',
      'awaiting_payment',
      'paid',
      'waived',
      'resolved'
    );
  END IF;
END $$;

DO $$BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'account_restriction_type'
  ) THEN
    CREATE TYPE public.account_restriction_type AS ENUM (
      'damage_hold'
    );
  END IF;
END $$;

DO $$BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'account_restriction_status'
  ) THEN
    CREATE TYPE public.account_restriction_status AS ENUM (
      'active',
      'lifted'
    );
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create report_evidences Table
-- ============================================================================
-- Stores multiple photos/evidence files per damage report
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_evidences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  evidence_url text NOT NULL,
  evidence_type text NOT NULL DEFAULT 'photo',
  uploaded_by uuid NOT NULL,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT report_evidences_pkey PRIMARY KEY (id),
  CONSTRAINT report_evidences_report_id_fkey
    FOREIGN KEY (report_id)
    REFERENCES public.reports(id)
    ON DELETE CASCADE,
  CONSTRAINT report_evidences_uploaded_by_fkey
    FOREIGN KEY (uploaded_by)
    REFERENCES public.profiles(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_evidences_report_id
  ON public.report_evidences(report_id);

CREATE INDEX IF NOT EXISTS idx_report_evidences_uploaded_by
  ON public.report_evidences(uploaded_by);

-- ============================================================================
-- STEP 3: Create damage_claims Table
-- ============================================================================
-- Damage-specific claims with admin approval workflow
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.damage_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL UNIQUE,
  booking_id uuid NOT NULL,
  item_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  borrower_id uuid NOT NULL,
  damage_description text NOT NULL,
  claimed_amount numeric NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
  admin_approved_amount numeric CHECK (admin_approved_amount IS NULL OR admin_approved_amount >= 0),
  deposit_applied_amount numeric NOT NULL DEFAULT 0 CHECK (deposit_applied_amount >= 0),
  amount_due numeric NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  status public.damage_claim_status NOT NULL DEFAULT 'pending_admin_review',
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  admin_notes text,
  resolved_by uuid,
  resolved_at timestamp with time zone,
  resolution_notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT damage_claims_pkey PRIMARY KEY (id),
  CONSTRAINT damage_claims_report_id_fkey
    FOREIGN KEY (report_id)
    REFERENCES public.reports(id)
    ON DELETE CASCADE,
  CONSTRAINT damage_claims_booking_id_fkey
    FOREIGN KEY (booking_id)
    REFERENCES public.bookings(id)
    ON DELETE CASCADE,
  CONSTRAINT damage_claims_item_id_fkey
    FOREIGN KEY (item_id)
    REFERENCES public.items(id)
    ON DELETE RESTRICT,
  CONSTRAINT damage_claims_owner_id_fkey
    FOREIGN KEY (owner_id)
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT damage_claims_borrower_id_fkey
    FOREIGN KEY (borrower_id)
    REFERENCES public.profiles(id)
    ON DELETE RESTRICT,
  CONSTRAINT damage_claims_reviewed_by_fkey
    FOREIGN KEY (reviewed_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL,
  CONSTRAINT damage_claims_resolved_by_fkey
    FOREIGN KEY (resolved_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL,
  CONSTRAINT damage_claims_owner_not_borrower_check
    CHECK (owner_id <> borrower_id)
);

CREATE INDEX IF NOT EXISTS idx_damage_claims_booking_id
  ON public.damage_claims(booking_id);

CREATE INDEX IF NOT EXISTS idx_damage_claims_borrower_id
  ON public.damage_claims(borrower_id);

CREATE INDEX IF NOT EXISTS idx_damage_claims_owner_id
  ON public.damage_claims(owner_id);

CREATE INDEX IF NOT EXISTS idx_damage_claims_status
  ON public.damage_claims(status);

CREATE INDEX IF NOT EXISTS idx_damage_claims_report_id
  ON public.damage_claims(report_id);

-- ============================================================================
-- STEP 4: Create account_restrictions Table
-- ============================================================================
-- Temporary restrictions that prevent renting/listing but allow login
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.account_restrictions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  restriction_type public.account_restriction_type NOT NULL DEFAULT 'damage_hold',
  related_damage_claim_id uuid UNIQUE,
  reason text NOT NULL,
  status public.account_restriction_status NOT NULL DEFAULT 'active',
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  lifted_at timestamp with time zone,
  lifted_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT account_restrictions_pkey PRIMARY KEY (id),
  CONSTRAINT account_restrictions_user_id_fkey
    FOREIGN KEY (user_id)
    REFERENCES public.profiles(id)
    ON DELETE CASCADE,
  CONSTRAINT account_restrictions_damage_claim_id_fkey
    FOREIGN KEY (related_damage_claim_id)
    REFERENCES public.damage_claims(id)
    ON DELETE CASCADE,
  CONSTRAINT account_restrictions_lifted_by_fkey
    FOREIGN KEY (lifted_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_restrictions_user_id
  ON public.account_restrictions(user_id);

CREATE INDEX IF NOT EXISTS idx_account_restrictions_status
  ON public.account_restrictions(status);

CREATE INDEX IF NOT EXISTS idx_account_restrictions_user_active
  ON public.account_restrictions(user_id, status);

-- ============================================================================
-- STEP 5: Modify payment_transactions Table
-- ============================================================================
-- Add damage_claim_id to support damage payment tracking
-- ============================================================================

ALTER TABLE public.payment_transactions
ADD COLUMN IF NOT EXISTS damage_claim_id uuid;

ALTER TABLE public.payment_transactions
ADD CONSTRAINT payment_transactions_damage_claim_id_fkey
  FOREIGN KEY (damage_claim_id)
  REFERENCES public.damage_claims(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_damage_claim_id
  ON public.payment_transactions(damage_claim_id);

-- ============================================================================
-- STEP 6: Create Trigger Function for Auto-Restriction Management
-- ============================================================================
-- Automatically creates/lifts account restrictions based on damage claim status
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_damage_restriction_after_admin_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Freeze account (create restriction) only after admin approves the damage claim
  IF NEW.status IN ('approved', 'awaiting_payment') THEN
    INSERT INTO public.account_restrictions (
      user_id,
      restriction_type,
      related_damage_claim_id,
      reason,
      status,
      started_at
    )
    VALUES (
      NEW.borrower_id,
      'damage_hold',
      NEW.id,
      'Account is restricted due to an admin-approved damage claim.',
      'active',
      now()
    )
    ON CONFLICT (related_damage_claim_id)
    DO UPDATE SET
      status = 'active',
      lifted_at = NULL,
      lifted_by = NULL,
      reason = EXCLUDED.reason,
      updated_at = now();

  -- Lift restriction when settled, waived, resolved, or rejected
  ELSIF NEW.status IN ('paid', 'waived', 'resolved', 'rejected') THEN
    UPDATE public.account_restrictions
    SET
      status = 'lifted',
      lifted_at = now(),
      lifted_by = COALESCE(NEW.resolved_by, NEW.reviewed_by),
      updated_at = now()
    WHERE related_damage_claim_id = NEW.id
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_damage_restriction_after_admin_review
  ON public.damage_claims;

CREATE TRIGGER trg_sync_damage_restriction_after_admin_review
AFTER INSERT OR UPDATE OF status
ON public.damage_claims
FOR EACH ROW
EXECUTE FUNCTION public.sync_damage_restriction_after_admin_review();

-- ============================================================================
-- STEP 7: Create Helper Function to Check Damage Restrictions
-- ============================================================================
-- Use this in the app to block renting/listing for restricted users
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_has_active_damage_hold(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_restrictions ar
    WHERE ar.user_id = p_user_id
      AND ar.restriction_type = 'damage_hold'
      AND ar.status = 'active'
      AND ar.lifted_at IS NULL
  );
$$;

-- ============================================================================
-- STEP 8: Create Helper Function to Get Active Restrictions
-- ============================================================================
-- Get all active restrictions for a user (useful for UI messages)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_active_restrictions(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  restriction_type public.account_restriction_type,
  reason text,
  started_at timestamp with time zone,
  related_damage_claim_id uuid
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ar.id,
    ar.restriction_type,
    ar.reason,
    ar.started_at,
    ar.related_damage_claim_id
  FROM public.account_restrictions ar
  WHERE ar.user_id = p_user_id
    AND ar.status = 'active'
    AND ar.lifted_at IS NULL
  ORDER BY ar.started_at DESC;
$$;

-- ============================================================================
-- STEP 9: Update timestamp on profile changes (if not already present)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_damage_claims_set_updated_at
  ON public.damage_claims;

CREATE TRIGGER trg_damage_claims_set_updated_at
BEFORE UPDATE
ON public.damage_claims
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_account_restrictions_set_updated_at
  ON public.account_restrictions;

CREATE TRIGGER trg_account_restrictions_set_updated_at
BEFORE UPDATE
ON public.account_restrictions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Migration Complete
-- ============================================================================
-- All tables, indexes, triggers, and helper functions are now in place.
-- The system is ready for:
--   1. Damage reporting with multiple photo evidence
--   2. Admin review and approval workflow
--   3. Automatic account restrictions based on approval
--   4. Payment transaction tracking for damage claims
--   5. Account restriction checks before allowing rent/list operations
-- ============================================================================
