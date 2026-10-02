import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { Badge, Button, FormField, Input, Panel, StatusMessage } from '../../ui/primitives';
import AdminShell from './AdminShell';
import './ManageWithdrawals.css';

const currency = new Intl.NumberFormat('en-PH', { currency: 'PHP', style: 'currency' });
const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

function maskAccount(value) {
  const digits = String(value || '').replace(/\s/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : '—';
}

function nameFor(profile) {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  return fullName || profile?.username || 'Owner';
}

function statusTone(status) {
  if (status === 'paid') return 'success';
  if (status === 'failed' || status === 'rejected') return 'danger';
  if (status === 'processing') return 'info';
  return 'warning';
}

async function getFunctionErrorMessage(error, data) {
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const payload = await error.context.json();
      if (payload?.error) return payload.error;
    } catch {
      // Use the function client's message below when there is no JSON response.
    }
  }
  return error?.message || 'Unable to process this withdrawal.';
}

export default function ManageWithdrawals() {
  const [adminId, setAdminId] = useState('');
  const [withdrawals, setWithdrawals] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [commissionIncome, setCommissionIncome] = useState(0);
  const [adminBalance, setAdminBalance] = useState({ available: 0, gross_earned: 0, paid_out: 0, reserved: 0 });
  const [incomeBreakdown, setIncomeBreakdown] = useState({ damaged_item_share: 0, late_fee_share: 0, product_commission: 0, promotion_income: 0, rental_commission: 0 });
  const [activeTab, setActiveTab] = useState('earnings');
  const [payoutForm, setPayoutForm] = useState({ amount: '', accountName: '', accountNumber: '' });
  const [payoutAmountError, setPayoutAmountError] = useState('');
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async (id) => {
    const [withdrawalsResult, balanceResult, breakdownResult, promotionPaymentsResult] = await Promise.all([
      supabase.from('earnings_withdrawals').select('*').order('created_at', { ascending: false }).limit(250),
      supabase.rpc('get_admin_platform_withdrawal_balance'),
      supabase.rpc('get_admin_platform_withdrawal_breakdown'),
      supabase.from('promotion_payments').select('amount').eq('status', 'paid'),
    ]);
    if (withdrawalsResult.error || balanceResult.error || breakdownResult.error || promotionPaymentsResult.error) {
      throw new Error(withdrawalsResult.error?.message || balanceResult.error?.message || breakdownResult.error?.message || promotionPaymentsResult.error?.message || 'Unable to load payout records.');
    }
    const rows = withdrawalsResult.data || [];
    setWithdrawals(rows);
    const earnings = balanceResult.data?.[0] || { available: 0, gross_earned: 0, paid_out: 0, reserved: 0 };
    setAdminBalance(earnings);
    const promotionTotal = (promotionPaymentsResult.data || []).reduce((total, payment) => total + (Number(payment.amount) || 0), 0);
    const breakdown = breakdownResult.data?.[0] || { damaged_item_share: 0, late_fee_share: 0, product_commission: 0, promotion_income: 0, rental_commission: 0 };
    const promotionIncludedInBalance = Number(breakdown.promotion_income) || 0;
    setCommissionIncome(Math.max(0, (Number(earnings.gross_earned) || 0) - promotionIncludedInBalance) + promotionTotal);
    const availableToRequest = Math.min(50000, Number(earnings.available) || 0);
    setPayoutForm((current) => current.amount || availableToRequest < 100
      ? current
      : { ...current, amount: availableToRequest.toFixed(2) });
    setIncomeBreakdown({ ...breakdown, promotion_income: promotionTotal });
    const ownerIds = Array.from(new Set(rows.map((row) => row.owner_id).filter((ownerId) => ownerId && ownerId !== id)));
    if (ownerIds.length) {
      const { data, error: profileError } = await supabase.from('profiles').select('id,username,first_name,last_name').in('id', ownerIds);
      if (profileError) throw profileError;
      setProfiles(Object.fromEntries((data || []).map((profile) => [profile.id, profile])));
    } else {
      setProfiles({});
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.id) {
      setError(authError?.message || 'Sign in as an admin to review withdrawal requests.');
      setLoading(false);
      return;
    }
    setAdminId(user.id);
    try {
      await loadData(user.id);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load withdrawal data.');
    }
    setLoading(false);
  }, [loadData]);

  useEffect(() => { refresh(); }, [refresh]);

  const lenderWithdrawals = useMemo(() => withdrawals.filter((row) => row.owner_id !== adminId), [adminId, withdrawals]);
  const lenderSummary = useMemo(() => lenderWithdrawals.reduce((result, row) => {
    const amount = Number(row.amount) || 0;
    if (row.status === 'requested') result.requested += amount;
    if (row.status === 'processing') result.processing += amount;
    if (row.status === 'paid') result.paid += amount;
    return result;
  }, { paid: 0, processing: 0, requested: 0 }), [lenderWithdrawals]);
  const adminWithdrawals = useMemo(() => withdrawals.filter((row) => row.owner_id === adminId), [adminId, withdrawals]);
  const adminAmountLimit = Math.min(50000, Number(adminBalance.available) || 0);

  function validateAdminAmount(value) {
    const amount = Number(value);
    if (!value || !Number.isFinite(amount)) return 'Enter an amount to withdraw.';
    if (amount < 100) return 'The minimum withdrawal is PHP 100.00.';
    if (amount > 50000) return 'The maximum withdrawal is PHP 50,000.00.';
    if (amount > Number(adminBalance.available)) return `You can withdraw up to ${currency.format(Number(adminBalance.available) || 0)}.`;
    return '';
  }

  async function submitAdminPayout(event) {
    event.preventDefault();
    const validationError = validateAdminAmount(payoutForm.amount);
    if (validationError) {
      setPayoutAmountError(validationError);
      return;
    }
    setSubmittingPayout(true);
    setError('');
    setNotice('');
    const { error: payoutError } = await supabase.rpc('request_admin_platform_withdrawal', {
      p_amount: Number(payoutForm.amount),
      p_destination_account_name: payoutForm.accountName.trim(),
      p_destination_account_number: payoutForm.accountNumber.replace(/[\s-]/g, ''),
    });
    if (payoutError) {
      setError(payoutError.message || 'Unable to submit the platform earnings withdrawal.');
      setSubmittingPayout(false);
      return;
    }
    setPayoutForm({ amount: '', accountName: '', accountNumber: '' });
    setPayoutAmountError('');
    setNotice('Platform earnings withdrawal requested.');
    setActiveTab('history');
    try { await loadData(adminId); } catch (loadError) { setError(loadError.message || 'Your request was submitted, but the page could not refresh.'); }
    setSubmittingPayout(false);
  }

  async function handleTransferAction(action, row) {
    setBusyId(row.id);
    setError('');
    setNotice('');
    const { data, error: functionError } = await supabase.functions.invoke('earnings-payout', {
      body: { action, withdrawal_id: row.id },
    });
    if (functionError || data?.error) {
      setError(await getFunctionErrorMessage(functionError, data));
      setBusyId('');
      return;
    }
    setNotice(action === 'refresh'
      ? `PayMongo transfer status updated to ${data.status}.`
      : `Payout transfer started with status ${data.status}.`);
    try { await loadData(adminId); } catch (loadError) { setError(loadError.message); }
    setBusyId('');
  }

  if (loading) {
    return (
      <AdminShell subtitle="" title="">
        <DataLoadingScreen label="Loading withdrawals" message="Loading payout history and account balances from the database." title="Getting withdrawals" />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="admin-withdrawals-page">
        {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
        {notice ? <StatusMessage tone="success">{notice}</StatusMessage> : null}

        <header className="admin-withdrawal-page-heading">
          <div><span>Finance</span><h1>Withdrawals</h1><p>Review platform earnings and payout activity.</p></div>
        </header>

        <div aria-label="Withdrawal sections" className="admin-withdrawal-tabs" role="tablist">
          <button aria-controls="admin-withdrawal-panel-earnings" aria-selected={activeTab === 'earnings'} className={activeTab === 'earnings' ? 'is-active' : ''} id="admin-withdrawal-tab-earnings" onClick={() => setActiveTab('earnings')} role="tab" type="button">Platform earnings</button>
          <button aria-controls="admin-withdrawal-panel-lenders" aria-selected={activeTab === 'lenders'} className={activeTab === 'lenders' ? 'is-active' : ''} id="admin-withdrawal-tab-lenders" onClick={() => setActiveTab('lenders')} role="tab" type="button">Lender history <span>{lenderWithdrawals.length}</span></button>
          <button aria-controls="admin-withdrawal-panel-history" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? 'is-active' : ''} id="admin-withdrawal-tab-history" onClick={() => setActiveTab('history')} role="tab" type="button">Admin history <span>{adminWithdrawals.length}</span></button>
        </div>

        {activeTab === 'earnings' ? (
          <section aria-labelledby="admin-withdrawal-tab-earnings" className="admin-withdrawal-tab-panel" id="admin-withdrawal-panel-earnings" role="tabpanel" tabIndex={0}>
            <section className="admin-withdrawal-summary admin-earnings-summary">
              <article className="is-available"><span>Available platform earnings</span><strong>{loading ? 'Loading…' : currency.format(Number(adminBalance.available) || 0)}</strong></article>
              <article><span>Total platform earnings</span><strong>{loading ? 'Loading…' : currency.format(commissionIncome)}</strong></article>
              <article><span>Reserved for payout</span><strong>{loading ? 'Loading…' : currency.format(Number(adminBalance.reserved) || 0)}</strong></article>
              <article><span>Already withdrawn</span><strong>{loading ? 'Loading…' : currency.format(Number(adminBalance.paid_out) || 0)}</strong></article>
            </section>
            <div className="admin-earnings-details">
            <div className="admin-income-breakdown">
              <div className="admin-income-breakdown-heading"><span>Income breakdown</span><h2>Earnings by source</h2></div>
            <section aria-label="Platform earnings by source" className="admin-platform-source-summary">
              <article><span>Rental commission · 15%</span><strong>{loading ? 'Loading…' : currency.format(Number(incomeBreakdown.rental_commission) || 0)}</strong></article>
              <article><span>Product commission · 15%</span><strong>{loading ? 'Loading…' : currency.format(Number(incomeBreakdown.product_commission) || 0)}</strong></article>
              <article><span>Late fee share · 15%</span><strong>{loading ? 'Loading…' : currency.format(Number(incomeBreakdown.late_fee_share) || 0)}</strong></article>
              <article><span>Damage payment share · 15%</span><strong>{loading ? 'Loading…' : currency.format(Number(incomeBreakdown.damaged_item_share) || 0)}</strong></article>
              <article><span>Promotion income</span><strong>{loading ? 'Loading…' : currency.format(Number(incomeBreakdown.promotion_income) || 0)}</strong></article>
            </section>
            </div>
            <Panel className="admin-withdrawal-panel admin-platform-payout-panel">
              <div className="admin-withdrawal-queue-heading"><div><span>Platform payout</span><h2>Withdraw platform earnings</h2><p>Send available earnings to your GCash account.</p></div><Badge tone="info">GCash</Badge></div>
              <form className="admin-platform-payout-form" onSubmit={submitAdminPayout}>
                <FormField hint={payoutAmountError || `Minimum PHP 100.00 · Maximum PHP 50,000.00 · Available ${currency.format(Number(adminBalance.available) || 0)}`} label="Amount (PHP)" required>
                  <Input aria-invalid={Boolean(payoutAmountError)} autoComplete="off" max={adminAmountLimit} min="100" onChange={(event) => {
                    const amount = event.target.value;
                    setPayoutForm((current) => ({ ...current, amount }));
                    setPayoutAmountError(amount ? validateAdminAmount(amount) : '');
                  }} required step="0.01" type="number" value={payoutForm.amount} />
                </FormField>
                <FormField label="Name registered to GCash" required>
                  <Input autoComplete="name" onChange={(event) => setPayoutForm((current) => ({ ...current, accountName: event.target.value }))} required value={payoutForm.accountName} />
                </FormField>
                <FormField hint="Enter the 11-digit mobile number linked to the GCash account." label="GCash mobile number" required>
                  <Input autoComplete="tel" inputMode="numeric" maxLength={13} onChange={(event) => setPayoutForm((current) => ({ ...current, accountNumber: event.target.value.replace(/[^\d+\s-]/g, '') }))} pattern="(?:\+?63|0)?9\d{9}" placeholder="09XX XXX XXXX" required value={payoutForm.accountNumber} />
                </FormField>
                <Button disabled={loading || submittingPayout || Boolean(validateAdminAmount(payoutForm.amount))} type="submit">{submittingPayout ? 'Submitting…' : 'Request earnings withdrawal'}</Button>
              </form>
            </Panel>
            </div>
          </section>
        ) : null}

        {activeTab === 'lenders' ? (
          <section aria-labelledby="admin-withdrawal-tab-lenders" className="admin-withdrawal-tab-panel" id="admin-withdrawal-panel-lenders" role="tabpanel" tabIndex={0}>
            <section className="admin-withdrawal-summary admin-lender-summary">
              <article><span>Automatic payouts pending</span><strong>{loading ? 'Loading…' : currency.format(lenderSummary.requested)}</strong></article>
              <article><span>Transfers processing</span><strong>{loading ? 'Loading…' : currency.format(lenderSummary.processing)}</strong></article>
              <article><span>Paid out to lenders</span><strong>{loading ? 'Loading…' : currency.format(lenderSummary.paid)}</strong></article>
            </section>
            <Panel className="admin-withdrawal-panel admin-withdrawal-queue">
              <div className="admin-withdrawal-queue-heading"><div><span>Lender payouts</span><h2>Lender withdrawal history</h2></div><Button disabled={loading} onClick={refresh} variant="ghost">Refresh</Button></div>
              {loading ? <DataLoadingScreen label="Loading lender withdrawals" message="Loading withdrawal history from the database." title="Getting lender withdrawals" /> : lenderWithdrawals.length ? (
            <div className="admin-withdrawal-table-wrap">
              <table className="admin-withdrawal-table">
                <thead><tr><th>Lender</th><th>Destination</th><th>Requested</th><th>Amount</th><th>Status</th><th>PayMongo transfer</th><th>Action</th></tr></thead>
                <tbody>{lenderWithdrawals.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{nameFor(profiles[row.owner_id])}</strong><small>@{profiles[row.owner_id]?.username || 'owner'}</small></td>
                    <td><strong>{row.destination_bank_name}</strong><small>{row.destination_bic} · {maskAccount(row.destination_account_number)}</small><small>{row.destination_account_name}</small></td>
                    <td>{formatDate(row.created_at)}</td>
                    <td><strong>{currency.format(Number(row.amount) || 0)}</strong></td>
                    <td><Badge tone={statusTone(row.status)}>{row.status}</Badge>{row.admin_note ? <small className="admin-withdrawal-note">{row.admin_note}</small> : null}</td>
                    <td>{row.paymongo_status ? <><Badge tone={statusTone(row.paymongo_status === 'succeeded' ? 'paid' : row.paymongo_status === 'pending' ? 'processing' : row.paymongo_status)}>{row.paymongo_status}</Badge><small>{row.paymongo_transfer_id}</small></> : row.status === 'requested' ? 'Not sent yet' : '—'}</td>
                    <td>{row.status === 'processing' && row.paymongo_transfer_id ? <Button disabled={busyId === row.id} onClick={() => handleTransferAction('refresh', row)} type="button" variant="secondary">{busyId === row.id ? 'Checking…' : 'Refresh status'}</Button> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
              ) : <StatusMessage tone="info">No lender withdrawals have been recorded.</StatusMessage>}
            </Panel>
          </section>
        ) : null}

        {activeTab === 'history' ? (
          <section aria-labelledby="admin-withdrawal-tab-history" className="admin-withdrawal-tab-panel" id="admin-withdrawal-panel-history" role="tabpanel" tabIndex={0}>
            <Panel className="admin-withdrawal-panel admin-withdrawal-queue">
              <div className="admin-withdrawal-queue-heading"><div><span>Platform payouts</span><h2>Admin withdrawal history</h2></div><Button disabled={loading} onClick={refresh} variant="ghost">Refresh</Button></div>
              {loading ? <DataLoadingScreen label="Loading admin withdrawals" message="Loading withdrawal history from the database." title="Getting withdrawal history" /> : adminWithdrawals.length ? (
                <div className="admin-withdrawal-table-wrap">
                  <table className="admin-withdrawal-table admin-own-history-table">
                    <thead><tr><th>Requested</th><th>Destination</th><th>Amount</th><th>Status</th><th>Transfer</th><th>Action</th></tr></thead>
                    <tbody>{adminWithdrawals.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.created_at)}</td>
                        <td><strong>{row.destination_bank_name}</strong><small>{maskAccount(row.destination_account_number)}</small><small>{row.destination_account_name}</small></td>
                        <td><strong>{currency.format(Number(row.amount) || 0)}</strong></td>
                        <td><Badge tone={statusTone(row.status)}>{row.status}</Badge>{row.admin_note ? <small className="admin-withdrawal-note">{row.admin_note}</small> : null}</td>
                        <td>{row.paymongo_status ? <><Badge tone={statusTone(row.paymongo_status === 'succeeded' ? 'paid' : row.paymongo_status === 'pending' ? 'processing' : row.paymongo_status)}>{row.paymongo_status}</Badge><small>{row.paymongo_transfer_id || '—'}</small></> : '—'}</td>
                        <td><div className="admin-withdrawal-actions">
                          {['requested', 'failed'].includes(row.status) ? <Button disabled={busyId === row.id} onClick={() => handleTransferAction('process', row)} type="button">{busyId === row.id ? 'Sending…' : row.status === 'failed' ? 'Retry payout' : 'Send payout'}</Button> : row.status === 'processing' ? <Button disabled={busyId === row.id} onClick={() => handleTransferAction(row.paymongo_transfer_id ? 'refresh' : 'process', row)} type="button" variant="secondary">{busyId === row.id ? 'Checking…' : row.paymongo_transfer_id ? 'Refresh status' : 'Retry safely'}</Button> : '—'}
                        </div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <StatusMessage tone="info">No platform earnings withdrawals yet.</StatusMessage>}
            </Panel>
          </section>
        ) : null}

      </div>
    </AdminShell>
  );
}
