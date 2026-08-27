import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import AdminShell from './AdminShell';
import './AdminDashboard.css';
import { CalendarIcon, CatalogIcon, CheckIcon, ReportIcon, SearchIcon, ShieldIcon, UsersIcon } from '../../ui/icons';
import { Badge, StatusMessage } from '../../ui/primitives';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  maximumFractionDigits: 0,
  style: 'currency',
});

const percentFormatter = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 0,
  style: 'percent',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const EMPTY_ANALYTICS = {
  accountRestrictions: [],
  bookings: [],
  categories: [],
  counts: {
    activeUsers: 0,
    bookings: 0,
    damageClaims: 0,
    items: 0,
    profiles: 0,
    purchaseRequests: 0,
    reports: 0,
    reviews: 0,
    transactions: 0,
  },
  damageClaims: [],
  errors: [],
  items: [],
  profiles: [],
  purchaseRequests: [],
  reports: [],
  reviews: [],
  transactions: [],
};

function startOfLastNDays(days) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days + 1);
  return date;
}

function normalizeStatus(status) {
  return String(status || 'unknown').trim().toLowerCase() || 'unknown';
}

function formatDate(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No date' : dateFormatter.format(date);
}

function formatLabel(value) {
  return String(value || 'Unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toNumber(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : 0;
}

function countByStatus(records) {
  return (records || []).reduce((counts, record) => {
    const status = normalizeStatus(record.status);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function sumBy(records, reader) {
  return (records || []).reduce((total, record) => total + toNumber(reader(record)), 0);
}

function isWithinDate(value, startDate) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= startDate;
}

function statusTone(status) {
  const normalized = normalizeStatus(status);
  if (['active', 'approved', 'available', 'completed', 'confirmed', 'paid', 'recorded', 'resolved', 'returned', 'verified'].includes(normalized)) return 'success';
  if (['cancelled', 'failed', 'inactive', 'rejected', 'unavailable'].includes(normalized)) return 'danger';
  if (['awaiting_payment', 'open', 'pending', 'pending_admin_review', 'reserved'].includes(normalized)) return 'warning';
  return 'info';
}

function buildTopCategories(items, categories) {
  const categoryById = new Map((categories || []).map((category) => [category.id, category.name]));
  const counts = new Map();

  (items || []).forEach((item) => {
    const key = item.category_id || 'uncategorized';
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([categoryId, count]) => ({
      count,
      label: categoryId === 'uncategorized' ? 'Uncategorized' : categoryById.get(categoryId) || 'Unknown category',
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);
}

function buildRecentActivity(analytics) {
  const activity = [];

  analytics.bookings.forEach((booking) => {
    activity.push({
      amount: toNumber(booking.total_due) ? currencyFormatter.format(toNumber(booking.total_due)) : '-',
      date: booking.created_at || booking.requested_start,
      detail: booking.item_id ? `Item: ${booking.item_id}` : 'Rental request',
      id: booking.id,
      label: 'Rental Booking',
      status: booking.status,
      type: 'booking',
    });
  });

  analytics.transactions.forEach((transaction) => {
    activity.push({
      amount: currencyFormatter.format(toNumber(transaction.amount)),
      date: transaction.transaction_at,
      detail: `Transaction ID: ${transaction.id}`,
      id: transaction.booking_id || transaction.damage_claim_id || transaction.id,
      label: 'Payment',
      status: transaction.status,
      type: 'payment',
    });
  });

  analytics.damageClaims.forEach((claim) => {
    activity.push({
      amount: currencyFormatter.format(toNumber(claim.amount_due || claim.admin_approved_amount || claim.claimed_amount)),
      date: claim.reviewed_at || claim.created_at,
      detail: claim.booking_id ? `Booking: ${claim.booking_id}` : 'Damage review',
      id: claim.id,
      label: 'Damage Claim',
      status: claim.status,
      type: 'damage',
    });
  });

  analytics.purchaseRequests.forEach((request) => {
    const totalAmount = request.sale_total_amount_snapshot || request.sale_price_snapshot;

    activity.push({
      amount: toNumber(totalAmount) ? currencyFormatter.format(toNumber(totalAmount)) : '-',
      date: request.completed_at || request.paid_at || request.reviewed_at || request.requested_at || request.created_at,
      detail: request.item_id ? `Item: ${request.item_id}` : 'Purchase request',
      id: request.id,
      label: 'Purchase Request',
      status: request.status,
      type: 'purchase',
    });
  });

  return activity
    .filter((item) => item.date)
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

async function runQuery(label, query) {
  let result;
  try {
    result = await query;
  } catch (error) {
    return { data: [], error: `${label}: ${error.message}` };
  }
  if (result.error) return { data: [], error: `${label}: ${result.error.message}` };
  return { data: result.data || [], error: '' };
}

async function runCount(label, query) {
  let result;
  try {
    result = await query;
  } catch (error) {
    return { count: 0, error: `${label}: ${error.message}` };
  }
  if (result.error) return { count: 0, error: `${label}: ${result.error.message}` };
  return { count: result.count || 0, error: '' };
}

function MiniKpiCard({ accent = 'blue', detail, icon, label, subdetail, value }) {
  return (
    <article className={`admin-mini-card ${accent}`}>
      <div className="admin-mini-topline">
        <span className="admin-mini-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
      {subdetail ? <em>{subdetail}</em> : null}
    </article>
  );
}

function CompactPanel({ action, children, className = '', subtitle, title }) {
  return (
    <section className={`admin-compact-panel ${className}`.trim()}>
      <div className="admin-panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div className="admin-panel-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function BreakdownRows({ color = 'blue', compact = false, items }) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  if (!items.length) return <span className="admin-empty-text">No records yet.</span>;

  return (
    <div className={compact ? 'admin-breakdown compact' : 'admin-breakdown'}>
      {items.map((item) => (
        <div className="admin-breakdown-row" key={item.label}>
          <div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
          <div className="admin-breakdown-track">
            <span className={color} style={{ width: `${Math.max(6, (item.value / maxValue) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PillList({ items }) {
  if (!items.length) return <span className="admin-empty-text">No categories yet.</span>;

  return (
    <div className="admin-pill-list">
      {items.map((item) => (
        <span key={item.label}>{item.label} ({item.count})</span>
      ))}
    </div>
  );
}

function ActivityTable({ items, query, setQuery }) {
  const visibleItems = items
    .filter((item) => {
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) return true;
      return [item.label, item.id, item.detail, item.status, item.amount].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 8);

  return (
    <section className="admin-activity-card">
      <div className="admin-activity-header">
        <h2>Recent System Activity</h2>
        <label className="admin-activity-search">
          <SearchIcon size={16} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Filter activity..." value={query} />
        </label>
      </div>
      <div className="admin-activity-table-wrap">
        <table className="admin-activity-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Entity / ID</th>
              <th>Date</th>
              <th>Status</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={`${item.type}-${item.id}-${item.date}`}>
                <td><span className={`admin-activity-type ${item.type}`}>{item.label}</span></td>
                <td><strong>{item.id}</strong><small>{item.detail}</small></td>
                <td>{formatDate(item.date)}</td>
                <td><Badge tone={statusTone(item.status)}>{formatLabel(item.status)}</Badge></td>
                <td>{item.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleItems.length ? <div className="admin-table-empty">No activity matches the current filter.</div> : null}
      </div>
      <div className="admin-activity-footer">Showing {visibleItems.length} of {items.length} activities</div>
    </section>
  );
}

export default function AdminDashboard() {
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [activityQuery, setActivityQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function fetchAnalytics() {
      setLoading(true);

      const [profileRows, activeUsersCount, itemRows, categoryRows, bookingRows, transactionRows, reportRows, damageRows, restrictionRows, reviewRows, purchaseRows] = await Promise.all([
        runQuery('profiles', supabase.from('profiles').select('id, role, account_status, nub_registry_managed, is_profile_complete, created_at').order('created_at', { ascending: false }).limit(500)),
        runCount('active profiles', supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'active')),
        runQuery('items', supabase.from('items').select('id, category_id, owner_id, status, is_active, rental_price_per_day, security_deposit, created_at, updated_at').order('created_at', { ascending: false }).limit(500)),
        runQuery('categories', supabase.from('categories').select('id, name, parent_category_id, is_active').order('name', { ascending: true }).limit(300)),
        runQuery('bookings', supabase.from('bookings').select('id, item_id, borrower_id, owner_id, status, total_due, rental_fee_total, security_deposit, requested_start, requested_end, created_at').order('created_at', { ascending: false }).limit(500)),
        runQuery('payment_transactions', supabase.from('payment_transactions').select('id, booking_id, damage_claim_id, transaction_type, amount, payment_method, status, transaction_at').order('transaction_at', { ascending: false }).limit(500)),
        runQuery('reports', supabase.from('reports').select('id, report_type, status, created_at').order('created_at', { ascending: false }).limit(300)),
        runQuery('damage_claims', supabase.from('damage_claims').select('id, booking_id, claimed_amount, admin_approved_amount, amount_due, status, created_at, reviewed_at').order('created_at', { ascending: false }).limit(300)),
        runQuery('account_restrictions', supabase.from('account_restrictions').select('id, user_id, restriction_type, status, started_at, lifted_at').order('started_at', { ascending: false }).limit(300)),
        runQuery('reviews', supabase.from('reviews').select('id, rating, created_at').order('created_at', { ascending: false }).limit(300)),
        runQuery(
          'item_purchase_requests',
          supabase
            .from('item_purchase_requests')
            .select(
              'id, item_id, buyer_id, seller_id, sale_price_snapshot, sale_total_amount_snapshot, buyer_requested_quantity, seller_approved_quantity, status, requested_at, reviewed_at, paid_at, completed_at, created_at, updated_at'
            )
            .order('created_at', { ascending: false })
            .limit(300)
        ),
      ]);

      if (!mounted) return;

      setAnalytics({
        accountRestrictions: restrictionRows.data,
        bookings: bookingRows.data,
        categories: categoryRows.data,
        counts: {
          activeUsers: activeUsersCount.count,
          bookings: bookingRows.data.length,
          damageClaims: damageRows.data.length,
          items: itemRows.data.length,
          profiles: profileRows.data.length,
          purchaseRequests: purchaseRows.data.length,
          reports: reportRows.data.length,
          reviews: reviewRows.data.length,
          transactions: transactionRows.data.length,
        },
        damageClaims: damageRows.data,
        errors: [profileRows.error, activeUsersCount.error, itemRows.error, categoryRows.error, bookingRows.error, transactionRows.error, reportRows.error, damageRows.error, restrictionRows.error, reviewRows.error, purchaseRows.error].filter(Boolean),
        items: itemRows.data,
        profiles: profileRows.data,
        purchaseRequests: purchaseRows.data,
        reports: reportRows.data,
        reviews: reviewRows.data,
        transactions: transactionRows.data,
      });
      setLoading(false);
    }

    fetchAnalytics();
    return () => {
      mounted = false;
    };
  }, []);

  const summary = useMemo(() => {
    const last30Start = startOfLastNDays(30);
    const bookingStatuses = countByStatus(analytics.bookings);
    const itemStatuses = countByStatus(analytics.items);
    const damageStatuses = countByStatus(analytics.damageClaims);
    const paidTransactions = analytics.transactions.filter((transaction) => ['paid', 'recorded', 'completed', 'success'].includes(normalizeStatus(transaction.status)));
    const pendingTransactions = analytics.transactions.filter((transaction) => ['pending', 'awaiting_payment'].includes(normalizeStatus(transaction.status)));
    const activeRestrictions = analytics.accountRestrictions.filter((restriction) => normalizeStatus(restriction.status) === 'active' && normalizeStatus(restriction.restriction_type) === 'damage_hold');
    const pendingDamageClaims = analytics.damageClaims.filter((claim) => normalizeStatus(claim.status) === 'pending_admin_review');
    const openReports = analytics.reports.filter((report) => ['open', 'pending'].includes(normalizeStatus(report.status)));
    const pendingBookings = analytics.bookings.filter((booking) => normalizeStatus(booking.status) === 'pending');
    const completedBookings = analytics.bookings.filter((booking) => ['completed', 'returned'].includes(normalizeStatus(booking.status)));
    const awaitingDamagePayment = analytics.damageClaims.filter((claim) => ['approved', 'awaiting_payment'].includes(normalizeStatus(claim.status)));
    const totalPotentialRentalValue = sumBy(analytics.bookings, (booking) => booking.total_due || booking.rental_fee_total);
    const last30Bookings = analytics.bookings.filter((booking) => isWithinDate(booking.created_at, last30Start));
    const last30Revenue = sumBy(paidTransactions.filter((transaction) => isWithinDate(transaction.transaction_at, last30Start)), (transaction) => transaction.amount);
    const totalRevenue = sumBy(paidTransactions, (transaction) => transaction.amount);
    const pendingPaymentAmount = sumBy(pendingTransactions, (transaction) => transaction.amount);
    const damageExposure = sumBy(awaitingDamagePayment, (claim) => claim.amount_due || claim.admin_approved_amount || claim.claimed_amount);
    const averageRating = analytics.reviews.length ? sumBy(analytics.reviews, (review) => review.rating) / analytics.reviews.length : 0;
    const studentProfiles = analytics.profiles.filter((profile) => String(profile.role || '').toLowerCase() !== 'admin');
    const registryMembers = studentProfiles.filter((profile) => profile.nub_registry_managed);
    const incompleteProfiles = studentProfiles.filter((profile) => !profile.is_profile_complete);
    const registryStatuses = {
      'Registry linked': registryMembers.length,
      'Legacy or unlinked': Math.max(studentProfiles.length - registryMembers.length, 0),
    };

    return {
      activeRestrictions,
      averageRating,
      bookingCompletionRate: analytics.bookings.length ? completedBookings.length / analytics.bookings.length : 0,
      bookingStatuses,
      damageExposure,
      damageStatuses,
      itemStatuses,
      incompleteProfiles,
      last30Bookings,
      last30Revenue,
      openReports,
      pendingBookings,
      pendingDamageClaims,
      pendingPaymentAmount,
      studentProfiles,
      topCategories: buildTopCategories(analytics.items, analytics.categories),
      totalPotentialRentalValue,
      totalRevenue,
      registryRate: studentProfiles.length ? registryMembers.length / studentProfiles.length : 0,
      registryStatuses,
    };
  }, [analytics]);

  const recentActivity = useMemo(() => buildRecentActivity(analytics), [analytics]);
  const bookingBreakdown = useMemo(() => Object.entries(summary.bookingStatuses).map(([label, value]) => ({ label: formatLabel(label), value })), [summary.bookingStatuses]);
  const registryBreakdown = useMemo(() => Object.entries(summary.registryStatuses).map(([label, value]) => ({ label, value })), [summary.registryStatuses]);
  const damageBreakdown = useMemo(() => Object.entries(summary.damageStatuses).map(([label, value]) => ({ label: formatLabel(label), value })), [summary.damageStatuses]);

  return (
    <AdminShell subtitle="" title="">
      <div className="admin-analytics-page">
        {analytics.errors.length ? (
          <StatusMessage tone="warning">
            Partial analytics loaded. Check these Supabase queries: {analytics.errors.slice(0, 4).join(' ')}
            {analytics.errors.length > 4 ? ` and ${analytics.errors.length - 4} more.` : ''}
          </StatusMessage>
        ) : null}

        <div className="admin-mini-grid">
          <MiniKpiCard accent="blue" detail={`${percentFormatter.format(summary.registryRate || 0)} registry linked`} icon={<UsersIcon size={14} />} label="Students" value={loading ? '...' : summary.studentProfiles.length} />
          <MiniKpiCard accent="blue" detail={`${summary.pendingBookings.length} waiting`} icon={<CalendarIcon size={14} />} label="Bookings" subdetail={`${summary.pendingBookings.length} active`} value={loading ? '...' : analytics.counts.bookings} />
          <MiniKpiCard accent="blue" detail="Last 30 days" icon={<CheckIcon size={14} />} label="Payments" value={loading ? '...' : currencyFormatter.format(summary.last30Revenue)} />
          <MiniKpiCard accent="risk" detail={`${summary.activeRestrictions.length} Active Hold`} icon={<ShieldIcon size={14} />} label="Risk Queue" value={loading ? '...' : summary.pendingDamageClaims.length + summary.openReports.length} />
          <MiniKpiCard accent="blue" detail={`${analytics.categories.length} Categories`} icon={<CatalogIcon size={14} />} label="Catalog" value={loading ? '...' : analytics.counts.items} />
          <MiniKpiCard accent="solid" detail={`${currencyFormatter.format(summary.totalPotentialRentalValue)} Potential`} icon={<ReportIcon size={14} />} label="30d Value" value={loading ? '...' : currencyFormatter.format(summary.last30Revenue || summary.totalRevenue)} />
        </div>

        <div className="admin-dashboard-row top-panels">
          <CompactPanel title="Rental Booking Status">
            <BreakdownRows color="blue" items={bookingBreakdown} />
          </CompactPanel>

          <CompactPanel className="dark" title="Admin Workload">
            <div className="admin-workload-compact">
              <WorkloadTile label="Profile Setup" value={summary.incompleteProfiles.length} />
              <WorkloadTile label="Reports" value={summary.openReports.length} />
              <WorkloadTile label="Damage Holds" value={summary.activeRestrictions.length} />
              <WorkloadTile label="Reviews" value={analytics.counts.reviews} />
            </div>
          </CompactPanel>

          <CompactPanel title="Flow Health Metrics">
            <div className="admin-flow-metrics">
              <div><strong>{summary.averageRating ? summary.averageRating.toFixed(1) : '0.0'}</strong><span>Avg Score</span></div>
              <div><strong>{percentFormatter.format(summary.bookingCompletionRate || 0)}</strong><span>Completion</span></div>
            </div>
            <div className="admin-flow-lines">
              <span>Browse/Listings <strong>{analytics.counts.items}</strong></span>
              <span>Booking Requests <strong>{analytics.counts.bookings}</strong></span>
            </div>
          </CompactPanel>
        </div>

        <div className="admin-dashboard-row mid-panels">
          <CompactPanel action={<button className="admin-link-button" type="button">Detailed Audit</button>} className="wide" title="Student Registry & Categories">
            <div className="admin-dual-breakdown">
              <div>
                <span className="admin-small-heading">Registry-linked members</span>
                <BreakdownRows color="blue" compact items={registryBreakdown} />
              </div>
              <div>
                <span className="admin-small-heading">Top Categories</span>
                <PillList items={summary.topCategories} />
              </div>
            </div>
          </CompactPanel>

          <CompactPanel className="damage-focus" subtitle="High priority review items." title="Damage Claim Status">
            <div className="admin-damage-callout">
              <span>{damageBreakdown[0]?.label || 'No Open Claims'}</span>
              <strong>{damageBreakdown[0]?.value || 0} Case{(damageBreakdown[0]?.value || 0) === 1 ? '' : 's'}</strong>
              <em aria-hidden="true">›</em>
            </div>
          </CompactPanel>
        </div>

        <ActivityTable items={recentActivity} query={activityQuery} setQuery={setActivityQuery} />
      </div>
    </AdminShell>
  );
}

function WorkloadTile({ label, value }) {
  return (
    <div className="admin-workload-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

