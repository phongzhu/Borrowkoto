import { supabase } from '../api/supabaseClient';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LATE_FEE_TRANSACTION_TYPES = ['late_fee_owner_share', 'late_fee_admin_share'];
const SETTLED_PAYMENT_STATUSES = new Set(['recorded', 'paid', 'completed', 'settled']);
const PAYABLE_DAMAGE_STATUSES = ['approved', 'awaiting_payment'];
const OVERDUE_BOOKING_STATUSES = ['accepted', 'for_pickup', 'active', 'overdue'];

function toMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
}

function bookingEnd(booking) {
  const value = booking?.approved_end || booking?.requested_end;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function calculateLiveLateFee(booking, now = new Date()) {
  const end = bookingEnd(booking);
  if (!end || end >= now) {
    return 0;
  }

  const daysLate = Math.max(1, Math.ceil((now.getTime() - end.getTime()) / DAY_IN_MS));
  return toMoney(daysLate * Number(booking?.rental_price_per_day || 0));
}

export async function userHasUnsettledDues(userId) {
  if (!userId) {
    return false;
  }

  const { data, error } = await supabase.rpc('user_has_unsettled_dues', { p_user_id: userId });
  if (error) {
    console.error('Unable to check unsettled account dues:', error);
    return false;
  }

  return Boolean(data);
}

export async function getUserUnsettledDues(userId) {
  const emptySummary = {
    damageCount: 0,
    damageTotal: 0,
    depositAppliedTotal: 0,
    hasDues: false,
    lateFeeCount: 0,
    lateFeeGrossTotal: 0,
    lateFeeTotal: 0,
    totalDue: 0,
  };

  if (!userId) {
    return emptySummary;
  }

  const [rpcResult, bookingsResult, transactionsResult, damageResult] = await Promise.all([
    supabase.rpc('user_has_unsettled_dues', { p_user_id: userId }),
    supabase
      .from('bookings')
      .select('id, approved_end, requested_end, rental_price_per_day, security_deposit, status')
      .eq('borrower_id', userId)
      .in('status', OVERDUE_BOOKING_STATUSES),
    supabase
      .from('payment_transactions')
      .select('id, booking_id, amount, status, transaction_type')
      .eq('payer_id', userId)
      .in('transaction_type', LATE_FEE_TRANSACTION_TYPES),
    supabase
      .from('damage_claims')
      .select('id, amount_due, admin_approved_amount, claimed_amount, status')
      .eq('borrower_id', userId)
      .in('status', PAYABLE_DAMAGE_STATUSES),
  ]);

  const now = new Date();
  const overdueBookings = (bookingsResult.data || []).filter((booking) => {
    const end = bookingEnd(booking);
    return end && end < now;
  });
  const pendingTransactions = (transactionsResult.data || []).filter(
    (transaction) => !SETTLED_PAYMENT_STATUSES.has(String(transaction.status || '').toLowerCase())
  );
  const pendingTransactionsByBooking = new Map();

  pendingTransactions.forEach((transaction) => {
    const bookingId = transaction.booking_id || '';
    pendingTransactionsByBooking.set(
      bookingId,
      toMoney((pendingTransactionsByBooking.get(bookingId) || 0) + Number(transaction.amount || 0))
    );
  });

  const overdueBookingIds = new Set(overdueBookings.map((booking) => booking.id));
  let lateFeeGrossTotal = 0;
  let depositAppliedTotal = 0;
  const lateFeeTotalFromBookings = overdueBookings.reduce((total, booking) => {
    const grossLateFee = calculateLiveLateFee(booking, now);
    const depositApplied = Math.min(grossLateFee, Math.max(0, Number(booking.security_deposit || 0)));
    const remainingLateFee = toMoney(Math.max(0, grossLateFee - depositApplied));
    const recordedPendingAmount = pendingTransactionsByBooking.get(booking.id);
    lateFeeGrossTotal += grossLateFee;
    depositAppliedTotal += depositApplied;
    return total + Math.max(recordedPendingAmount || 0, remainingLateFee);
  }, 0);
  const orphanedPendingLateFees = Array.from(pendingTransactionsByBooking.entries()).reduce(
    (total, [bookingId, amount]) => total + (overdueBookingIds.has(bookingId) ? 0 : amount),
    0
  );
  const lateFeeTotal = toMoney(lateFeeTotalFromBookings + orphanedPendingLateFees);
  lateFeeGrossTotal = toMoney(lateFeeGrossTotal);
  depositAppliedTotal = toMoney(depositAppliedTotal);
  const damageClaims = damageResult.data || [];
  const damageTotal = toMoney(
    damageClaims.reduce(
      (total, claim) => total + Math.max(
        Number(claim.amount_due || 0),
        Number(claim.admin_approved_amount || 0),
        Number(claim.claimed_amount || 0)
      ),
      0
    )
  );
  const totalDue = toMoney(lateFeeTotal + damageTotal);

  if (bookingsResult.error) console.error('Unable to load overdue bookings:', bookingsResult.error);
  if (transactionsResult.error) console.error('Unable to load pending late fees:', transactionsResult.error);
  if (damageResult.error) console.error('Unable to load damage balances:', damageResult.error);
  if (rpcResult.error) console.error('Unable to load account freeze status:', rpcResult.error);

  return {
    damageCount: damageClaims.length,
    damageTotal,
    depositAppliedTotal,
    hasDues: Boolean(rpcResult.data) || lateFeeTotal > 0 || damageTotal > 0,
    lateFeeCount: new Set([
      ...overdueBookings.map((booking) => booking.id),
      ...pendingTransactions.map((transaction) => transaction.booking_id).filter(Boolean),
    ]).size,
    lateFeeGrossTotal,
    lateFeeTotal,
    totalDue,
  };
}

export { SETTLED_PAYMENT_STATUSES };
