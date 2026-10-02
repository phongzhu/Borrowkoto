import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { CatalogIcon, CheckIcon, SparkIcon, StarIcon, UploadIcon } from '../../ui/icons';
import { Badge, Panel, StatusMessage } from '../../ui/primitives';
import { BOOKING_STATUS, TERMINAL_BOOKING_STATUSES } from '../../utils/bookingEnums';
import UserShell from './UserShell';
import './RentalIncome.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const TRANSACTIONS_PER_PAGE = 10;

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return dateFormatter.format(date);
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function formatStatusLabel(status) {
  return String(status || 'unknown')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function normalizeTransactionType(type) {
  return String(type || '').trim().toLowerCase();
}

function isRecordedTransactionStatus(status) {
  return ['recorded', 'completed', 'succeeded', 'paid'].includes(normalizeStatus(status));
}

function isDepositReturnTransaction(transaction) {
  const normalizedType = normalizeTransactionType(transaction?.transaction_type);
  const reference = String(transaction?.reference_number || '').toLowerCase();
  return (
    ['deposit_return', 'security_deposit_return', 'deposit_refund', 'refund'].includes(normalizedType) ||
    reference.startsWith('paymongo:deposit:return:')
  );
}

function isCompletedStatus(status) {
  const normalized = normalizeStatus(status);
  return TERMINAL_BOOKING_STATUSES.has(normalized) && normalized !== BOOKING_STATUS.CANCELLED;
}

function isIncomingStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized === BOOKING_STATUS.PENDING || normalized === BOOKING_STATUS.ACCEPTED;
}

function isCancelledStatus(status) {
  return normalizeStatus(status) === BOOKING_STATUS.CANCELLED;
}

function getHistoryTone(type) {
  if (type === 'You Earned') return 'success';
  if (type === 'Refund Received') return 'success';
  if (type === 'Incoming Earn' || type === 'Incoming') return 'info';
  if (type === 'You Spent') return 'warning';
  if (type === 'Cancelled') return 'danger';
  return 'neutral';
}

function formatSignedPercent(value) {
  const numeric = Number(value) || 0;
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(1)}%`;
}

export default function RentalIncome() {
  const [userId, setUserId] = useState('');
  const [ownerBookings, setOwnerBookings] = useState([]);
  const [borrowerBookings, setBorrowerBookings] = useState([]);
  const [paymentTransactions, setPaymentTransactions] = useState([]);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFilters, setHistoryFilters] = useState({ startDate: '', endDate: '', type: 'all', status: 'all', query: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);
      setError('');

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

      if (!user?.id) {
        setUserId('');
        setLoading(false);
        return;
      }

      setUserId(user.id);

      const { data: ownerBookingsData, error: ownerBookingsError } = await supabase
        .from('bookings')
        .select(
          `
            id,
            status,
            rental_days,
            total_due,
            requested_start,
            requested_end,
            created_at,
            items:item_id(id, title)
          `
        )
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });

      const { data: borrowerBookingsData, error: borrowerBookingsError } = await supabase
        .from('bookings')
        .select(
          `
            id,
            status,
            rental_days,
            total_due,
            requested_start,
            requested_end,
            created_at,
            items:item_id(id, title)
          `
        )
        .eq('borrower_id', user.id)
        .order('created_at', { ascending: false });

      const { data: purchaseRequestsData, error: purchaseRequestsError } = await supabase
        .from('item_purchase_requests')
        .select(
          `
            id,
            status,
            sale_total_amount_snapshot,
            sale_price_snapshot,
            buyer_requested_quantity,
            seller_approved_quantity,
            created_at,
            item:items(id, title)
          `
        )
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });
      const { data: paymentTransactionsData, error: paymentTransactionsError } = await supabase
        .from('payment_transactions')
        .select('id, booking_id, amount, status, transaction_type, transaction_at, payer_id, payee_id, reference_number, notes')
        .or(`payer_id.eq.${user.id},payee_id.eq.${user.id}`)
        .order('transaction_at', { ascending: false });

      const ownerItemIds = Array.from(new Set((ownerBookingsData || []).map((booking) => booking.items?.id).filter(Boolean)));
      const { data: ownerItemsMetaData, error: ownerItemsMetaError } = ownerItemIds.length
        ? await supabase
            .from('items')
            .select('id, pickup_city, pickup_province, pickup_region, categories:category_id(name)')
            .in('id', ownerItemIds)
        : { data: [], error: null };

      if (!mounted) return;

      if (ownerBookingsError || borrowerBookingsError || purchaseRequestsError || paymentTransactionsError || ownerItemsMetaError) {
        const messages = [
          ownerBookingsError ? `owner bookings: ${ownerBookingsError.message}` : '',
          borrowerBookingsError ? `borrower bookings: ${borrowerBookingsError.message}` : '',
          purchaseRequestsError ? `purchase requests: ${purchaseRequestsError.message}` : '',
          paymentTransactionsError ? `payment transactions: ${paymentTransactionsError.message}` : '',
          ownerItemsMetaError ? `owner items meta: ${ownerItemsMetaError.message}` : '',
        ].filter(Boolean);
        setError(`Unable to load wallet data: ${messages.join(' | ')}`);
        setLoading(false);
        return;
      }

      const ownerItemMetaMap = new Map((ownerItemsMetaData || []).map((row) => [row.id, row]));
      const enrichedOwnerBookings = (ownerBookingsData || []).map((booking) => {
        const itemId = booking.items?.id;
        const meta = itemId ? ownerItemMetaMap.get(itemId) : null;
        const regionLabel = meta?.pickup_region || meta?.pickup_province || meta?.pickup_city || 'Other Regions';
        return {
          ...booking,
          items: {
            ...booking.items,
            categoryName: meta?.categories?.name || 'Uncategorized',
            regionLabel,
          },
        };
      });

      setOwnerBookings(enrichedOwnerBookings);
      setBorrowerBookings(borrowerBookingsData || []);
      setPurchaseRequests(purchaseRequestsData || []);
      setPaymentTransactions(paymentTransactionsData || []);
      setLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const wallet = useMemo(() => {
    const summary = {
      totalEarned: 0,
      totalSpentBuying: 0,
      totalSpentRenting: 0,
      totalDepositRefunds: 0,
      cancelledAmount: 0,
      completedCount: 0,
      incomingEarnedAmount: 0,
      incomingCount: 0,
      transactionHistory: [],
    };

    ownerBookings.forEach((booking) => {
      const amount = Number(booking.total_due || 0);
      const status = normalizeStatus(booking.status);
      const itemTitle = booking.items?.title || 'Unknown item';
      const periodLabel = `${formatDate(booking.requested_start)} to ${formatDate(booking.requested_end)}`;

      let transactionType = 'Other';
      let helperText = `${formatStatusLabel(status)} booking`;

      if (isCompletedStatus(status)) {
        summary.totalEarned += amount;
        summary.completedCount += 1;
        transactionType = 'You Earned';
        helperText = 'Renter completed booking';
      } else if (isIncomingStatus(status)) {
        summary.incomingEarnedAmount += amount;
        summary.incomingCount += 1;
        transactionType = 'Incoming Earn';
        helperText = 'Waiting for booking completion';
      } else if (isCancelledStatus(status)) {
        summary.cancelledAmount += amount;
        transactionType = 'Cancelled';
        helperText = 'Owner-side booking cancelled';
      }

      summary.transactionHistory.push({
        amount,
        date: booking.created_at,
        helperText,
        id: booking.id,
        itemTitle,
        periodLabel,
        statusLabel: formatStatusLabel(status),
        transactionType,
      });
    });

    borrowerBookings.forEach((booking) => {
      const amount = Number(booking.total_due || 0);
      const status = normalizeStatus(booking.status);
      const itemTitle = booking.items?.title || 'Unknown item';
      const periodLabel = `${formatDate(booking.requested_start)} to ${formatDate(booking.requested_end)}`;
      const excluded = ['cancelled', 'rejected', 'denied'].includes(status);

      if (!excluded && amount > 0) {
        summary.totalSpentRenting += amount;
      }

      summary.transactionHistory.push({
        amount,
        date: booking.created_at,
        helperText: excluded ? 'Rental booking cancelled' : 'You rented an item',
        id: `rent-${booking.id}`,
        itemTitle,
        periodLabel,
        statusLabel: formatStatusLabel(status),
        transactionType: excluded ? 'Cancelled' : 'You Spent',
      });
    });

    purchaseRequests.forEach((request) => {
      const status = normalizeStatus(request.status);
      const quantity = Number(request.seller_approved_quantity || request.buyer_requested_quantity || 1);
      const amount = Number(
        request.sale_total_amount_snapshot || (Number(request.sale_price_snapshot || 0) * (quantity > 0 ? quantity : 1))
      );
      const isPaidPurchase = ['paid', 'ready_for_pickup', 'completed'].includes(status);

      if (isPaidPurchase && amount > 0) {
        summary.totalSpentBuying += amount;
      }

      summary.transactionHistory.push({
        amount,
        date: request.created_at,
        helperText: isPaidPurchase ? 'You bought an item' : 'Purchase request',
        id: `buy-${request.id}`,
        itemTitle: request.item?.title || 'Unknown item',
        periodLabel: `Quantity: ${quantity}`,
        statusLabel: formatStatusLabel(status),
        transactionType: isPaidPurchase ? 'You Spent' : 'Incoming',
      });
    });

    const bookingTitleById = new Map();
    ownerBookings.forEach((booking) => {
      if (booking?.id) {
        bookingTitleById.set(booking.id, booking.items?.title || 'Unknown item');
      }
    });
    borrowerBookings.forEach((booking) => {
      if (booking?.id && !bookingTitleById.has(booking.id)) {
        bookingTitleById.set(booking.id, booking.items?.title || 'Unknown item');
      }
    });

    paymentTransactions.forEach((transaction) => {
      if (!isRecordedTransactionStatus(transaction.status) || !isDepositReturnTransaction(transaction)) {
        return;
      }

      const amount = Number(transaction.amount || 0);
      if (amount <= 0) {
        return;
      }

      const itemTitle = bookingTitleById.get(transaction.booking_id) || 'Security deposit';
      const statusLabel = formatStatusLabel(transaction.status);
      const eventDate = transaction.transaction_at || transaction.created_at;

      if (transaction.payee_id === userId) {
        summary.totalDepositRefunds += amount;
        summary.transactionHistory.push({
          amount,
          date: eventDate,
          helperText: 'Security deposit returned after item return',
          id: `deposit-refund-in-${transaction.id}`,
          itemTitle,
          periodLabel: transaction.booking_id ? `Booking: ${transaction.booking_id}` : 'Deposit refund',
          statusLabel,
          transactionType: 'Refund Received',
        });
        return;
      }

      if (transaction.payer_id === userId) {
        summary.transactionHistory.push({
          amount,
          date: eventDate,
          helperText: 'Security deposit refunded to borrower',
          id: `deposit-refund-out-${transaction.id}`,
          itemTitle,
          periodLabel: transaction.booking_id ? `Booking: ${transaction.booking_id}` : 'Deposit refund',
          statusLabel,
          transactionType: 'You Spent',
        });
      }
    });

    summary.totalSpentRenting = Math.max(0, summary.totalSpentRenting - summary.totalDepositRefunds);

    summary.totalEarned = Number(summary.totalEarned.toFixed(2));
    summary.totalSpentRenting = Number(summary.totalSpentRenting.toFixed(2));
    summary.totalSpentBuying = Number(summary.totalSpentBuying.toFixed(2));
    summary.totalDepositRefunds = Number(summary.totalDepositRefunds.toFixed(2));
    summary.incomingEarnedAmount = Number(summary.incomingEarnedAmount.toFixed(2));
    summary.cancelledAmount = Number(summary.cancelledAmount.toFixed(2));

    summary.transactionHistory.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());

    return summary;
  }, [borrowerBookings, ownerBookings, paymentTransactions, purchaseRequests, userId]);

  const analytics = useMemo(() => {
    const now = new Date();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const completedOwner = ownerBookings.filter((booking) => isCompletedStatus(booking.status));
    const incomingOwner = ownerBookings.filter((booking) => isIncomingStatus(booking.status));
    const cancelledOwner = ownerBookings.filter((booking) => isCancelledStatus(booking.status));
    const ownerOrdersCount = ownerBookings.length;

    const currentStart = new Date(now.getTime() - 30 * MS_PER_DAY);
    const previousStart = new Date(now.getTime() - 60 * MS_PER_DAY);
    const previousEnd = currentStart;

    let currentRevenue = 0;
    let previousRevenue = 0;
    let currentOrders = 0;
    let previousOrders = 0;

    completedOwner.forEach((booking) => {
      const amount = Number(booking.total_due || 0);
      const createdAt = new Date(booking.created_at || 0);
      if (createdAt >= currentStart) {
        currentRevenue += amount;
        currentOrders += 1;
      } else if (createdAt >= previousStart && createdAt < previousEnd) {
        previousRevenue += amount;
        previousOrders += 1;
      }
    });

    const revenueGrowth = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : currentRevenue > 0 ? 100 : 0;
    const orderGrowth = previousOrders > 0 ? ((currentOrders - previousOrders) / previousOrders) * 100 : currentOrders > 0 ? 100 : 0;
    const conversionRate = ownerOrdersCount > 0 ? (completedOwner.length / ownerOrdersCount) * 100 : 0;
    const cancellationRate = ownerOrdersCount > 0 ? (cancelledOwner.length / ownerOrdersCount) * 100 : 0;
    const avgOrderValue = completedOwner.length > 0 ? wallet.totalEarned / completedOwner.length : 0;

    const monthRevenueMap = new Map();
    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthRevenueMap.set(key, 0);
    }
    completedOwner.forEach((booking) => {
      const date = new Date(booking.created_at || 0);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (monthRevenueMap.has(key)) {
        monthRevenueMap.set(key, monthRevenueMap.get(key) + Number(booking.total_due || 0));
      }
    });
    const revenueSeries = Array.from(monthRevenueMap.entries()).map(([key, value]) => {
      const [year, month] = key.split('-');
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('en-PH', { month: 'short' });
      return { key, label, value };
    });
    const maxRevenuePoint = Math.max(1, ...revenueSeries.map((point) => point.value));

    const categoryMap = new Map();
    completedOwner.forEach((booking) => {
      const categoryName = booking.items?.categoryName || 'Uncategorized';
      const current = categoryMap.get(categoryName) || 0;
      categoryMap.set(categoryName, current + Number(booking.total_due || 0));
    });
    const categorySales = Array.from(categoryMap.entries())
      .map(([name, amount]) => ({ amount, name }))
      .sort((left, right) => right.amount - left.amount);
    const categoryTotal = categorySales.reduce((sum, entry) => sum + entry.amount, 0);

    const productMap = new Map();
    completedOwner.forEach((booking) => {
      const title = booking.items?.title || 'Unknown item';
      const current = productMap.get(title) || { orders: 0, revenue: 0 };
      productMap.set(title, {
        orders: current.orders + 1,
        revenue: current.revenue + Number(booking.total_due || 0),
      });
    });
    const topProducts = Array.from(productMap.entries())
      .map(([title, metrics]) => ({ ...metrics, title }))
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 5);

    const regionMap = new Map();
    completedOwner.forEach((booking) => {
      const region = booking.items?.regionLabel || 'Other Regions';
      const current = regionMap.get(region) || 0;
      regionMap.set(region, current + Number(booking.total_due || 0));
    });
    const regionalSales = Array.from(regionMap.entries())
      .map(([name, amount]) => ({ amount, name }))
      .sort((left, right) => right.amount - left.amount);
    const regionalTotal = regionalSales.reduce((sum, entry) => sum + entry.amount, 0);

    return {
      avgOrderValue,
      cancellationRate,
      categorySales,
      categoryTotal,
      conversionRate,
      incomingCount: incomingOwner.length,
      maxRevenuePoint,
      orderGrowth,
      regionalSales,
      regionalTotal,
      revenueGrowth,
      revenueSeries,
      topProducts,
      totalOrders: ownerOrdersCount,
    };
  }, [ownerBookings, wallet.totalEarned]);

  const filteredHistory = useMemo(() => {
    const start = historyFilters.startDate ? new Date(`${historyFilters.startDate}T00:00:00`).getTime() : null;
    const end = historyFilters.endDate ? new Date(`${historyFilters.endDate}T23:59:59.999`).getTime() : null;
    const query = historyFilters.query.trim().toLowerCase();
    return wallet.transactionHistory.filter((entry) => {
      const timestamp = new Date(entry.date || 0).getTime();
      if (start !== null && timestamp < start) return false;
      if (end !== null && timestamp > end) return false;
      if (historyFilters.type !== 'all' && entry.transactionType !== historyFilters.type) return false;
      if (historyFilters.status !== 'all' && entry.statusLabel !== historyFilters.status) return false;
      if (query && ![entry.itemTitle, entry.helperText, entry.transactionType, entry.statusLabel, entry.periodLabel].join(' ').toLowerCase().includes(query)) return false;
      return true;
    });
  }, [historyFilters, wallet.transactionHistory]);
  const historyTypes = useMemo(() => Array.from(new Set(wallet.transactionHistory.map((entry) => entry.transactionType))).sort(), [wallet.transactionHistory]);
  const historyStatuses = useMemo(() => Array.from(new Set(wallet.transactionHistory.map((entry) => entry.statusLabel))).sort(), [wallet.transactionHistory]);
  const totalHistoryPages = useMemo(() => Math.max(1, Math.ceil(filteredHistory.length / TRANSACTIONS_PER_PAGE)), [filteredHistory.length]);

  useEffect(() => {
    setHistoryPage((currentPage) => Math.min(currentPage, totalHistoryPages));
  }, [totalHistoryPages]);

  const paginatedHistory = useMemo(() => {
    const startIndex = (historyPage - 1) * TRANSACTIONS_PER_PAGE;
    const endIndex = startIndex + TRANSACTIONS_PER_PAGE;
    return filteredHistory.slice(startIndex, endIndex);
  }, [filteredHistory, historyPage]);
  const historyStart = (historyPage - 1) * TRANSACTIONS_PER_PAGE + (paginatedHistory.length ? 1 : 0);
  const historyEnd = (historyPage - 1) * TRANSACTIONS_PER_PAGE + paginatedHistory.length;

  function exportHistoryPdf() {
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const rows = filteredHistory.map((entry) => `<tr><td><strong>${escapeHtml(entry.itemTitle)}</strong><br>${escapeHtml(entry.helperText)}</td><td>${escapeHtml(entry.transactionType)}</td><td>${escapeHtml(entry.periodLabel)}</td><td>${escapeHtml(entry.statusLabel)}</td><td>${escapeHtml(formatDate(entry.date))}</td><td>${escapeHtml(currencyFormatter.format(entry.amount))}</td></tr>`).join('');
    printWindow.document.write(`<!doctype html><html><head><title>Transaction History</title><meta charset="utf-8"><style>body{font:12px Arial,sans-serif;color:#17243a;padding:24px}h1{font-size:20px;margin:0 0 6px}p{color:#52627a;margin:0 0 18px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8deea;padding:9px;text-align:left;vertical-align:top}th{background:#f1f3f8;font-size:10px;text-transform:uppercase;letter-spacing:.06em}td:last-child,th:last-child{text-align:right;white-space:nowrap}@media print{body{padding:0}}</style></head><body><h1>Transaction History</h1><p>${escapeHtml(historyFilters.startDate || 'Any start date')} to ${escapeHtml(historyFilters.endDate || 'Any end date')} · ${filteredHistory.length} transactions</p><table><thead><tr><th>Transaction</th><th>Type</th><th>Period</th><th>Status</th><th>Booked</th><th>Amount</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No transactions match the selected filters.</td></tr>'}</tbody></table><script>window.onload=()=>window.print();</script></body></html>`);
    printWindow.document.close();
  }

  if (loading) {
    return (
      <UserShell subtitle="" title="">
      <DataLoadingScreen label="Loading wallet" message="Loading your rental income from the database." title="Getting your wallet" />
      </UserShell>
    );
  }

  if (!userId) {
    return (
      <UserShell subtitle="" title="">
        <StatusMessage tone="warning">Please sign in to view your wallet.</StatusMessage>
      </UserShell>
    );
  }

  return (
    <UserShell subtitle="" title="">
      <div style={{ display: 'grid', gap: 20 }}>
        {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

        <section className="income-analytics-grid">
          <article className="income-kpi-card">
            <div className="income-kpi-head">
              <span className="income-kpi-icon"><SparkIcon size={18} /></span>
              <span className="income-kpi-label">Total Revenue</span>
              <em className={analytics.revenueGrowth >= 0 ? 'is-up' : 'is-down'}>{formatSignedPercent(analytics.revenueGrowth)}</em>
            </div>
            <strong>{currencyFormatter.format(wallet.totalEarned)}</strong>
            <small>{wallet.completedCount} completed lending booking(s)</small>
          </article>
          <article className="income-kpi-card">
            <div className="income-kpi-head">
              <span className="income-kpi-icon"><CatalogIcon size={18} /></span>
              <span className="income-kpi-label">Total Orders</span>
              <em className={analytics.orderGrowth >= 0 ? 'is-up' : 'is-down'}>{formatSignedPercent(analytics.orderGrowth)}</em>
            </div>
            <strong>{analytics.totalOrders}</strong>
            <small>{analytics.incomingCount} currently incoming</small>
          </article>
          <article className="income-kpi-card">
            <div className="income-kpi-head">
              <span className="income-kpi-icon"><CheckIcon size={18} /></span>
              <span className="income-kpi-label">Conversion Rate</span>
              <em className={analytics.cancellationRate <= 20 ? 'is-up' : 'is-down'}>{analytics.cancellationRate.toFixed(1)}% cancel</em>
            </div>
            <strong>{analytics.conversionRate.toFixed(1)}%</strong>
            <small>Completed vs total owner bookings</small>
          </article>
          <article className="income-kpi-card">
            <div className="income-kpi-head">
              <span className="income-kpi-icon"><StarIcon size={18} /></span>
              <span className="income-kpi-label">Average Order Value</span>
              <em className="is-up">{currencyFormatter.format(analytics.avgOrderValue)}</em>
            </div>
            <strong>{currencyFormatter.format(analytics.avgOrderValue)}</strong>
            <small>Revenue per completed booking</small>
          </article>
          <article className="income-kpi-card">
            <div className="income-kpi-head">
              <span className="income-kpi-icon"><UploadIcon size={18} /></span>
              <span className="income-kpi-label">Deposit Refunds</span>
              <em className={wallet.totalDepositRefunds > 0 ? 'is-up' : ''}>{wallet.totalDepositRefunds > 0 ? 'Returned' : 'None yet'}</em>
            </div>
            <strong>{currencyFormatter.format(wallet.totalDepositRefunds)}</strong>
            <small>Security deposits returned to your account</small>
          </article>
        </section>

        <section className="income-analytics-panels">
          <article className="income-analytics-panel">
            <h3>Revenue Over Time</h3>
            <div className="income-revenue-chart">
              {analytics.revenueSeries.map((point) => (
                <div key={point.key}>
                  <small>{point.label}</small>
                  <span style={{ height: `${Math.max(8, (point.value / analytics.maxRevenuePoint) * 100)}%` }} />
                  <em>{currencyFormatter.format(point.value)}</em>
                </div>
              ))}
            </div>
          </article>

          <article className="income-analytics-panel">
            <h3>Sales by Category</h3>
            <div className="income-category-list">
              {analytics.categorySales.length ? (
                analytics.categorySales.map((entry) => {
                  const share = analytics.categoryTotal > 0 ? (entry.amount / analytics.categoryTotal) * 100 : 0;
                  return (
                    <div key={`cat-${entry.name}`}>
                      <span>{entry.name}</span>
                      <strong>{share.toFixed(0)}%</strong>
                    </div>
                  );
                })
              ) : (
                <p>No category sales yet.</p>
              )}
            </div>
          </article>
        </section>

        <section className="income-analytics-panels">
          <article className="income-analytics-panel">
            <h3>Top Performing Products</h3>
            <div className="income-top-products">
              {analytics.topProducts.length ? (
                analytics.topProducts.map((product) => (
                  <div key={`prod-${product.title}`}>
                    <span>{product.title}</span>
                    <em>{product.orders} orders</em>
                    <strong>{currencyFormatter.format(product.revenue)}</strong>
                  </div>
                ))
              ) : (
                <p>No completed product sales yet.</p>
              )}
            </div>
          </article>

          <article className="income-analytics-panel">
            <h3>Regional Sales</h3>
            <div className="income-regional-list">
              {analytics.regionalSales.length ? (
                analytics.regionalSales.map((entry) => {
                  const share = analytics.regionalTotal > 0 ? (entry.amount / analytics.regionalTotal) * 100 : 0;
                  return (
                    <div key={`region-${entry.name}`}>
                      <div>
                        <span>{entry.name}</span>
                        <strong>{share.toFixed(0)}%</strong>
                      </div>
                      <i>
                        <b style={{ width: `${share}%` }} />
                      </i>
                    </div>
                  );
                })
              ) : (
                <p>No regional revenue yet.</p>
              )}
            </div>
          </article>
        </section>

        <Panel className="income-history-panel">
          <div className="income-history-section">
            <div className="income-history-header">
              <div>
                <h3>Transaction History</h3>
                <span>Booking, rental, and purchase money activity.</span>
              </div>
              <strong>{filteredHistory.length} of {wallet.transactionHistory.length} transactions</strong>
            </div>

            <div className="income-history-filters">
              <label className="income-history-search">Search<input onChange={(event) => { setHistoryFilters((current) => ({ ...current, query: event.target.value })); setHistoryPage(1); }} placeholder="Item, description, or period" type="search" value={historyFilters.query} /></label>
              <label>Type<select onChange={(event) => { setHistoryFilters((current) => ({ ...current, type: event.target.value })); setHistoryPage(1); }} value={historyFilters.type}><option value="all">All types</option>{historyTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
              <label>Status<select onChange={(event) => { setHistoryFilters((current) => ({ ...current, status: event.target.value })); setHistoryPage(1); }} value={historyFilters.status}><option value="all">All statuses</option>{historyStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
              <label>Start date<input onChange={(event) => { setHistoryFilters((current) => ({ ...current, startDate: event.target.value })); setHistoryPage(1); }} type="date" value={historyFilters.startDate} /></label>
              <label>End date<input onChange={(event) => { setHistoryFilters((current) => ({ ...current, endDate: event.target.value })); setHistoryPage(1); }} type="date" value={historyFilters.endDate} /></label>
              <button className="income-history-reset" onClick={() => { setHistoryFilters({ startDate: '', endDate: '', type: 'all', status: 'all', query: '' }); setHistoryPage(1); }} type="button">Clear</button>
              <button className="income-history-export" disabled={!filteredHistory.length} onClick={exportHistoryPdf} type="button">Export PDF</button>
            </div>

            {paginatedHistory.length ? (
              <div className="income-history-table-wrap">
                <table className="income-history-table">
                  <thead>
                    <tr>
                      <th>Transaction</th>
                      <th>Type</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Booked</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedHistory.map((entry) => (
                      <tr key={entry.id}>
                        <td data-label="Transaction">
                          <div className="income-history-title">
                            <strong>{entry.itemTitle}</strong>
                            <span>{entry.helperText}</span>
                          </div>
                        </td>
                        <td data-label="Type">
                          <Badge tone={getHistoryTone(entry.transactionType)}>{entry.transactionType}</Badge>
                        </td>
                        <td data-label="Period">{entry.periodLabel}</td>
                        <td data-label="Status">{entry.statusLabel}</td>
                        <td data-label="Booked">{formatDate(entry.date)}</td>
                        <td data-label="Amount">
                          <strong className={`income-history-amount ${entry.transactionType === 'You Earned' ? 'is-earned' : ''}`}>
                            {currencyFormatter.format(entry.amount)}
                          </strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <StatusMessage tone="info">{wallet.transactionHistory.length ? 'No transactions match these filters.' : 'No wallet activity yet.'}</StatusMessage>
            )}

            {filteredHistory.length > TRANSACTIONS_PER_PAGE ? (
              <div className="income-history-pagination">
                <button
                  disabled={historyPage === 1}
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                  type="button"
                >
                  Prev
                </button>

                <div className="income-history-pages">
                  {Array.from({ length: totalHistoryPages }, (_, index) => index + 1).map((pageNumber) => (
                    <button
                      className={pageNumber === historyPage ? 'active' : ''}
                      key={pageNumber}
                      onClick={() => setHistoryPage(pageNumber)}
                      type="button"
                    >
                      {pageNumber}
                    </button>
                  ))}
                </div>

                <button
                  disabled={historyPage === totalHistoryPages}
                  onClick={() => setHistoryPage((page) => Math.min(totalHistoryPages, page + 1))}
                  type="button"
                >
                  Next
                </button>
              </div>
            ) : null}

            <span className="income-history-count">
              Showing {historyStart}-{historyEnd} of {filteredHistory.length} transactions
            </span>
          </div>
        </Panel>

        {ownerBookings.length === 0 && borrowerBookings.length === 0 && purchaseRequests.length === 0 ? (
          <StatusMessage tone="info">No wallet activity yet. Once renters book your items, transactions will appear here.</StatusMessage>
        ) : null}
      </div>
    </UserShell>
  );
}
