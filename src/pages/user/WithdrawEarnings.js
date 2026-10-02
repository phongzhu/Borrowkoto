import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { Badge, Button, FormField, Input, Modal, Panel, StatusMessage } from '../../ui/primitives';
import UserShell from './UserShell';
import './WithdrawEarnings.css';

const currency = new Intl.NumberFormat('en-PH', { currency: 'PHP', style: 'currency' });
const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dateTime.format(parsed);
}

function maskAccount(value) {
  const digits = String(value || '').replace(/\s/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : '—';
}

function statusTone(status) {
  if (status === 'paid') return 'success';
  if (status === 'failed' || status === 'rejected') return 'danger';
  if (status === 'processing') return 'info';
  return 'warning';
}

async function getPayoutError(error, data) {
  if (data?.error) return data.error;
  if (error?.context && typeof error.context.json === 'function') {
    try {
      const payload = await error.context.json();
      if (payload?.error) return payload.error;
    } catch {
      // Fall back to the function client's message.
    }
  }
  return error?.message || 'We could not confirm the PayMongo transfer. Check withdrawal history before retrying.';
}

export default function WithdrawEarnings() {
  const [userId, setUserId] = useState('');
  const [balance, setBalance] = useState({ available: 0, gross_earned: 0, paid_out: 0, reserved: 0 });
  const [withdrawals, setWithdrawals] = useState([]);
  const [eligibleIncomes, setEligibleIncomes] = useState([]);
  const [form, setForm] = useState({ amount: '', accountName: '', accountNumber: '' });
  const [amountError, setAmountError] = useState('');
  const [activeTab, setActiveTab] = useState('request');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [existingRequest, setExistingRequest] = useState(null);
  const [paymentStep, setPaymentStep] = useState('review');
  const [paymentProgress, setPaymentProgress] = useState(0);
  const [paymentError, setPaymentError] = useState('');
  const [paymentReceipt, setPaymentReceipt] = useState(null);
  const [refreshingWithdrawalId, setRefreshingWithdrawalId] = useState('');
  const [error, setError] = useState('');
  const [flowNotice, setFlowNotice] = useState('');

  const loadData = useCallback(async (id) => {
    if (!id) return;
    const [balanceResult, withdrawalsResult, bookingsResult, transactionsResult] = await Promise.all([
      supabase.rpc('get_earnings_withdrawal_balance'),
      supabase.from('earnings_withdrawals')
        .select('id, amount, destination_bank_name, destination_bic, destination_account_name, destination_account_number, status, paymongo_status, paymongo_transfer_id, admin_note, created_at, processed_at')
        .eq('owner_id', id)
        .order('created_at', { ascending: false }),
      supabase.from('bookings')
        .select('id, status, rental_fee_total, rental_price_per_day, rental_days, requested_start, requested_end, approved_start, approved_end, created_at, items:item_id(title)')
        .eq('owner_id', id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false }),
      supabase.from('payment_transactions')
        .select('id, booking_id, amount, status, transaction_type, transaction_at, notes, payee_id')
        .eq('payee_id', id)
        .order('transaction_at', { ascending: false })
        .limit(2500),
    ]);
    if (balanceResult.error || withdrawalsResult.error || bookingsResult.error || transactionsResult.error) {
      const rpcError = balanceResult.error;
      if (rpcError?.code === 'PGRST202' || rpcError?.message?.includes('get_earnings_withdrawal_balance')) {
        throw new Error('Withdrawal balance is not available yet. Apply the pending Supabase earnings-withdrawals migration, then refresh this page.');
      }
      throw new Error(rpcError?.message || withdrawalsResult.error?.message || bookingsResult.error?.message || transactionsResult.error?.message || 'Unable to load withdrawal information.');
    }
    const nextBalance = balanceResult.data?.[0] || { available: 0, gross_earned: 0, paid_out: 0, reserved: 0 };
    setBalance(nextBalance);
    const availableToRequest = Number(nextBalance.available) || 0;
    const suggestedAmount = availableToRequest >= 100 ? Math.min(50000, availableToRequest).toFixed(2) : '';
    setForm((current) => current.amount ? current : { ...current, amount: suggestedAmount });
    setWithdrawals(withdrawalsResult.data || []);
    const itemTitleByBooking = new Map((bookingsResult.data || []).map((booking) => [booking.id, booking.items?.title || 'Rental item']));
    const rentalRows = (bookingsResult.data || []).map((booking) => ({
      amount: Number(booking.rental_fee_total) || (Number(booking.rental_price_per_day) * Number(booking.rental_days)) || 0,
      date: booking.approved_start || booking.requested_start || booking.created_at,
      id: `rental-${booking.id}`,
      label: 'Rental income',
      title: booking.items?.title || 'Rental item',
    }));
    const transactionRows = (transactionsResult.data || []).flatMap((transaction) => {
      const type = String(transaction.transaction_type || '').toLowerCase();
      const notes = String(transaction.notes || '').toLowerCase();
      const status = String(transaction.status || '').toLowerCase();
      if (!['recorded', 'paid', 'completed', 'succeeded', 'settled'].includes(status)) return [];
      const amount = Number(transaction.amount) || 0;
      if (amount <= 0) return [];
      if (type === 'late_fee_owner_share') return [{ amount, date: transaction.transaction_at, id: transaction.id, label: 'Late fee income', title: itemTitleByBooking.get(transaction.booking_id) || 'Late payment' }];
      if (type === 'damage_payment' || (type === 'payment' && notes.startsWith('damage claim payment for booking '))) {
        return [{ amount: Number((amount * 0.85).toFixed(2)), date: transaction.transaction_at, id: transaction.id, label: 'Damaged item income · 85% share', title: itemTitleByBooking.get(transaction.booking_id) || 'Damaged item' }];
      }
      if (['purchase_payment', 'item_purchase_payment', 'purchase'].includes(type) || (type === 'payment' && notes.startsWith('purchase payment for item request '))) {
        return [{ amount, date: transaction.transaction_at, id: transaction.id, label: 'Product sale income', title: 'Purchased item' }];
      }
      return [];
    });
    setEligibleIncomes([...rentalRows, ...transactionRows].sort((left, right) => new Date(right.date || 0) - new Date(left.date || 0)));
  }, []);

  useEffect(() => {
    let mounted = true;
    async function initialize() {
      setLoading(true);
      setError('');
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }
      if (!user?.id) {
        setError('Sign in to view your earnings and withdrawals.');
        setLoading(false);
        return;
      }
      setUserId(user.id);
      try {
        await loadData(user.id);
      } catch (loadError) {
        if (mounted) setError(loadError.message || 'Unable to load your withdrawal balance.');
      }
      if (mounted) setLoading(false);
    }
    initialize();
    return () => { mounted = false; };
  }, [loadData]);

  const activeRequestCount = useMemo(
    () => withdrawals.filter((row) => ['requested', 'processing'].includes(row.status)).length,
    [withdrawals]
  );
  const realWithdrawalRows = withdrawals;
  const amountLimit = Math.min(50000, Number(balance.available) || 0);

  function validateAmount(value) {
    const amount = Number(value);
    if (!value || !Number.isFinite(amount)) return 'Enter an amount to withdraw.';
    if (amount < 100) return 'The minimum withdrawal is PHP 100.00.';
    if (amount > 50000) return 'The maximum withdrawal is PHP 50,000.00.';
    if (amount > Number(balance.available)) return `You can withdraw up to ${currency.format(Number(balance.available) || 0)}.`;
    return '';
  }

  function submitWithdrawal(event) {
    event.preventDefault();
    const validationError = validateAmount(form.amount);
    if (validationError) {
      setAmountError(validationError);
      return;
    }
    setExistingRequest(null);
    setPaymentStep('review');
    setPaymentError('');
    setPaymentReceipt(null);
    setFlowNotice('');
    setConfirmOpen(true);
  }

  async function confirmWithdrawal() {
    setConfirmOpen(false);
    setSubmitting(true);
    setError('');
    setPaymentStep('processing');
    setPaymentProgress(0);
    setPaymentError('');
    let withdrawalId = existingRequest?.id || '';
    try {
      if (!withdrawalId) {
        const { data, error: requestError } = await supabase.rpc('request_earnings_withdrawal', {
          p_amount: Number(form.amount),
          p_destination_bank_name: 'GCash',
          p_destination_bic: 'GXCHPHM2XXX',
          p_destination_account_name: form.accountName.trim(),
          p_destination_account_number: form.accountNumber.replace(/[\s-]/g, ''),
        });
        if (requestError) throw requestError;
        withdrawalId = data;
      }
      if (!withdrawalId) throw new Error('The withdrawal request was not saved. Check your history before trying again.');
      setPaymentProgress(1);
      const { data: payout, error: payoutError } = await supabase.functions.invoke('earnings-payout', {
        body: { action: 'process', withdrawal_id: withdrawalId },
      });
      setPaymentProgress(2);
      if (payoutError || payout?.error) throw new Error(await getPayoutError(payoutError, payout));
      if (!payout?.status) throw new Error('PayMongo did not return a transfer status. Check withdrawal history before retrying.');
      setPaymentProgress(3);
      setPaymentReceipt({
        accountName: existingRequest?.destination_account_name || form.accountName.trim(),
        accountNumber: existingRequest?.destination_account_number || form.accountNumber.replace(/[\s-]/g, ''),
        amount: Number(existingRequest?.amount ?? form.amount),
        id: withdrawalId,
        processedAt: new Date().toISOString(),
        providerReferenceNumber: payout.provider_reference_number || '',
        referenceNumber: payout.reference_number || '',
        status: payout.status,
        transferId: payout.transfer_id || '',
        type: 'payout',
      });
      setPaymentStep(payout.status === 'paid' ? 'success' : payout.status === 'processing' ? 'pending' : 'error');
      if (payout.status === 'failed') setPaymentError('PayMongo could not complete this transfer. Check the withdrawal history for the failure details before retrying.');
      if (!existingRequest) {
        setForm({ amount: '', accountName: '', accountNumber: '' });
        setAmountError('');
      }
      setExistingRequest(null);
      try {
        await loadData(userId);
      } catch (loadError) {
        setError(loadError.message || 'The transfer status was received, but the history could not refresh.');
      }
    } catch (requestFailure) {
      setPaymentError(requestFailure?.message || 'A network error interrupted the request. Check your connection and try again.');
      setPaymentStep('error');
      try { await loadData(userId); } catch (loadError) { setError(loadError.message || 'Unable to refresh withdrawal history.'); }
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  }

  async function refreshPayoutStatus(row) {
    setRefreshingWithdrawalId(row.id);
    setError('');
    try {
      const action = row.paymongo_transfer_id ? 'refresh' : 'process';
      const { data, error: payoutError } = await supabase.functions.invoke('earnings-payout', {
        body: { action, withdrawal_id: row.id },
      });
      if (payoutError || data?.error) {
        setError(await getPayoutError(payoutError, data));
      } else if (data.status === 'failed') {
        setFlowNotice('');
        setError('PayMongo reported that the transfer failed. Review the history details before retrying.');
      } else {
        setFlowNotice(data.status === 'paid'
          ? 'PayMongo confirmed the transfer. Your GCash withdrawal is recorded as paid.'
          : 'PayMongo is still processing the transfer. Your balance remains reserved until it completes.');
      }
    } catch (refreshError) {
      setError(refreshError?.message || 'We could not refresh the PayMongo status. Try again shortly.');
    }
    try { await loadData(userId); } catch (loadError) { setError(loadError.message || 'Unable to refresh withdrawal history.'); }
    setRefreshingWithdrawalId('');
  }

  function closePaymentFlow(visitHistory = false) {
    setConfirmOpen(false);
    setExistingRequest(null);
    setPaymentStep('review');
    setPaymentProgress(0);
    if (visitHistory) setActiveTab('history');
  }

  function returnToWithdrawals() {
    setFlowNotice(paymentReceipt?.status === 'paid'
      ? 'PayMongo confirmed the transfer. Your GCash withdrawal is recorded as paid.'
      : 'PayMongo accepted the withdrawal and is processing the transfer. Check the history for status updates.');
    setPaymentStep('review');
    setPaymentProgress(0);
    setActiveTab('history');
    setExistingRequest(null);
  }

  if (loading) {
    return (
      <UserShell>
        <DataLoadingScreen label="Loading wallet" message="Loading your balance and withdrawal history from the database." title="Getting your wallet" />
      </UserShell>
    );
  }

  return (
    <UserShell>
      <div className="withdraw-earnings-page">
        {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
        {flowNotice ? <StatusMessage tone="success">{flowNotice}</StatusMessage> : null}

        <section aria-label="Earnings summary" className="withdraw-earnings-summary">
          <article className="withdraw-balance-card is-available">
            <span>Available to withdraw</span>
            <strong>{loading ? 'Loading…' : currency.format(Number(balance.available) || 0)}</strong>
          </article>
          <article className="withdraw-balance-card">
            <span>Total eligible earnings</span>
            <strong>{loading ? 'Loading…' : currency.format(Number(balance.gross_earned) || 0)}</strong>
          </article>
          <article className="withdraw-balance-card">
            <span>Withdrawn</span>
            <strong>{loading ? 'Loading…' : currency.format(Number(balance.paid_out) || 0)}</strong>
            <small>{currency.format(Number(balance.reserved) || 0)} reserved · {activeRequestCount} pending</small>
          </article>
        </section>

        <div aria-label="Withdrawal sections" className="withdraw-tabs" role="tablist">
          <button aria-controls="withdraw-panel-request" aria-selected={activeTab === 'request'} className={activeTab === 'request' ? 'is-active' : ''} id="withdraw-tab-request" onClick={() => setActiveTab('request')} role="tab" type="button" tabIndex={activeTab === 'request' ? 0 : -1}>
            Request withdrawal
          </button>
          <button aria-controls="withdraw-panel-history" aria-selected={activeTab === 'history'} className={activeTab === 'history' ? 'is-active' : ''} id="withdraw-tab-history" onClick={() => setActiveTab('history')} role="tab" type="button" tabIndex={activeTab === 'history' ? 0 : -1}>
            Withdrawal history <span>{realWithdrawalRows.length}</span>
          </button>
        </div>

        {activeTab === 'request' ? (
          <div aria-labelledby="withdraw-tab-request" id="withdraw-panel-request" role="tabpanel" tabIndex={0}>
            <div className="withdraw-request-content">
              <Panel className="withdraw-request-panel">
                <div className="withdraw-panel-heading">
                  <div><span>Request a payout</span><h1>GCash account</h1></div>
                  <Badge tone="info">GCash</Badge>
                </div>
                <form className="withdraw-request-form" onSubmit={submitWithdrawal}>
                  <FormField hint={amountError || `Minimum PHP 100.00 · Maximum PHP 50,000.00 · Available ${currency.format(Number(balance.available) || 0)}`} label="Amount (PHP)" required>
                    <Input aria-invalid={Boolean(amountError)} autoComplete="off" max={amountLimit} min="100" onChange={(event) => {
                      const amount = event.target.value;
                      setForm((current) => ({ ...current, amount }));
                      setAmountError(amount ? validateAmount(amount) : '');
                    }} required step="0.01" type="number" value={form.amount} />
                  </FormField>
                  <FormField label="Name registered to GCash" required>
                    <Input autoComplete="name" onChange={(event) => setForm((current) => ({ ...current, accountName: event.target.value }))} required value={form.accountName} />
                  </FormField>
                  <FormField hint="Enter the 11-digit mobile number linked to the GCash account." label="GCash mobile number" required>
                    <Input autoComplete="tel" inputMode="numeric" maxLength={13} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value.replace(/[^\d+\s-]/g, '') }))} pattern="(?:\+?63|0)?9\d{9}" placeholder="09XX XXX XXXX" required value={form.accountNumber} />
                  </FormField>
                  <Button disabled={loading || submitting || Boolean(validateAmount(form.amount))} type="submit">
                    Review withdrawal
                  </Button>
                </form>
              </Panel>

              <Panel className="withdraw-income-panel">
                <div className="withdraw-panel-heading">
                  <div><span>Eligible earnings</span><h2>Completed rentals</h2></div>
                  <strong>{currency.format(Number(balance.available) || 0)} available</strong>
                </div>
                {loading ? <DataLoadingScreen compact label="Loading income" message="Loading your income from the database." title="Getting income" /> : eligibleIncomes.length ? (
                  <div className="withdraw-income-list">
                    {eligibleIncomes.map((income) => {
                      return (
                        <article key={income.id}>
                          <div><strong>{income.title}</strong><small>{income.label} · {formatDate(income.date)}</small></div>
                          <strong>{currency.format(income.amount)}</strong>
                        </article>
                      );
                    })}
                  </div>
                ) : <StatusMessage tone="info">Eligible rental, late fee, damage, and product sale income will appear here.</StatusMessage>}
              </Panel>
            </div>
          </div>
        ) : (
          <div aria-labelledby="withdraw-tab-history" id="withdraw-panel-history" role="tabpanel" tabIndex={0}>
            <Panel className="withdraw-history-panel">
              <div className="withdraw-panel-heading">
                <div><span>Withdrawals</span><h1>History</h1></div>
                <Badge tone="neutral">{realWithdrawalRows.length} request(s)</Badge>
              </div>
              {loading ? <DataLoadingScreen compact label="Loading withdrawals" message="Loading withdrawal history from the database." title="Getting withdrawals" /> : realWithdrawalRows.length ? (
                <div className="withdraw-history-table-wrap">
                  <table className="withdraw-history-table">
                    <thead><tr><th>Requested</th><th>Destination</th><th>Amount</th><th>Status</th><th>Transfer</th><th>Admin note</th></tr></thead>
                    <tbody>{realWithdrawalRows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.created_at)}</td>
                        <td><strong>{row.destination_bank_name}</strong><small>{maskAccount(row.destination_account_number)}</small></td>
                        <td><strong>{currency.format(Number(row.amount) || 0)}</strong></td>
                        <td><Badge tone={statusTone(row.status)}>{row.status}</Badge>{row.paymongo_status ? <small>PayMongo: {row.paymongo_status}</small> : null}</td>
                        <td>{row.paymongo_transfer_id || '—'}{row.processed_at ? <small>{formatDate(row.processed_at)}</small> : null}</td>
                        <td>
                          {row.admin_note || (row.status === 'requested' ? 'Waiting for PayMongo submission.' : '—')}
                          {['requested', 'failed'].includes(row.status) && !row.paymongo_transfer_id ? (
                            <Button className="withdraw-history-action" onClick={() => {
                              setExistingRequest(row);
                              setPaymentStep('review');
                              setPaymentProgress(0);
                              setPaymentError('');
                              setPaymentReceipt(null);
                              setConfirmOpen(true);
                            }} type="button" variant="secondary">{row.status === 'failed' ? 'Retry payout' : 'Continue payout'}</Button>
                          ) : null}
                          {row.status === 'processing' ? <Button className="withdraw-history-action" disabled={refreshingWithdrawalId === row.id} onClick={() => refreshPayoutStatus(row)} type="button" variant="secondary">{refreshingWithdrawalId === row.id ? 'Checking…' : row.paymongo_transfer_id ? 'Refresh PayMongo status' : 'Retry safely'}</Button> : null}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <StatusMessage tone="info">No withdrawal requests yet.</StatusMessage>}
            </Panel>
          </div>
        )}
      </div>
      <Modal
        actions={(
          <>
            <Button disabled={submitting} variant="ghost" onClick={closePaymentFlow}>
              Cancel
            </Button>
            <Button disabled={submitting} onClick={confirmWithdrawal}>
              {existingRequest ? 'Send payout' : 'Confirm withdrawal'}
            </Button>
          </>
        )}
        onClose={() => { if (!submitting) closePaymentFlow(); }}
        open={confirmOpen}
        size="compact"
        contentClassName="withdraw-payment-modal"
        contentStyle={{ maxWidth: 620, width: 'min(100%, 620px)' }}
        title={existingRequest ? 'Continue withdrawal' : 'Review withdrawal'}
      >
        <div className="withdraw-confirm-summary">
          <div className="withdraw-payment-method"><img alt="GCash" className="withdraw-gcash-logo" src="/gcash-logo.svg" /><div><strong>GCash wallet</strong><small>{existingRequest ? 'Saved withdrawal request' : 'Payout destination'}</small></div><Badge tone="success">READY</Badge></div>
          <p>{existingRequest ? 'Review the saved request before sending it to PayMongo.' : 'Review the GCash destination and amount before sending your withdrawal to PayMongo.'}</p>
          <dl>
            <div><dt>Amount</dt><dd>{currency.format(Number(existingRequest?.amount ?? form.amount) || 0)}</dd></div>
            <div><dt>Account name</dt><dd>{existingRequest?.destination_account_name || form.accountName.trim() || '—'}</dd></div>
            <div><dt>GCash number</dt><dd>{maskAccount(existingRequest?.destination_account_number || form.accountNumber.replace(/[\s-]/g, ''))}</dd></div>
            <div className="withdraw-review-total"><dt>Total amount</dt><dd>{currency.format(Number(existingRequest?.amount ?? form.amount) || 0)}</dd></div>
          </dl>
          <div className="withdraw-review-mode"><span aria-hidden="true">&#10003;</span><div><strong>PayMongo live transfer</strong><small>Once confirmed, PayMongo will send the payout to this GCash account. The withdrawal is marked paid only after PayMongo confirms completion.</small></div></div>
        </div>
      </Modal>
      {['processing', 'success', 'pending', 'error'].includes(paymentStep) ? (
        <section aria-live="polite" aria-modal="true" className={`withdraw-fullscreen-flow is-${paymentStep}`} role="dialog">
          <div className="withdraw-flow-topbar">
            <div className="withdraw-flow-brand"><span>BK</span><div><strong>Borrow Ko ’To</strong><small>GCash withdrawal</small></div></div>
            <div className="withdraw-flow-mode"><i /> Secure payout flow</div>
          </div>
          {paymentStep === 'processing' ? (
            <div className="withdraw-flow-processing">
              <div className="withdraw-flow-orbit"><span>&#8369;</span><i /></div>
              <div className="withdraw-flow-kicker">GCASH · PAYOUT</div>
              <h1>{paymentProgress === 0 ? 'Saving your withdrawal request' : paymentProgress === 1 ? 'Submitting payout to PayMongo' : 'Confirming PayMongo transfer status'}</h1>
              <p>Keep this page open while PayMongo accepts the GCash transfer request.</p>
              <div className="withdraw-flow-amount">{currency.format(Number(existingRequest?.amount ?? paymentReceipt?.amount ?? form.amount) || 0)}<small>Requested amount</small></div>
              <ol className="withdraw-flow-timeline">
                {['Withdrawal request saved', 'Submitted to PayMongo', 'Transfer status received'].map((label, index) => (
                  <li className={paymentProgress > index ? 'is-done' : paymentProgress === index ? 'is-active' : ''} key={label}>
                    <span>{paymentProgress > index ? <>&#10003;</> : paymentProgress === index ? <i /> : index + 1}</span><div><strong>{label}</strong>{paymentProgress === index ? <small>In progress</small> : null}</div>
                  </li>
                ))}
              </ol>
              <div className="withdraw-flow-progress"><span style={{ width: `${Math.max(10, paymentProgress * 30)}%` }} /></div>
              <small className="withdraw-flow-disclosure">Your withdrawal is recorded in your account history.</small>
            </div>
          ) : null}
          {paymentStep === 'success' && paymentReceipt ? (
            <div className="withdraw-flow-success">
              <div className="withdraw-flow-success-icon">&#10003;</div>
              <div className="withdraw-flow-kicker">PAYMONGO CONFIRMED</div>
              <h1>Withdrawal completed</h1>
              <p>PayMongo confirmed the transfer to your GCash account.</p>
              <div className="withdraw-flow-receipt">
                <div className="withdraw-flow-receipt-amount"><span>Amount</span><strong>{currency.format(paymentReceipt.amount)}</strong></div>
                <div><span>To</span><strong>{paymentReceipt.accountName || 'GCash account'}</strong></div>
                <div><span>GCash number</span><strong>{maskAccount(paymentReceipt.accountNumber)}</strong></div>
                <div><span>PayMongo transfer</span><strong>{paymentReceipt.transferId}</strong></div>
                {paymentReceipt.providerReferenceNumber ? <div><span>GCash/InstaPay reference</span><strong>{paymentReceipt.providerReferenceNumber}</strong></div> : null}
                <div><span>Completed</span><strong>{formatDate(paymentReceipt.processedAt)}</strong></div>
              </div>
              <Button onClick={returnToWithdrawals}>Return to withdrawal history</Button>
              <small className="withdraw-flow-disclosure">Keep the transfer reference for your records.</small>
            </div>
          ) : null}
          {paymentStep === 'pending' && paymentReceipt ? (
            <div className="withdraw-flow-success is-pending">
              <div className="withdraw-flow-pending-icon"><i /></div>
              <div className="withdraw-flow-kicker">PAYMONGO PROCESSING</div>
              <h1>Your withdrawal is on its way</h1>
              <p>PayMongo accepted the transfer request. The GCash transfer is not marked paid until PayMongo confirms it.</p>
              <div className="withdraw-flow-receipt">
                <div className="withdraw-flow-receipt-amount"><span>Requested payout</span><strong>{currency.format(paymentReceipt.amount)}</strong></div>
                <div><span>To</span><strong>{paymentReceipt.accountName || 'GCash account'}</strong></div>
                <div><span>PayMongo transfer</span><strong>{paymentReceipt.transferId || 'Waiting for reference'}</strong></div>
              </div>
              <Button onClick={returnToWithdrawals}>View withdrawal history</Button>
              <small className="withdraw-flow-disclosure">Do not submit another request while this transfer is processing.</small>
            </div>
          ) : null}
          {paymentStep === 'error' ? (
            <div className="withdraw-flow-error">
              <span>!</span><div className="withdraw-flow-kicker">REQUEST NOT COMPLETED</div><h1>We could not finish the withdrawal</h1><p>{paymentError}</p>
              <Button onClick={() => closePaymentFlow(true)}>Return to withdrawal history</Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </UserShell>
  );
}
