import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { getDamageClaimsForBorrower, userHasActiveDamageHold } from '../../services/damageClaimsService';
import { Button, Modal, StatusMessage } from '../../ui/primitives';
import UserShell from './UserShell';
import './UserDashboard.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const manilaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Manila',
  year: 'numeric',
});

function getManilaDateKey(dateValue = new Date()) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const parts = manilaDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function addDays(dateValue, days) {
  const date = new Date(dateValue);
  date.setDate(date.getDate() + days);
  return date;
}

function getLastNDaysKeys(days = 7) {
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const offset = days - index - 1;
    return getManilaDateKey(addDays(today, -offset));
  });
}

function buildMonthKeys(monthCount = 6) {
  const now = new Date();
  return Array.from({ length: monthCount }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (monthCount - index - 1), 1);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${date.getFullYear()}-${month}`;
  });
}

function isOwnerRevenueBookingStatus(status) {
  return ['accepted', 'for_pickup', 'active', 'return_pending', 'completed', 'overdue', 'disputed'].includes(String(status || '').toLowerCase());
}

function isOwnerActiveBookingStatus(status) {
  return ['pending', 'accepted', 'for_pickup', 'active', 'return_pending', 'overdue', 'disputed'].includes(String(status || '').toLowerCase());
}

function isPurchaseRevenueStatus(status) {
  return ['paid', 'ready_for_pickup', 'completed'].includes(String(status || '').toLowerCase());
}

function isPurchaseActiveStatus(status) {
  return ['pending', 'approved', 'awaiting_payment', 'paid', 'ready_for_pickup'].includes(String(status || '').toLowerCase());
}

function formatStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();

  if (!normalized) return 'Unknown';

  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatOrderDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatOrderCode(order) {
  const idText = String(order?.id || '').replace(/-/g, '').toUpperCase();
  if (idText.length >= 6) {
    return `#PH-${idText.slice(0, 6)}`;
  }

  return '';
}

function parseDateOrNull(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTimelineDate(value) {
  const parsed = parseDateOrNull(value);
  if (!parsed) {
    return '';
  }

  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(parsed);
}

function trackingStage(status) {
  const normalized = String(status || '').toLowerCase();

  if (['completed'].includes(normalized)) return 5;
  if (['active', 'return_pending', 'overdue', 'disputed'].includes(normalized)) return 4;
  if (['for_pickup'].includes(normalized)) return 3;
  if (['accepted'].includes(normalized)) return 2;
  return 1;
}

function buildTrackingTimeline(order) {
  if (!order) {
    return [];
  }

  const normalizedStatus = String(order.status || '').toLowerCase();
  const stage = trackingStage(normalizedStatus);
  const meetups = Array.isArray(order.meetups) ? order.meetups : [];
  const pickupMeetup = meetups.find((meetup) => String(meetup.meetup_type || '').toLowerCase() === 'pickup');
  const returnMeetup = meetups.find((meetup) => String(meetup.meetup_type || '').toLowerCase() === 'return');
  const isCancelled = normalizedStatus === 'cancelled';
  const isRejected = normalizedStatus === 'rejected';

  const timeline = [
    {
      dateText: formatTimelineDate(order.created_at),
      done: true,
      key: 'requested',
      label: 'Requested',
    },
    {
      dateText: stage >= 2 ? formatTimelineDate(order.updated_at) : '',
      done: stage >= 2,
      key: 'accepted',
      label: 'Accepted',
    },
    {
      dateText: formatTimelineDate(pickupMeetup?.scheduled_at || order.approved_start || order.requested_start),
      done: stage >= 3,
      key: 'pickup',
      label: 'Pickup',
    },
    {
      dateText: formatTimelineDate(order.approved_start || order.requested_start),
      done: stage >= 4,
      key: 'on-rent',
      label: 'On Rent',
    },
    {
      dateText: formatTimelineDate(returnMeetup?.scheduled_at || order.approved_end || order.requested_end || order.updated_at),
      done: stage >= 5,
      key: 'returned',
      label: 'Returned',
    },
  ];

  if (isCancelled) {
    timeline[4] = {
      dateText: formatTimelineDate(order.updated_at),
      done: true,
      key: 'cancelled',
      label: 'Cancelled',
    };
  }

  if (isRejected) {
    timeline[1] = {
      dateText: formatTimelineDate(order.updated_at),
      done: true,
      key: 'rejected',
      label: 'Rejected',
    };
    timeline.splice(2);
  }

  return timeline;
}

export default function UserDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState([]);
  const [savedRentCount, setSavedRentCount] = useState(0);
  const [analyticsMode, setAnalyticsMode] = useState('weekly');
  const [ownerAnalytics, setOwnerAnalytics] = useState({
    activeOrderCount: 0,
    completedOrderCount: 0,
    lowStockCount: 0,
    monthlyTrend: [],
    overdueCount: 0,
    pendingPurchaseCount: 0,
    recentTransactions: [],
    storeVisitors: 0,
    todaySales: 0,
    totalSales: 0,
    unreadMessages: 0,
    weeklyTrend: [],
    yesterdaySales: 0,
    yesterdayVisitors: 0,
  });

  const [activeDamageHold, setActiveDamageHold] = useState(false);
  const [pendingDamageClaim, setPendingDamageClaim] = useState(null);
  const [pendingDamageItemTitle, setPendingDamageItemTitle] = useState('');
  const [pendingDamageSellerName, setPendingDamageSellerName] = useState('');
  const [showDamageHoldModal, setShowDamageHoldModal] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard() {
      setLoading(true);
      setError('');

      const { data: authData, error: authError } = await supabase.auth.getUser();

      if (!mounted) return;

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      const userId = authData?.user?.id;
      if (!userId) {
        navigate('/login');
        return;
      }

      const [ordersResult, savedRentResult, hasHold, borrowerClaims] = await Promise.all([
        supabase
          .from('bookings')
          .select('id, item_id, status, total_due, created_at, updated_at, requested_start, requested_end, approved_start, approved_end')
          .eq('borrower_id', userId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('saved_rent_items')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        userHasActiveDamageHold(userId),
        getDamageClaimsForBorrower(userId),
      ]);

      if (!mounted) return;

      const nextErrors = [];

      if (ordersResult.error) nextErrors.push(`orders: ${ordersResult.error.message}`);

      const savedRentMissingTable = savedRentResult.error && /does not exist|relation/i.test(String(savedRentResult.error.message || ''));
      if (savedRentResult.error && !savedRentMissingTable) {
        nextErrors.push(`saved listings: ${savedRentResult.error.message}`);
      }

      const rawOrders = ordersResult.data || [];
      const orderIds = Array.from(new Set(rawOrders.map((order) => order.id).filter(Boolean)));
      const itemIds = Array.from(new Set(rawOrders.map((order) => order.item_id).filter(Boolean)));

      const meetupsResult = orderIds.length
        ? await supabase
            .from('booking_meetups')
            .select('id, booking_id, meetup_type, scheduled_at, status')
            .in('booking_id', orderIds)
            .order('scheduled_at', { ascending: true })
        : { data: [], error: null };

      let itemTitleMap = new Map();
      if (itemIds.length) {
        const itemsResult = await supabase
          .from('items')
          .select('id, title')
          .in('id', itemIds);

        if (itemsResult.error) {
          nextErrors.push(`order items: ${itemsResult.error.message}`);
        } else {
          itemTitleMap = new Map((itemsResult.data || []).map((item) => [item.id, item.title]));
        }
      }

      const meetupsMissingTable = meetupsResult.error && /does not exist|relation/i.test(String(meetupsResult.error.message || ''));
      if (meetupsResult.error && !meetupsMissingTable) {
        nextErrors.push(`booking meetups: ${meetupsResult.error.message}`);
      }

      const meetupsByBookingId = new Map();
      (meetupsResult.data || []).forEach((meetup) => {
        const current = meetupsByBookingId.get(meetup.booking_id) || [];
        current.push(meetup);
        meetupsByBookingId.set(meetup.booking_id, current);
      });

      const nextOrders = rawOrders.map((order) => ({
        ...order,
        meetups: meetupsByBookingId.get(order.id) || [],
        orderCode: formatOrderCode(order),
        itemTitle: itemTitleMap.get(order.item_id) || order.item_id || '',
      }));

      setOrders(nextOrders);
      setSavedRentCount(savedRentResult.count || 0);

      const [ownerBookingsResult, ownerItemsResult, ownerPurchaseRequestsResult, conversationMembersResult] = await Promise.all([
        supabase
          .from('bookings')
          .select('id, item_id, status, total_due, rental_fee_total, created_at, updated_at')
          .eq('owner_id', userId)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('items')
          .select('id, title, quantity, status, is_active')
          .eq('owner_id', userId)
          .eq('is_active', true),
        supabase
          .from('item_purchase_requests')
          .select('id, item_id, status, sale_total_amount_snapshot, sale_price_snapshot, seller_approved_quantity, created_at, updated_at')
          .eq('seller_id', userId)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('conversation_members').select('conversation_id').eq('user_id', userId),
      ]);

      if (ownerBookingsResult.error) {
        nextErrors.push(`owner bookings: ${ownerBookingsResult.error.message}`);
      }
      if (ownerItemsResult.error) {
        nextErrors.push(`owner items: ${ownerItemsResult.error.message}`);
      }
      if (ownerPurchaseRequestsResult.error) {
        nextErrors.push(`owner purchase requests: ${ownerPurchaseRequestsResult.error.message}`);
      }
      if (conversationMembersResult.error) {
        nextErrors.push(`conversation members: ${conversationMembersResult.error.message}`);
      }

      const ownerBookings = ownerBookingsResult.data || [];
      const ownerItems = ownerItemsResult.data || [];
      const ownerPurchaseRequests = ownerPurchaseRequestsResult.data || [];
      const ownerItemIds = ownerItems.map((item) => item.id);

      const weekKeys = getLastNDaysKeys(7);
      const todayKey = weekKeys[weekKeys.length - 1];
      const yesterdayKey = weekKeys[weekKeys.length - 2] || '';
      const earliestWeekDate = weekKeys[0];
      const monthKeys = buildMonthKeys(6);
      const weekRevenueMap = new Map(weekKeys.map((key) => [key, 0]));
      const monthRevenueMap = new Map(monthKeys.map((key) => [key, 0]));

      const revenueRows = [];
      ownerBookings
        .filter((booking) => isOwnerRevenueBookingStatus(booking.status))
        .forEach((booking) => {
          const amount = Number(booking.rental_fee_total ?? booking.total_due) || 0;
          if (amount <= 0) return;
          revenueRows.push({ amount, createdAt: booking.created_at, kind: 'rental', source: booking });
        });
      ownerPurchaseRequests
        .filter((request) => isPurchaseRevenueStatus(request.status))
        .forEach((request) => {
          const qty = Number(request.seller_approved_quantity) || 1;
          const amount = Number(request.sale_total_amount_snapshot) || (Number(request.sale_price_snapshot) || 0) * qty;
          if (amount <= 0) return;
          revenueRows.push({ amount, createdAt: request.created_at, kind: 'purchase', source: request });
        });

      revenueRows.forEach((row) => {
        const dayKey = getManilaDateKey(row.createdAt);
        const monthKey = dayKey ? dayKey.slice(0, 7) : '';

        if (weekRevenueMap.has(dayKey)) {
          weekRevenueMap.set(dayKey, (weekRevenueMap.get(dayKey) || 0) + row.amount);
        }

        if (monthRevenueMap.has(monthKey)) {
          monthRevenueMap.set(monthKey, (monthRevenueMap.get(monthKey) || 0) + row.amount);
        }
      });

      const weeklyTrend = weekKeys.map((key) => ({
        key,
        label: key.slice(5),
        value: Number((weekRevenueMap.get(key) || 0).toFixed(2)),
      }));
      const monthlyTrend = monthKeys.map((key) => ({
        key,
        label: key,
        value: Number((monthRevenueMap.get(key) || 0).toFixed(2)),
      }));

      const todaySales = weekRevenueMap.get(todayKey) || 0;
      const yesterdaySales = weekRevenueMap.get(yesterdayKey) || 0;
      const totalSales = revenueRows.reduce((sum, row) => sum + row.amount, 0);
      const activeRentalOrders = ownerBookings.filter((booking) => isOwnerActiveBookingStatus(booking.status)).length;
      const pendingPurchaseCount = ownerPurchaseRequests.filter((request) => isPurchaseActiveStatus(request.status)).length;
      const overdueCount = ownerBookings.filter((booking) => String(booking.status || '').toLowerCase() === 'overdue').length;
      const completedOrderCount =
        ownerBookings.filter((booking) => String(booking.status || '').toLowerCase() === 'completed').length +
        ownerPurchaseRequests.filter((request) => String(request.status || '').toLowerCase() === 'completed').length;

      const lowStockItems = ownerItems.filter((item) => (Number(item.quantity) || 0) <= 2);

      const viewsResult = ownerItemIds.length
        ? await supabase
            .from('item_daily_view_counts')
            .select('item_id, viewed_date, total_views, unique_viewers')
            .eq('owner_id', userId)
            .in('item_id', ownerItemIds)
            .gte('viewed_date', earliestWeekDate)
        : { data: [], error: null };

      if (viewsResult.error) {
        nextErrors.push(`item daily views: ${viewsResult.error.message}`);
      }

      const visitorTotalsByDay = new Map(weekKeys.map((key) => [key, 0]));
      (viewsResult.data || []).forEach((row) => {
        const key = String(row.viewed_date || '');
        if (!visitorTotalsByDay.has(key)) return;
        visitorTotalsByDay.set(key, (visitorTotalsByDay.get(key) || 0) + (Number(row.unique_viewers) || 0));
      });

      const storeVisitors = weekKeys.reduce((sum, key) => sum + (visitorTotalsByDay.get(key) || 0), 0);
      const yesterdayVisitors = visitorTotalsByDay.get(yesterdayKey) || 0;

      const conversationIds = Array.from(
        new Set((conversationMembersResult.data || []).map((row) => row.conversation_id).filter(Boolean))
      );

      const unreadMessagesResult = conversationIds.length
        ? await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .in('conversation_id', conversationIds)
            .is('read_at', null)
            .neq('sender_id', userId)
        : { count: 0, error: null };

      if (unreadMessagesResult.error) {
        nextErrors.push(`unread messages: ${unreadMessagesResult.error.message}`);
      }

      if (!mounted) return;

      const recentTransactions = [
        ...ownerBookings.map((booking) => ({
          amount: Number(booking.rental_fee_total ?? booking.total_due) || 0,
          created_at: booking.created_at,
          id: booking.id,
          status: booking.status,
          type: 'rental',
        })),
        ...ownerPurchaseRequests.map((request) => ({
          amount:
            Number(request.sale_total_amount_snapshot) ||
            (Number(request.sale_price_snapshot) || 0) * (Number(request.seller_approved_quantity) || 1),
          created_at: request.created_at,
          id: request.id,
          status: request.status,
          type: 'sale',
        })),
      ]
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 6);

      setOwnerAnalytics({
        activeOrderCount: activeRentalOrders + pendingPurchaseCount,
        completedOrderCount,
        lowStockCount: lowStockItems.length,
        monthlyTrend,
        overdueCount,
        pendingPurchaseCount,
        recentTransactions,
        storeVisitors,
        todaySales,
        totalSales,
        unreadMessages: unreadMessagesResult.count || 0,
        weeklyTrend,
        yesterdaySales,
        yesterdayVisitors,
      });

      const pendingClaim =
        (borrowerClaims || []).find((claim) =>
          ['pending_admin_review', 'approved', 'awaiting_payment'].includes(String(claim.status || '').toLowerCase())
        ) || null;

      let nextItemTitle = '';
      let nextSellerName = '';
      if (pendingClaim?.item_id) {
        const { data: claimItem } = await supabase
          .from('items')
          .select('id, title, owner_id')
          .eq('id', pendingClaim.item_id)
          .maybeSingle();

        nextItemTitle = claimItem?.title || '';

        if (claimItem?.owner_id) {
          const { data: sellerProfile } = await supabase
            .from('profiles')
            .select('first_name, last_name, username')
            .eq('id', claimItem.owner_id)
            .maybeSingle();

          nextSellerName =
            [sellerProfile?.first_name, sellerProfile?.last_name].filter(Boolean).join(' ') ||
            sellerProfile?.username ||
            'Unknown seller';
        }
      }

      setActiveDamageHold(Boolean(hasHold));
      setPendingDamageClaim(pendingClaim);
      setPendingDamageItemTitle(nextItemTitle);
      setPendingDamageSellerName(nextSellerName);
      setShowDamageHoldModal(Boolean(hasHold && pendingClaim));

      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadDashboard();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  const totalOrders = orders.length;
  const recentOrders = useMemo(() => orders.slice(0, 6), [orders]);
  const activeOrder = useMemo(() => {
    const ongoing = orders.find((order) => !['completed', 'cancelled', 'rejected'].includes(String(order.status || '').toLowerCase()));
    return ongoing || orders[0] || null;
  }, [orders]);
  const activeOrderTimeline = useMemo(() => buildTrackingTimeline(activeOrder), [activeOrder]);
  const revenueTrendPoints = analyticsMode === 'monthly' ? ownerAnalytics.monthlyTrend : ownerAnalytics.weeklyTrend;
  const maxRevenuePoint = useMemo(
    () => Math.max(1, ...revenueTrendPoints.map((point) => Number(point.value) || 0)),
    [revenueTrendPoints]
  );
  const conversionRate = ownerAnalytics.storeVisitors > 0 ? (ownerAnalytics.completedOrderCount / ownerAnalytics.storeVisitors) * 100 : 0;
  const salesDeltaPercent =
    ownerAnalytics.yesterdaySales > 0 ? ((ownerAnalytics.todaySales - ownerAnalytics.yesterdaySales) / ownerAnalytics.yesterdaySales) * 100 : 0;
  const visitorDeltaPercent =
    ownerAnalytics.yesterdayVisitors > 0
      ? ((ownerAnalytics.storeVisitors - ownerAnalytics.yesterdayVisitors) / ownerAnalytics.yesterdayVisitors) * 100
      : 0;

  function handleCheckBalance() {
    if (!pendingDamageClaim) {
      navigate('/user/manage-booking');
      return;
    }

    const params = new URLSearchParams();
    params.set('damage_claim_id', pendingDamageClaim.id);
    if (pendingDamageClaim.booking_id) {
      params.set('booking_id', pendingDamageClaim.booking_id);
    }

    navigate(`/user/manage-booking?${params.toString()}`);
    setShowDamageHoldModal(false);
  }

  return (
    <UserShell subtitle="" title="">
      {activeDamageHold && pendingDamageClaim ? (
        <StatusMessage tone="warning">
          Your account is temporarily restricted due to a pending damage balance. Settle it first before new rentals/listings.
        </StatusMessage>
      ) : null}

      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
      {loading ? <StatusMessage tone="info">Loading dashboard...</StatusMessage> : null}

      <section className="mobile-dashboard-simple">
        <header className="mobile-dashboard-hero">
          <p>Welcome back</p>
          <h2>Overview</h2>
        </header>

        <div className="mobile-overview-grid">
          <article>
            <span>Today's Sales</span>
            <strong>{currencyFormatter.format(ownerAnalytics.todaySales || 0)}</strong>
            <small>{salesDeltaPercent >= 0 ? '+' : ''}{salesDeltaPercent.toFixed(1)}% vs yesterday</small>
          </article>
          <article className="is-highlight">
            <span>Pending Orders</span>
            <strong>{ownerAnalytics.activeOrderCount}</strong>
            <small>{ownerAnalytics.pendingPurchaseCount} ready to review</small>
          </article>
          <article>
            <span>Store Views</span>
            <strong>{ownerAnalytics.storeVisitors}</strong>
          </article>
          <article>
            <span>Conversion</span>
            <strong>{conversionRate.toFixed(2)}%</strong>
          </article>
        </div>

        <section className="mobile-quick-actions">
          <h3>Quick Actions</h3>
          <button onClick={() => navigate('/user/rental-items')} type="button">
            <div>
              <strong>Add Product</strong>
              <span>Create or update your listings</span>
            </div>
            <em>></em>
          </button>
          <button onClick={() => navigate('/user/manage-booking')} type="button">
            <div>
              <strong>Manage Booking</strong>
              <span>Check requests, rentals, and returns</span>
            </div>
            <em>></em>
          </button>
          <button onClick={() => navigate('/user/messages')} type="button">
            <div>
              <strong>Messages</strong>
              <span>Reply to customers and owners</span>
            </div>
            <em>></em>
          </button>
        </section>
      </section>

      <section className="order-dashboard">
        <div className="order-dashboard-top">
          <article className="order-track-card">
            <div className="order-track-head">
              <h2>Borrowed Item Timeline</h2>
              <span>{activeOrder ? formatStatusLabel(activeOrder.status) : 'No active order'}</span>
            </div>

            {activeOrder ? (
              <>
                <p>{activeOrder.orderCode}</p>
                <strong>{activeOrder.itemTitle}</strong>

                <div className="order-progress">
                  <div className="order-progress-line" />
                  {activeOrderTimeline.map((step) => (
                    <div className={`order-progress-step ${step.done ? 'active' : ''}`} key={step.key}>
                      <span />
                      <small>{step.label}</small>
                      {step.dateText ? <em>{step.dateText}</em> : null}
                    </div>
                  ))}
                </div>

                <Button onClick={() => navigate('/user/manage-booking')} style={{ minHeight: 40 }} variant="ghost">
                  View Details
                </Button>
              </>
            ) : (
              <StatusMessage tone="info">No active orders yet.</StatusMessage>
            )}
          </article>

          <div className="order-kpis">
            <article>
              <span>Total Orders</span>
              <strong>{totalOrders}</strong>
            </article>
            <article>
              <span>Saved Listings</span>
              <strong>{savedRentCount}</strong>
            </article>
          </div>
        </div>

        <section className="seller-analytics">
          <div className="seller-analytics-cards">
            <article>
              <span>Total Sales</span>
              <strong>{currencyFormatter.format(ownerAnalytics.totalSales || 0)}</strong>
              <small>{salesDeltaPercent >= 0 ? '+' : ''}{salesDeltaPercent.toFixed(1)}% vs yesterday</small>
            </article>
            <article>
              <span>Active Orders</span>
              <strong>{ownerAnalytics.activeOrderCount}</strong>
              <small>{ownerAnalytics.pendingPurchaseCount} purchase requests awaiting action</small>
            </article>
            <article>
              <span>Store Visitors</span>
              <strong>{ownerAnalytics.storeVisitors}</strong>
              <small>{visitorDeltaPercent >= 0 ? '+' : ''}{visitorDeltaPercent.toFixed(1)}% vs yesterday</small>
            </article>
            <article>
              <span>Conversion Rate</span>
              <strong>{conversionRate.toFixed(2)}%</strong>
              <small>{ownerAnalytics.completedOrderCount} completed owner transactions</small>
            </article>
          </div>

          <div className="seller-analytics-grid">
            <article className="seller-trend-card">
              <div className="seller-analytics-head">
                <h3>Revenue Trend</h3>
                <div>
                  <button className={analyticsMode === 'weekly' ? 'active' : ''} onClick={() => setAnalyticsMode('weekly')} type="button">
                    Weekly
                  </button>
                  <button className={analyticsMode === 'monthly' ? 'active' : ''} onClick={() => setAnalyticsMode('monthly')} type="button">
                    Monthly
                  </button>
                </div>
              </div>
              <div className="seller-trend-bars">
                {revenueTrendPoints.map((point) => (
                  <div key={point.key}>
                    <span>{point.label}</span>
                    <strong style={{ height: `${Math.max(8, ((Number(point.value) || 0) / maxRevenuePoint) * 100)}%` }} />
                    <small>{currencyFormatter.format(Number(point.value) || 0)}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="seller-action-card">
              <h3>Action Required</h3>
              <div className="seller-action-list">
                <div>
                  <strong>{ownerAnalytics.overdueCount} overdue rentals</strong>
                  <p>Orders past due date that may need return follow-up.</p>
                  <button onClick={() => navigate('/user/manage-booking?tab=returns')} type="button">Review returns</button>
                </div>
                <div>
                  <strong>{ownerAnalytics.lowStockCount} low stock items</strong>
                  <p>Listings with 2 quantity or less remaining.</p>
                  <button onClick={() => navigate('/user/rental-items')} type="button">Update stock</button>
                </div>
                <div>
                  <strong>{ownerAnalytics.unreadMessages} unread messages</strong>
                  <p>Customer conversations waiting for response.</p>
                  <button onClick={() => navigate('/user/messages')} type="button">View messages</button>
                </div>
              </div>
            </article>
          </div>

          <article className="seller-recent-card">
            <div className="seller-analytics-head">
              <h3>Recent Owner Transactions</h3>
              <button onClick={() => navigate('/user/manage-booking')} type="button">View All</button>
            </div>
            <div className="seller-recent-table">
              <div className="seller-recent-row seller-recent-header">
                <span>Order ID</span>
                <span>Type</span>
                <span>Date</span>
                <span>Status</span>
                <span>Amount</span>
              </div>
              {ownerAnalytics.recentTransactions.length ? (
                ownerAnalytics.recentTransactions.map((row) => (
                  <div className="seller-recent-row" key={`${row.type}-${row.id}`}>
                    <strong>{formatOrderCode({ id: row.id })}</strong>
                    <span>{row.type === 'sale' ? 'Sale request' : 'Rental booking'}</span>
                    <span>{formatOrderDate(row.created_at)}</span>
                    <em>{formatStatusLabel(row.status)}</em>
                    <strong>{currencyFormatter.format(Number(row.amount) || 0)}</strong>
                  </div>
                ))
              ) : (
                <div className="order-table-empty">No owner transactions yet.</div>
              )}
            </div>
          </article>
        </section>

        <section className="order-table-wrap">
          <div className="order-table-head">
            <h2>Recent Orders</h2>
            <button onClick={() => navigate('/user/manage-booking')} type="button">View All</button>
          </div>

          <div className="order-table">
            <div className="order-table-row order-table-header">
              <span>Order ID</span>
              <span>Item</span>
              <span>Date</span>
              <span>Status</span>
              <span>Total</span>
            </div>

            {recentOrders.length ? (
              recentOrders.map((order) => (
                <div className="order-table-row" key={order.id}>
                  <strong>{order.orderCode}</strong>
                  <span>{order.itemTitle || order.item_id || '-'}</span>
                  <span>{formatOrderDate(order.created_at)}</span>
                  <em>{formatStatusLabel(order.status)}</em>
                  <strong>{currencyFormatter.format(Number(order.total_due) || 0)}</strong>
                </div>
              ))
            ) : (
              <div className="order-table-empty">No orders yet.</div>
            )}
          </div>
        </section>
      </section>

      <Modal
        actions={
          <>
            <Button onClick={() => setShowDamageHoldModal(false)} variant="ghost">
              Later
            </Button>
            <Button onClick={handleCheckBalance} variant="danger">
              Check balance
            </Button>
          </>
        }
        onClose={() => setShowDamageHoldModal(false)}
        open={showDamageHoldModal}
        size="compact"
        title="Account restricted"
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}>
            You have a pending damage claim balance. Renting and listing are restricted until this is resolved.
          </p>
          <p style={{ margin: 0 }}>
            Item: <strong>{pendingDamageItemTitle || 'Damaged item'}</strong>
          </p>
          <p style={{ margin: 0 }}>
            Seller: <strong>{pendingDamageSellerName || 'Unknown seller'}</strong>
          </p>
          <p style={{ margin: 0 }}>
            Current amount due:{' '}
            <strong>
              {currencyFormatter.format(
                Number(pendingDamageClaim?.amount_due) || Number(pendingDamageClaim?.admin_approved_amount) || Number(pendingDamageClaim?.claimed_amount) || 0
              )}
            </strong>
          </p>
        </div>
      </Modal>
    </UserShell>
  );
}

