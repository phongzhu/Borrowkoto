export const BOOKING_STATUS = Object.freeze({
  ACCEPTED: 'accepted',
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  DISPUTED: 'disputed',
  FOR_PICKUP: 'for_pickup',
  OVERDUE: 'overdue',
  PENDING: 'pending',
  REJECTED: 'rejected',
  RETURN_PENDING: 'return_pending',
});

export const BOOKING_STATUS_VALUES = Object.freeze([
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.ACCEPTED,
  BOOKING_STATUS.REJECTED,
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.FOR_PICKUP,
  BOOKING_STATUS.ACTIVE,
  BOOKING_STATUS.RETURN_PENDING,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.OVERDUE,
  BOOKING_STATUS.DISPUTED,
]);

export const TERMINAL_BOOKING_STATUSES = new Set([
  BOOKING_STATUS.REJECTED,
  BOOKING_STATUS.CANCELLED,
  BOOKING_STATUS.COMPLETED,
]);

export const MEETUP_TYPE = Object.freeze({
  PICKUP: 'pickup',
  RETURN: 'return',
});

export const MEETUP_TYPE_VALUES = Object.freeze([MEETUP_TYPE.PICKUP, MEETUP_TYPE.RETURN]);

export const RENTABLE_ITEM_STATUSES = new Set(['available']);

export function isKnownBookingStatus(value) {
  return BOOKING_STATUS_VALUES.includes(String(value || '').toLowerCase());
}

export function isKnownMeetupType(value) {
  return MEETUP_TYPE_VALUES.includes(String(value || '').toLowerCase());
}
