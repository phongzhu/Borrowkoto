import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { CalendarIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../../ui/icons';
import { Badge, Button, FormField, Panel, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import UserShell from './UserShell';
import './UserRentalsCalendar.css';

const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const dateFormatter = new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseRentalDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function addDays(date, amount) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + amount);
  return nextDate;
}

function buildCalendarDays(activeMonth) {
  const firstOfMonth = new Date(activeMonth.getFullYear(), activeMonth.getMonth(), 1);
  const firstCalendarDay = addDays(firstOfMonth, -firstOfMonth.getDay());

  return Array.from({ length: 42 }, (_, index) => addDays(firstCalendarDay, index));
}

function formatStatusLabel(status) {
  const normalized = String(status || 'pending').toLowerCase();
  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (['accepted', 'for_pickup', 'active', 'overdue'].includes(normalized)) {
    return 'success';
  }

  if (['pending', 'requested'].includes(normalized)) {
    return 'warning';
  }

  if (['cancelled', 'canceled', 'rejected', 'declined', 'failed'].includes(normalized)) {
    return 'danger';
  }

  return 'info';
}

function eventColor(eventType) {
  if (eventType === 'borrowed') return theme.colors.success;
  if (eventType === 'incoming') return theme.colors.sky;
  if (eventType === 'purchase_buying') return theme.colors.coral;
  return theme.colors.warning;
}

function buildPersonName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function buildBookingRange(booking) {
  const start = parseRentalDate(booking.approved_start || booking.requested_start);
  const end = parseRentalDate(booking.approved_end || booking.requested_end || booking.approved_start || booking.requested_start);

  return {
    end: end || start,
    start,
  };
}

function CalendarEvent({ event }) {
  const color = eventColor(event.type);
  const textColor =
    event.type === 'borrowed'
      ? '#2f6f49'
      : event.type === 'incoming'
        ? '#446d86'
        : event.type === 'purchase_buying'
          ? '#8f3f34'
          : '#7a6115';

  return (
    <div
      className="rentals-calendar-event"
      style={{
        '--event-color': color,
        '--event-text': textColor,
        background: alpha(color, 0.1),
        borderColor: alpha(color, 0.18),
      }}
      title={event.title}
    >
      <span aria-hidden="true" />
      <strong>{event.title}</strong>
      <em>
        {event.type === 'borrowed'
          ? 'Borrowed'
          : event.type === 'incoming'
            ? 'Incoming'
            : event.type === 'purchase_buying'
              ? 'Buying'
              : 'Selling'}
      </em>
    </div>
  );
}

export default function UserRentalsCalendar({ embedded = false }) {
  const navigate = useNavigate();
  const today = useMemo(() => startOfDay(new Date()), []);
  const [activeMonth, setActiveMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDateKey, setSelectedDateKey] = useState(() => toDateKey(today));
  const [filter, setFilter] = useState('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
  const [userId, setUserId] = useState('');
  const [bookings, setBookings] = useState([]);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadCalendar() {
      setLoading(true);
      setError('');

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      if (userError) {
        setError(userError.message);
        setLoading(false);
        return;
      }

      if (!user) {
        navigate('/login', { replace: true });
        return;
      }

      setUserId(user.id);

      const { data: bookingRows, error: bookingError } = await supabase
        .from('bookings')
        .select('id, item_id, borrower_id, owner_id, requested_start, requested_end, approved_start, approved_end, status, created_at')
        .or(`borrower_id.eq.${user.id},owner_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (!mounted) {
        return;
      }

      if (bookingError) {
        setError(bookingError.message);
        setBookings([]);
        setLoading(false);
        return;
      }

      const rawBookings = bookingRows || [];
      const itemIds = Array.from(new Set(rawBookings.map((booking) => booking.item_id).filter(Boolean)));
      const profileIds = Array.from(
        new Set(rawBookings.flatMap((booking) => [booking.borrower_id, booking.owner_id]).filter((id) => id && id !== user.id))
      );

      const { data: purchaseRows, error: purchaseError } = await supabase
        .from('item_purchase_requests')
        .select(
          'id, item_id, buyer_id, seller_id, buyer_requested_quantity, seller_approved_quantity, sale_price_snapshot, sale_total_amount_snapshot, buyer_preferred_pickup_at, agreed_pickup_at, status, requested_at, created_at'
        )
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      const rawPurchases = purchaseRows || [];
      const purchaseItemIds = Array.from(new Set(rawPurchases.map((row) => row.item_id).filter(Boolean)));
      const purchaseProfileIds = Array.from(
        new Set(rawPurchases.flatMap((row) => [row.buyer_id, row.seller_id]).filter((id) => id && id !== user.id))
      );

      const [itemsResult, profilesResult, purchaseItemsResult, purchaseProfilesResult] = await Promise.all([
        itemIds.length ? supabase.from('items').select('id, title, pickup_barangay, pickup_city, pickup_province').in('id', itemIds) : { data: [], error: null },
        profileIds.length ? supabase.from('profiles').select('id, first_name, middle_name, last_name, suffix, username').in('id', profileIds) : { data: [], error: null },
        purchaseItemIds.length ? supabase.from('items').select('id, title, pickup_barangay, pickup_city, pickup_province').in('id', purchaseItemIds) : { data: [], error: null },
        purchaseProfileIds.length ? supabase.from('profiles').select('id, first_name, middle_name, last_name, suffix, username').in('id', purchaseProfileIds) : { data: [], error: null },
      ]);

      if (!mounted) {
        return;
      }

      const nextErrors = [];

      if (itemsResult.error) {
        nextErrors.push(`items: ${itemsResult.error.message}`);
      }

      if (profilesResult.error) {
        nextErrors.push(`profiles: ${profilesResult.error.message}`);
      }
      if (purchaseError) {
        nextErrors.push(`item_purchase_requests: ${purchaseError.message}`);
      }
      if (purchaseItemsResult.error) {
        nextErrors.push(`purchase items: ${purchaseItemsResult.error.message}`);
      }
      if (purchaseProfilesResult.error) {
        nextErrors.push(`purchase profiles: ${purchaseProfilesResult.error.message}`);
      }

      const itemsById = new Map((itemsResult.data || []).map((item) => [item.id, item]));
      const profilesById = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
      const purchaseItemsById = new Map((purchaseItemsResult.data || []).map((item) => [item.id, item]));
      const purchaseProfilesById = new Map((purchaseProfilesResult.data || []).map((profile) => [profile.id, profile]));

      setBookings(
        rawBookings.map((booking) => {
          const counterpartyId = booking.borrower_id === user.id ? booking.owner_id : booking.borrower_id;

          return {
            ...booking,
            counterparty: profilesById.get(counterpartyId) || null,
            item: itemsById.get(booking.item_id) || null,
          };
        })
      );
      setPurchaseRequests(
        rawPurchases.map((request) => {
          const counterpartyId = request.buyer_id === user.id ? request.seller_id : request.buyer_id;
          return {
            ...request,
            counterparty: purchaseProfilesById.get(counterpartyId) || null,
            item: purchaseItemsById.get(request.item_id) || null,
          };
        })
      );
      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadCalendar();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const calendarEvents = useMemo(() => {
    const bookingEvents = bookings
      .map((booking) => {
        const range = buildBookingRange(booking);

        if (!range.start || !range.end) {
          return null;
        }

        const type = booking.borrower_id === userId ? 'borrowed' : 'incoming';
        const title = booking.item?.title || 'Rental booking';
        const counterpartyName = buildPersonName(booking.counterparty) || booking.counterparty?.username || 'No profile name';

        return {
          booking,
          counterpartyName,
          end: range.end,
          id: booking.id,
          start: range.start,
          title,
          type,
        };
      })
      .filter(Boolean);

    const purchaseEvents = purchaseRequests
      .map((request) => {
        const rangeDate =
          parseRentalDate(request.agreed_pickup_at) ||
          parseRentalDate(request.buyer_preferred_pickup_at) ||
          parseRentalDate(request.requested_at || request.created_at);
        if (!rangeDate) return null;

        const type = request.buyer_id === userId ? 'purchase_buying' : 'purchase_selling';
        const quantity = Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 1;
        const title = `${request.item?.title || 'Purchase request'} x${quantity}`;
        const counterpartyName = buildPersonName(request.counterparty) || request.counterparty?.username || 'No profile name';

        return {
          counterpartyName,
          end: rangeDate,
          id: `purchase-${request.id}`,
          start: rangeDate,
          status: request.status,
          title,
          type,
        };
      })
      .filter(Boolean);

    return [...bookingEvents, ...purchaseEvents].filter((event) => filter === 'all' || event.type === filter);
  }, [bookings, filter, purchaseRequests, userId]);

  const eventsByDateKey = useMemo(() => {
    const map = new Map();

    calendarEvents.forEach((event) => {
      let cursor = event.start;

      while (cursor <= event.end) {
        const key = toDateKey(cursor);
        const current = map.get(key) || [];
        current.push(event);
        map.set(key, current);
        cursor = addDays(cursor, 1);
      }
    });

    return map;
  }, [calendarEvents]);

  const selectedEvents = useMemo(() => eventsByDateKey.get(selectedDateKey) || [], [eventsByDateKey, selectedDateKey]);
  const selectedStatusOptions = useMemo(() => {
    return Array.from(
      new Set(selectedEvents.map((event) => String(event.status || event.booking?.status || 'unknown').toLowerCase()))
    ).sort((a, b) => formatStatusLabel(a).localeCompare(formatStatusLabel(b)));
  }, [selectedEvents]);
  const selectedStatusFilterOptions = useMemo(() => {
    const options = [{ label: `All (${selectedEvents.length})`, value: 'all' }];
    selectedStatusOptions.forEach((status) => {
      const count = selectedEvents.filter((event) => String(event.status || event.booking?.status || 'unknown').toLowerCase() === status).length;
      options.push({ label: `${formatStatusLabel(status)} (${count})`, value: status });
    });
    return options;
  }, [selectedEvents, selectedStatusOptions]);
  const filteredSelectedEvents = useMemo(() => {
    if (selectedStatusFilter === 'all') {
      return selectedEvents;
    }

    return selectedEvents.filter((event) => String(event.status || event.booking?.status || 'unknown').toLowerCase() === selectedStatusFilter);
  }, [selectedEvents, selectedStatusFilter]);
  const calendarDays = useMemo(() => buildCalendarDays(activeMonth), [activeMonth]);
  const borrowedCount = calendarEvents.filter((event) => event.type === 'borrowed').length;
  const incomingCount = calendarEvents.filter((event) => event.type === 'incoming').length;
  const buyingCount = calendarEvents.filter((event) => event.type === 'purchase_buying').length;
  const sellingCount = calendarEvents.filter((event) => event.type === 'purchase_selling').length;

  function changeMonth(amount) {
    setActiveMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  function goToToday() {
    setActiveMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDateKey(toDateKey(today));
  }

  const content = (
    <div className={`rentals-calendar-page${embedded ? ' rentals-calendar-page-embedded' : ''}`}>
        {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

        <Panel
          action={!embedded ? (
            <Button icon={<CheckIcon size={16} />} onClick={() => navigate('/user/manage-booking')} variant="secondary">
              Open manage booking
            </Button>
          ) : null}
          className="rentals-calendar-panel"
          style={{ borderRadius: 0 }}
        >
          <div className="rentals-calendar-toolbar">
            <div className="rentals-calendar-controls">
              <Button aria-label="Previous month" icon={<ChevronLeftIcon size={16} />} onClick={() => changeMonth(-1)} variant="secondary">
                Previous
              </Button>
              <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 24, letterSpacing: '-0.04em' }}>
                {monthFormatter.format(activeMonth)}
              </strong>
              <Button aria-label="Next month" icon={<ChevronRightIcon size={16} />} onClick={() => changeMonth(1)} variant="secondary">
                Next
              </Button>
              <Button onClick={goToToday} variant="ghost">
                Today
              </Button>
            </div>

            <div className="rentals-calendar-filters">
              {[
                ['all', `All ${calendarEvents.length}`],
                ['borrowed', `Borrowed ${borrowedCount}`],
                ['incoming', `Incoming ${incomingCount}`],
                ['purchase_buying', `Buying ${buyingCount}`],
                ['purchase_selling', `Selling ${sellingCount}`],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  onClick={() => setFilter(value)}
                  style={{
                    background: filter === value ? theme.colors.ink : alpha(theme.colors.panel, 0.86),
                    color: filter === value ? '#ffffff' : theme.colors.ink,
                  }}
                  variant="secondary"
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="rentals-calendar-shell">
            <div className="rentals-calendar-scroll">
              <div className="rentals-calendar-grid">
                {weekdayLabels.map((weekday) => (
                  <div className="rentals-calendar-weekday" key={weekday}>
                    {weekday}
                  </div>
                ))}

                {calendarDays.map((day) => {
                  const dateKey = toDateKey(day);
                  const dayEvents = eventsByDateKey.get(dateKey) || [];
                  const isCurrentMonth = day.getMonth() === activeMonth.getMonth();
                  const isSelected = selectedDateKey === dateKey;
                  const isToday = dateKey === toDateKey(today);

                  return (
                    <button
                      className={[
                        'rentals-calendar-day',
                        isCurrentMonth ? '' : 'is-muted',
                        isSelected ? 'is-selected' : '',
                        isToday ? 'is-today' : '',
                      ].filter(Boolean).join(' ')}
                      key={dateKey}
                      onClick={() => setSelectedDateKey(dateKey)}
                      type="button"
                    >
                      <span className="rentals-calendar-day-number">
                        <strong>{day.getDate()}</strong>
                        {isToday ? <Badge tone="info">Today</Badge> : null}
                      </span>
                      <span className="rentals-calendar-event-list">
                        {dayEvents.slice(0, 2).map((event) => (
                          <CalendarEvent event={event} key={`${dateKey}-${event.id}`} />
                        ))}
                        {dayEvents.length > 2 ? <span className="rentals-calendar-more">+{dayEvents.length - 2} more</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <aside className="rentals-calendar-side">
              <Panel className="rentals-calendar-legend-panel" style={{ borderRadius: 0, gap: 8, padding: 12 }}>
                <div className="rentals-calendar-legend-title" style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                  <CalendarIcon size={18} />
                  <strong style={{ color: theme.colors.ink }}>Legend</strong>
                </div>
                <div className="rentals-calendar-legend-items">
                  <span className="rentals-calendar-legend-item" style={{ color: theme.colors.slate }}>
                    <Badge tone="success">Borrowed</Badge> Items you are renting from another user.
                  </span>
                  <span className="rentals-calendar-legend-item" style={{ color: theme.colors.slate }}>
                    <Badge tone="info">Incoming</Badge> Rentals booked against your listings.
                  </span>
                  <span className="rentals-calendar-legend-item" style={{ color: theme.colors.slate }}>
                    <Badge tone="danger">Buying</Badge> Purchase requests you submitted to sellers.
                  </span>
                  <span className="rentals-calendar-legend-item" style={{ color: theme.colors.slate }}>
                    <Badge tone="warning">Selling</Badge> Purchase requests submitted to your sale listings.
                  </span>
                </div>
              </Panel>

              <Panel style={{ borderRadius: 0, gap: 12, padding: 18 }}>
                <FormField label="Selected date">
                  <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 22, letterSpacing: '-0.04em' }}>
                    {dateFormatter.format(new Date(`${selectedDateKey}T00:00:00`))}
                  </strong>
                </FormField>

                {loading ? <StatusMessage tone="info">Loading rental schedules.</StatusMessage> : null}
                {!loading && !selectedEvents.length ? <StatusMessage tone="info">No rental or purchase activity on this date.</StatusMessage> : null}

                {selectedEvents.length ? (
                  <div className="rentals-calendar-status-filters">
                    <label className="rentals-calendar-status-label" htmlFor="selected-date-status-filter">Filter status</label>
                    <select
                      className="rentals-calendar-status-select"
                      id="selected-date-status-filter"
                      onChange={(event) => setSelectedStatusFilter(event.target.value)}
                      value={selectedStatusFilter}
                    >
                      {selectedStatusFilterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {selectedEvents.length && !filteredSelectedEvents.length ? (
                  <StatusMessage tone="info">No activities match this status.</StatusMessage>
                ) : null}

                <div className="rentals-calendar-detail-list">
                {filteredSelectedEvents.map((event) => (
                  <div className="rentals-calendar-detail" key={event.id}>
                    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                      <Badge tone={event.type === 'borrowed' ? 'success' : 'info'}>
                        {event.type === 'borrowed'
                          ? 'Borrowed'
                          : event.type === 'incoming'
                            ? 'Incoming'
                            : event.type === 'purchase_buying'
                              ? 'Buying'
                              : 'Selling'}
                      </Badge>
                      <Badge tone={statusTone(event.status || event.booking?.status)}>{formatStatusLabel(event.status || event.booking?.status)}</Badge>
                    </div>
                    <strong style={{ color: theme.colors.ink }}>{event.title}</strong>
                    <span>
                      {dateFormatter.format(event.start)} to {dateFormatter.format(event.end)}
                    </span>
                    <span>
                      {event.type === 'borrowed'
                        ? 'Owner'
                        : event.type === 'incoming'
                          ? 'Borrower'
                          : event.type === 'purchase_buying'
                            ? 'Seller'
                            : 'Buyer'}
                      : {event.counterpartyName}
                    </span>
                    {!embedded ? (
                      <Button onClick={() => navigate('/user/manage-booking')} style={{ justifySelf: 'start' }} variant="ghost">
                        Open manage booking
                      </Button>
                    ) : null}
                  </div>
                ))}
                </div>
              </Panel>
            </aside>
          </div>
        </Panel>
      </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <UserShell subtitle="See your borrowed rentals and incoming rental requests by schedule." title="Schedule booking">
      {content}
    </UserShell>
  );
}
