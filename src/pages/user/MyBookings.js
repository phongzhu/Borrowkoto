import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { getNubProgramsForSchool, getTargetSchoolCodeForPrograms, NUB_PROGRAMS, NUB_SCHOOLS } from '../../data/nubAcademicData';
import { isAcademicProjectCategory } from '../../data/nubMarketplaceCatalog';
import { createDamageClaim, createDamageReport, getDamageClaimWithEvidence, uploadDamageEvidence, userHasActiveDamageHold } from '../../services/damageClaimsService';
import { approveItemPurchaseRequest } from '../../services/purchaseRequestsService';
import { createTestCheckoutSession } from '../../services/transaction';
import { CalendarIcon, CatalogIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, FilterIcon, StarIcon, UploadIcon } from '../../ui/icons';
import { SectionGrid } from '../../ui/layouts';
import PhilippineAddressFields from '../../ui/PhilippineAddressFields';
import { Badge, Button, FormField, Input, MetricCard, Modal, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { sanitizeText, validateCoordinates } from '../../ui/profileFormUtils';
import { alpha, theme } from '../../ui/theme';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { BOOKING_STATUS } from '../../utils/bookingEnums';
import { clearListingDraft, readListingDraft, saveListingDraft, updateListingMainCategory, updateListingSubcategory } from '../../utils/listingDraft';
import UserShell from './UserShell';
import UserRentalsCalendar from './UserRentalsCalendar';
import './MyBookings.css';

const ITEM_IMAGES_BUCKET = 'item-images';
const MAX_LISTING_IMAGES = 5;

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  year: 'numeric',
});

const headerCellStyle = {
  borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
  color: theme.colors.slate,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.12em',
  padding: '0 16px 14px',
  textAlign: 'left',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

const bodyCellStyle = {
  borderBottom: `1px solid ${alpha(theme.colors.ink, 0.06)}`,
  padding: '16px',
  verticalAlign: 'top',
};

const listingHeaderCellStyle = {
  ...headerCellStyle,
  fontSize: 11,
  letterSpacing: '0.08em',
  overflowWrap: 'break-word',
  padding: '0 10px 10px',
  whiteSpace: 'nowrap',
  wordBreak: 'normal',
};

const listingBodyCellStyle = {
  ...bodyCellStyle,
  fontSize: 'clamp(12px, 0.82vw, 14px)',
  lineHeight: 1.45,
  overflowWrap: 'break-word',
  padding: '12px 10px',
  wordBreak: 'normal',
};

const listingButtonStyle = {
  fontSize: 13,
  minHeight: 38,
  padding: '0 12px',
  whiteSpace: 'nowrap',
};

const manilaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Asia/Manila',
  year: 'numeric',
});

function getManilaTodayDate() {
  const parts = manilaDateFormatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function getWeekStartMonday(dateString) {
  const parsed = new Date(`${dateString}T00:00:00`);
  const day = parsed.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  parsed.setDate(parsed.getDate() + offset);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const date = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

const selectStyle = {
  background: alpha(theme.colors.panel, 0.92),
  border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
  borderRadius: 18,
  color: theme.colors.ink,
  fontFamily: theme.fonts.body,
  fontSize: 15,
  minHeight: 52,
  outline: 'none',
  padding: '0 16px',
  width: '100%',
};

const itemConditionOptions = ['new', 'like_new', 'good', 'fair', 'used'];
const legacyItemConditionMap = {
  brand_new: 'new',
  poor: 'used',
};
const addonPricingOptions = [
  { label: 'Per rental', value: 'per_rental' },
  { label: 'Per day', value: 'per_day' },
  { label: 'Per quantity', value: 'per_quantity' },
];

function createEmptyAddon() {
  return {
    addon_name: '',
    description: '',
    imageFile: null,
    imagePreview: '',
    image_url: '',
    is_required: false,
    price: '',
    pricing_type: 'per_rental',
    quantity: '1',
  };
}

function buildAddonForm(addon) {
  return {
    addon_name: addon?.addon_name || '',
    description: addon?.description || '',
    imageFile: null,
    imagePreview: '',
    image_url: addon?.image_url || '',
    is_required: Boolean(addon?.is_required),
    price: addon?.price === null || addon?.price === undefined ? '' : String(addon.price),
    pricing_type: addon?.pricing_type || 'per_rental',
    quantity: String(addon?.quantity || 1),
  };
}

const TAGS_META_PREFIX = '[TAGS]::';

function parseEmbeddedTags(meetupNotesValue) {
  const rawText = String(meetupNotesValue || '');
  const markerIndex = rawText.indexOf(TAGS_META_PREFIX);

  if (markerIndex < 0) {
    return { notes: rawText, tags: [] };
  }

  const notes = rawText.slice(0, markerIndex).trim();
  const tagsText = rawText.slice(markerIndex + TAGS_META_PREFIX.length).trim();
  const tags = tagsText
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index);

  return { notes, tags };
}

function buildMeetupNotesWithTags(meetupNotesValue, tagsValue) {
  const notes = sanitizeText(meetupNotesValue || '');
  const tags = String(tagsValue || '')
    .split(',')
    .map((tag) => sanitizeText(tag).toLowerCase())
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index);

  if (!tags.length) {
    return notes || null;
  }

  return `${notes}${notes ? '\n\n' : ''}${TAGS_META_PREFIX} ${tags.join(', ')}`;
}

function buildListingForm(profile) {
  return {
    applicable_program_codes: profile?.program_code ? [profile.program_code] : [],
    applies_to_all_programs: false,
    category_id: '',
    description: '',
    estimated_value: '',
    is_for_sale: false,
    item_condition: '',
    max_rental_days: '',
    meetup_notes: '',
    min_rental_days: '1',
    pickup_barangay: profile?.barangay || '',
    pickup_city: profile?.city || '',
    pickup_country: profile?.country || 'Philippines',
    pickup_latitude: profile?.latitude === null || profile?.latitude === undefined ? '' : String(profile.latitude),
    pickup_longitude: profile?.longitude === null || profile?.longitude === undefined ? '' : String(profile.longitude),
    pickup_time: '09:00',
    pickup_province: profile?.province || '',
    pickup_region: profile?.region || '',
    pickup_street: profile?.street || '',
    quantity: '1',
    rental_price_per_day: '',
    return_time: '18:00',
    sale_inclusions: '',
    sale_price: '',
    search_tags: '',
    security_deposit: '',
    subcategory_id: '',
    target_school_code: profile?.school_code || 'all',
    title: '',
  };
}

function normalizeItemCondition(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return legacyItemConditionMap[normalized] || normalized;
}

function buildListingFormFromItem(item) {
  const parsedMeta = parseEmbeddedTags(item?.meetup_notes);
  return {
    applicable_program_codes: Array.isArray(item?.programCodes) ? item.programCodes : [],
    applies_to_all_programs: Boolean(item?.applies_to_all_programs),
    category_id: item?.category_id || '',
    description: item?.description || '',
    estimated_value: item?.estimated_value === null || item?.estimated_value === undefined ? '' : String(item.estimated_value),
    is_for_sale: Boolean(item?.is_for_sale),
    item_condition: normalizeItemCondition(item?.item_condition),
    max_rental_days: item?.max_rental_days === null || item?.max_rental_days === undefined ? '' : String(item.max_rental_days),
    meetup_notes: parsedMeta.notes || '',
    min_rental_days: item?.min_rental_days === null || item?.min_rental_days === undefined ? '1' : String(item.min_rental_days),
    pickup_barangay: item?.pickup_barangay || '',
    pickup_city: item?.pickup_city || '',
    pickup_country: item?.pickup_country || 'Philippines',
    pickup_latitude: item?.pickup_latitude === null || item?.pickup_latitude === undefined ? '' : String(item.pickup_latitude),
    pickup_longitude: item?.pickup_longitude === null || item?.pickup_longitude === undefined ? '' : String(item.pickup_longitude),
    pickup_time: String(item?.pickup_time || '09:00').slice(0, 5),
    pickup_province: item?.pickup_province || '',
    pickup_region: item?.pickup_region || '',
    pickup_street: item?.pickup_street || '',
    quantity: item?.quantity === null || item?.quantity === undefined ? '1' : String(item.quantity),
    rental_price_per_day: item?.rental_price_per_day === null || item?.rental_price_per_day === undefined ? '' : String(item.rental_price_per_day),
    return_time: String(item?.return_time || '18:00').slice(0, 5),
    sale_inclusions: item?.sale_inclusions || '',
    sale_price: item?.sale_price === null || item?.sale_price === undefined ? '' : String(item.sale_price),
    search_tags: parsedMeta.tags.join(', '),
    security_deposit: item?.security_deposit === null || item?.security_deposit === undefined ? '' : String(item.security_deposit),
    subcategory_id: item?.subcategory_id || item?.subcategory_ids?.[0] || '',
    target_school_code: item?.applies_to_all_programs
      ? 'all'
      : getTargetSchoolCodeForPrograms(item?.programCodes),
    title: item?.title || '',
  };
}

function buildItemLocation(item) {
  return [item.pickup_barangay, item.pickup_city, item.pickup_province, item.pickup_country].filter(Boolean).join(', ');
}

function formatDate(value) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }

  return dateFormatter.format(date);
}

function formatDateTime(value) {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }

  return dateTimeFormatter.format(date);
}

function buildPersonName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function bookingStatusTone(status) {
  const normalized = String(status || '').toLowerCase();

  if (['approved', 'accepted', 'confirmed', 'active', 'ongoing', 'in_progress', 'on_loan', 'booked'].includes(normalized)) {
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

function isReturnedBookingStatus(status) {
  return ['done', 'completed', 'returned', 'closed'].includes(String(status || '').toLowerCase());
}

function isRejectedDamageClaim(claim) {
  return String(claim?.status || '').toLowerCase() === 'rejected';
}

function isPayableDamageClaim(claim) {
  return ['approved', 'awaiting_payment'].includes(String(claim?.status || '').toLowerCase());
}

function isBorrowerCancellableStatus(status) {
  return ['pending', 'approved', 'accepted', 'confirmed', 'active', 'ongoing', 'in_progress', 'booked'].includes(
    String(status || '').toLowerCase()
  );
}

function ratingLabel(value) {
  const rating = Number(value);

  if (rating >= 5) {
    return 'Excellent';
  }

  if (rating >= 4) {
    return 'Good';
  }

  if (rating >= 3) {
    return 'Fair';
  }

  if (rating >= 2) {
    return 'Poor';
  }

  return 'Very poor';
}

function sortBookingRows(rows, sort) {
  const dateValue = (row) => new Date(row.created_at || row.requested_at || row.requested_start || row.approved_start || row.buyer_preferred_pickup_at || 0).getTime();
  const amountValue = (row) => Number(row.total_due ?? row.amount_due ?? row.admin_approved_amount ?? row.claimed_amount ?? row.sale_total_amount_snapshot ?? row.sale_price_snapshot) || 0;
  return rows.slice().sort((left, right) => {
    if (sort === 'oldest') return dateValue(left) - dateValue(right);
    if (sort === 'amount-high') return amountValue(right) - amountValue(left);
    if (sort === 'amount-low') return amountValue(left) - amountValue(right);
    if (sort === 'status') return String(left.status || left.damageClaim?.status || '').localeCompare(String(right.status || right.damageClaim?.status || ''));
    if (sort === 'item') return String(left.item?.title || '').localeCompare(String(right.item?.title || ''));
    return dateValue(right) - dateValue(left);
  });
}

function normalizeEntityId(value) {
  return String(value || '').trim().toLowerCase();
}

function isSameEntityId(leftValue, rightValue) {
  const left = normalizeEntityId(leftValue);
  const right = normalizeEntityId(rightValue);
  return Boolean(left) && Boolean(right) && left === right;
}

const APPROVAL_STATUS_CANDIDATES = [BOOKING_STATUS.ACCEPTED];
const LATE_FEE_PAYABLE_STATUSES = new Set([
  BOOKING_STATUS.ACCEPTED,
  BOOKING_STATUS.FOR_PICKUP,
  BOOKING_STATUS.ACTIVE,
  BOOKING_STATUS.OVERDUE,
]);
const BORROWER_CANCELLABLE_STATUS_CANDIDATES = [BOOKING_STATUS.PENDING, BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.FOR_PICKUP, BOOKING_STATUS.ACTIVE];
const RETURN_STATUS_CANDIDATES = ['done', 'completed', 'returned', 'closed'];
const OWNER_RETURNABLE_STATUSES = [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.FOR_PICKUP, BOOKING_STATUS.ACTIVE, BOOKING_STATUS.OVERDUE, BOOKING_STATUS.RETURN_PENDING];
const LATE_FEE_OWNER_SHARE = 0.85;
const LATE_FEE_ADMIN_SHARE = 0.15;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DAMAGE_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAYMONGO_PAYMENT_METHOD = 'paymongo';
const DEFAULT_PAYMENT_STATUS = 'recorded';
const SETTLED_LATE_FEE_PAYMENT_STATUSES = new Set(['recorded', 'paid', 'completed', 'settled']);
const PAYMENT_TYPE_CANDIDATES = Object.freeze({
  depositReturn: ['deposit_return', 'security_deposit_return', 'deposit_refund', 'refund', 'payment'],
  platformFee: ['platform_fee', 'commission_fee', 'service_fee', 'payment'],
  purchase: ['purchase_payment', 'item_purchase_payment', 'purchase', 'payment'],
  rentalFee: ['rental_fee_payment', 'rental_payment', 'rent_payment', 'payment'],
  securityDeposit: ['security_deposit_payment', 'deposit_payment', 'security_deposit', 'payment'],
});

function toMoneyAmount(value) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  return Number(normalized.toFixed(2));
}

function isTransactionTypeConstraintError(error) {
  const text = String(error?.message || '').toLowerCase();
  return text.includes('transaction_type') && (text.includes('enum') || text.includes('check constraint') || text.includes('invalid input value'));
}

async function insertPaymentTransactionWithTypeFallback(payload, transactionTypeCandidates = []) {
  const referenceNumber = payload?.reference_number || null;

  if (referenceNumber) {
    const { data: existingTransaction, error: existingError } = await supabase
      .from('payment_transactions')
      .select('id, transaction_type, status')
      .eq('reference_number', referenceNumber)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message || 'Unable to check existing payment transaction.');
    }

    if (existingTransaction?.id) {
      return { reused: true, transaction: existingTransaction };
    }
  }

  const candidates = Array.from(new Set((transactionTypeCandidates || []).map((value) => String(value || '').trim()).filter(Boolean)));
  const fallbackCandidates = candidates.length ? candidates : ['payment'];
  let lastError = null;

  for (const transactionType of fallbackCandidates) {
    const { data, error } = await supabase
      .from('payment_transactions')
      .insert({
        ...payload,
        transaction_type: transactionType,
      })
      .select('id, transaction_type, status')
      .single();

    if (!error) {
      return { reused: false, transaction: data };
    }

    lastError = error;

    if (!isTransactionTypeConstraintError(error)) {
      break;
    }
  }

  throw new Error(lastError?.message || 'Unable to create payment transaction record.');
}

function createDamageReportForm() {
  return {
    description: '',
    files: [],
  };
}

function calculateLateFee(booking, asOfDate = new Date()) {
  const scheduleEnd = booking?.approved_end || booking?.requested_end;
  const endDate = scheduleEnd ? new Date(scheduleEnd) : null;
  const returnSubmittedAt = String(booking?.status || '').toLowerCase() === BOOKING_STATUS.RETURN_PENDING && booking?.updated_at
    ? new Date(booking.updated_at)
    : null;
  const returnedAt = returnSubmittedAt && !Number.isNaN(returnSubmittedAt.getTime())
    ? returnSubmittedAt
    : (asOfDate instanceof Date ? asOfDate : new Date(asOfDate));
  const feePerDay = Math.max(0, Number(booking?.rental_price_per_day) || 0);

  if (!endDate || Number.isNaN(endDate.getTime()) || Number.isNaN(returnedAt.getTime()) || returnedAt <= endDate) {
    return {
      adminShare: 0,
      daysLate: 0,
      feePerDay,
      ownerShare: 0,
      total: 0,
    };
  }

  const daysLate = Math.max(0, Math.ceil((returnedAt.getTime() - endDate.getTime()) / DAY_IN_MS));
  const total = Number((feePerDay * daysLate).toFixed(2));
  const adminShare = Number((total * LATE_FEE_ADMIN_SHARE).toFixed(2));
  const ownerShare = Number((total * LATE_FEE_OWNER_SHARE).toFixed(2));

  return {
    adminShare,
    daysLate,
    feePerDay,
    ownerShare,
    total,
  };
}

function getDamageReportDeadline(booking) {
  const completedAt = booking?.updated_at ? new Date(booking.updated_at) : null;

  if (!completedAt || Number.isNaN(completedAt.getTime())) {
    return null;
  }

  return new Date(completedAt.getTime() + DAMAGE_REPORT_WINDOW_MS);
}

function getDamageReportWindowStatus(booking, asOfDate = new Date()) {
  const deadline = getDamageReportDeadline(booking);

  if (!isReturnedBookingStatus(booking?.status)) {
    return {
      canReport: false,
      deadline,
      label: 'Available after completion',
      tone: 'info',
    };
  }

  if (!deadline) {
    return {
      canReport: false,
      deadline,
      label: 'Report window unavailable',
      tone: 'warning',
    };
  }

  const remainingMs = deadline.getTime() - asOfDate.getTime();

  if (remainingMs <= 0) {
    return {
      canReport: false,
      deadline,
      label: 'Report window closed',
      tone: 'neutral',
    };
  }

  const remainingHours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));

  return {
    canReport: true,
    deadline,
    label: `${remainingHours}h left`,
    tone: 'warning',
  };
}

function formatListingStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();

  if (!normalized) {
    return 'Unknown';
  }

  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isListingActiveStatus(status) {
  return ['available', 'reserved', 'on_loan'].includes(String(status || '').toLowerCase());
}

function isListingDraftStatus(status) {
  return String(status || '').toLowerCase() === 'draft';
}

function isListingOutOfStock(item) {
  const quantity = Number(item?.quantity) || 0;
  const normalizedStatus = String(item?.status || '').toLowerCase();
  return quantity <= 0 || ['unavailable', 'archived', 'inactive'].includes(normalizedStatus);
}

function buildListingSku(item) {
  const normalizedId = String(item?.id || '')
    .replace(/-/g, '')
    .toUpperCase();
  return normalizedId ? `ITM-${normalizedId.slice(0, 8)}` : 'N/A';
}

function parseCurrency(value, label, { allowEmpty = false } = {}) {
  const text = sanitizeText(value);

  if (!text) {
    if (allowEmpty) {
      return null;
    }

    throw new Error(`${label} is required.`);
  }

  const parsed = Number(text);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be 0 or greater.`);
  }

  return parsed;
}

function parseWholeNumber(value, label, { allowEmpty = false, min = 1 } = {}) {
  const text = sanitizeText(value);

  if (!text) {
    if (allowEmpty) {
      return null;
    }

    throw new Error(`${label} is required.`);
  }

  const parsed = Number(text);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${label} must be at least ${min}.`);
  }

  return parsed;
}

function revokeAddonPreview(url) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}

function revokeAddonPreviews(addons) {
  addons.forEach((addon) => revokeAddonPreview(addon.imagePreview));
}

export default function MyBookings({ viewMode = 'all', listingMode = '' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user: authenticatedUser } = useAuth();
  const authenticatedUserId = authenticatedUser?.id || '';
  const { itemId: editItemId } = useParams();
  const isEditPage = Boolean(editItemId);
  const isAddPage = listingMode === 'add';
  const isListingFormPage = isEditPage || isAddPage;
  const [userId, setUserId] = useState('');
  const listingDraftOwnerId = authenticatedUser?.id || userId;
  const [profile, setProfile] = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [returnCompletionNotice, setReturnCompletionNotice] = useState(null);
  const [search, setSearch] = useState('');
  const [listingStatusFilter, setListingStatusFilter] = useState('all');
  const [listingCategoryFilter, setListingCategoryFilter] = useState('all');
  const [listingPage, setListingPage] = useState(1);
  const [showAddListing, setShowAddListing] = useState(false);
  const [savingListing, setSavingListing] = useState(false);
  const [loadingListingDetails, setLoadingListingDetails] = useState(false);
  const [listingForm, setListingForm] = useState(buildListingForm(null));
  const [categorySearch, setCategorySearch] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [listingImageFiles, setListingImageFiles] = useState([]);
  const [listingImagePreviews, setListingImagePreviews] = useState([]);
  const [savedListingImages, setSavedListingImages] = useState([]);
  const [listingAddons, setListingAddons] = useState([]);
  const [addonEditor, setAddonEditor] = useState(null);
  const [addonEditorError, setAddonEditorError] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [deleteTargetItem, setDeleteTargetItem] = useState(null);
  const [imageViewer, setImageViewer] = useState({ activeUrl: '', images: [], itemTitle: '' });
  const [savingStatusId, setSavingStatusId] = useState('');
  const [deletingItemId, setDeletingItemId] = useState('');
  const [bookingActionBusyId, setBookingActionBusyId] = useState('');
  const [purchasePaymentRecovery, setPurchasePaymentRecovery] = useState(null);
  const [purchasePaymentRecoverySessionId, setPurchasePaymentRecoverySessionId] = useState('');
  const [paymentReturnProcessing, setPaymentReturnProcessing] = useState(
    () => new URLSearchParams(window.location.search).get('paymongo') === 'success'
  );
  const [bookingDetailId, setBookingDetailId] = useState('');
  const [bookingDetailLateFeePayments, setBookingDetailLateFeePayments] = useState([]);
  const [bookingDetailLateFeePaymentsLoading, setBookingDetailLateFeePaymentsLoading] = useState(false);
  const [bookingDetailLateFeePaymentsError, setBookingDetailLateFeePaymentsError] = useState('');
  const [activeBookingFilter, setActiveBookingFilter] = useState(() => {
    const queryTab = new URLSearchParams(window.location.search).get('tab');
    if (queryTab === 'dues') return 'borrowed';
    if (queryTab === 'late') return 'late';
    return 'approval';
  });
  const [bookingSorts, setBookingSorts] = useState({ approval: 'newest', borrowed: 'newest', late: 'newest', returns: 'newest', damage: 'newest', purchase: 'newest' });
  const [manageBookingView, setManageBookingView] = useState('bookings');
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewBooking, setReviewBooking] = useState(null);
  const [reviewForm, setReviewForm] = useState({ rating: '5', review_text: '' });
  const [savingReview, setSavingReview] = useState(false);
  const [activeDamageHold, setActiveDamageHold] = useState(false);
  const [damageReportBooking, setDamageReportBooking] = useState(null);
  const [damageClaimDetailBooking, setDamageClaimDetailBooking] = useState(null);
  const [damageClaimDetail, setDamageClaimDetail] = useState(null);
  const [damageClaimDetailLoading, setDamageClaimDetailLoading] = useState(false);
  const [bookingDamageClaimDetail, setBookingDamageClaimDetail] = useState(null);
  const [bookingDamageClaimLoading, setBookingDamageClaimLoading] = useState(false);
  const [damageReportForm, setDamageReportForm] = useState(createDamageReportForm);
  const [savingDamageReport, setSavingDamageReport] = useState(false);
  const listingImagesInputRef = useRef(null);
  const listingAddonsRef = useRef([]);
  const categoryPickerRef = useRef(null);
  const addListingRouteInitializedRef = useRef(false);
  const editListingRouteInitializedRef = useRef('');
  const payMongoAutoApprovalHandledRef = useRef(false);
  const loadListingsInFlightRef = useRef(false);
  const adminPayeeIdRef = useRef('');

  const resolveAdminPayeeId = useCallback(async () => {
    if (adminPayeeIdRef.current) {
      return adminPayeeIdRef.current;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Unable to resolve admin payee account: ${error.message}`);
    }

    const adminId = data?.id || '';
    adminPayeeIdRef.current = adminId;
    return adminId || null;
  }, []);

  useEffect(() => {
    if (!message) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage('');
    }, 3500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [message]);

  const loadListings = useCallback(async (showLoader = true) => {
    if (loadListingsInFlightRef.current) {
      return;
    }

    loadListingsInFlightRef.current = true;

    if (showLoader) {
      setLoading(true);
    }

    try {
      if (!authenticatedUserId) {
        setUserId('');
        setProfile(null);
        setCategories([]);
        setItems([]);
        setPurchaseRequests([]);
        setError('User not authenticated.');
        setLoading(false);
        return;
      }

      setUserId(authenticatedUserId);

      const [profileResult, categoriesResult, itemsResult, bookingsResult, purchaseRequestsAsSellerResult, purchaseRequestsAsBuyerResult, damageHoldResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', authenticatedUserId).maybeSingle(),
        supabase.from('categories').select('id, name, parent_category_id, is_active').order('name', { ascending: true }),
        supabase
          .from('items')
          .select(
            'id, owner_id, category_id, subcategory_id, applies_to_all_programs, title, description, item_condition, rental_price_per_day, security_deposit, estimated_value, is_for_sale, sale_price, sale_inclusions, min_rental_days, max_rental_days, quantity, pickup_barangay, pickup_city, pickup_country, pickup_latitude, pickup_longitude, pickup_province, pickup_region, pickup_street, pickup_time, return_time, meetup_notes, status, is_active, created_at, updated_at'
          )
          .eq('owner_id', authenticatedUserId)
          .order('created_at', { ascending: false }),
        supabase
          .from('bookings')
          .select(
            'id, item_id, borrower_id, owner_id, requested_start, requested_end, approved_start, approved_end, rental_days, rental_price_per_day, rental_fee_total, security_deposit, total_due, borrower_message, status, cancelled_by, cancellation_reason, created_at, updated_at'
          )
          .or(`borrower_id.eq.${authenticatedUserId},owner_id.eq.${authenticatedUserId}`)
          .order('created_at', { ascending: false }),
        supabase
          .from('item_purchase_requests')
          .select('id, item_id, buyer_id, seller_id, buyer_requested_quantity, seller_approved_quantity, sale_price_snapshot, addon_total_amount_snapshot, commission_fee_snapshot, sale_total_amount_snapshot, sale_inclusions_snapshot, buyer_preferred_pickup_at, agreed_pickup_at, pickup_location_text, pickup_notes, buyer_message, seller_notes, status, requested_at, reviewed_at, paid_at, completed_at, paymongo_checkout_session_id, created_at, updated_at')
          .eq('seller_id', authenticatedUserId)
          .order('created_at', { ascending: false }),
        supabase
          .from('item_purchase_requests')
          .select('id, item_id, buyer_id, seller_id, buyer_requested_quantity, seller_approved_quantity, sale_price_snapshot, addon_total_amount_snapshot, commission_fee_snapshot, sale_total_amount_snapshot, sale_inclusions_snapshot, buyer_preferred_pickup_at, agreed_pickup_at, pickup_location_text, pickup_notes, buyer_message, seller_notes, status, requested_at, reviewed_at, paid_at, completed_at, paymongo_checkout_session_id, created_at, updated_at')
          .eq('buyer_id', authenticatedUserId)
          .order('created_at', { ascending: false }),
        userHasActiveDamageHold(authenticatedUserId),
      ]);

      const nextErrors = [];
      const profileData = profileResult.data || null;
      const nextCategories = categoriesResult.data || [];
      const rawItems = itemsResult.data || [];
      setActiveDamageHold(Boolean(damageHoldResult));

    if (profileResult.error) {
      nextErrors.push(`profiles: ${profileResult.error.message}`);
    }

    if (categoriesResult.error) {
      nextErrors.push(`categories: ${categoriesResult.error.message}`);
    }

    if (itemsResult.error) {
      nextErrors.push(`items: ${itemsResult.error.message}`);
    }

    if (bookingsResult.error) {
      nextErrors.push(`bookings: ${bookingsResult.error.message}`);
    }
    if (purchaseRequestsAsSellerResult.error) {
      nextErrors.push(`item_purchase_requests (seller): ${purchaseRequestsAsSellerResult.error.message}`);
    }
    if (purchaseRequestsAsBuyerResult.error) {
      nextErrors.push(`item_purchase_requests (buyer): ${purchaseRequestsAsBuyerResult.error.message}`);
    }

    const itemIds = rawItems.map((item) => item.id);
    const rawBookings = bookingsResult.data || [];
    const rawPurchaseRequests = Array.from(
      [...(purchaseRequestsAsSellerResult.data || []), ...(purchaseRequestsAsBuyerResult.data || [])].reduce((map, request) => {
        if (request?.id && !map.has(request.id)) {
          map.set(request.id, request);
        }
        return map;
      }, new Map()).values()
    ).sort((left, right) => {
      const leftTime = new Date(left.created_at || left.requested_at || 0).getTime();
      const rightTime = new Date(right.created_at || right.requested_at || 0).getTime();
      return rightTime - leftTime;
    });
    const bookingItemIds = Array.from(new Set(rawBookings.map((booking) => booking.item_id).filter(Boolean)));
    const counterPartyIds = Array.from(
      new Set(
        rawBookings
          .flatMap((booking) => [booking.borrower_id, booking.owner_id])
          .filter((id) => id && id !== authenticatedUserId)
      )
    );
    const bookingIds = rawBookings.map((booking) => booking.id);
    const purchaseRequestItemIds = Array.from(new Set(rawPurchaseRequests.map((request) => request.item_id).filter(Boolean)));
    const purchaseRequestParticipantIds = Array.from(
      new Set(rawPurchaseRequests.flatMap((request) => [request.buyer_id, request.seller_id]).filter(Boolean))
    );
    const categoryMap = new Map(nextCategories.map((category) => [category.id, category]));
    const imagesResult = itemIds.length
      ? await supabase.from('item_images').select('id, item_id, image_url, is_primary, sort_order').in('item_id', itemIds).order('sort_order', { ascending: true })
      : { data: [], error: null };
    const itemSubcategoriesResult = itemIds.length
      ? await supabase
          .from('item_subcategories')
          .select('item_id, subcategory_id, categories!item_subcategories_subcategory_id_fkey(id, name, parent_category_id, is_active)')
          .in('item_id', itemIds)
      : { data: [], error: null };
    const itemProgramsResult = itemIds.length
      ? await supabase
          .from('item_programs')
          .select('item_id, program_code')
          .in('item_id', itemIds)
      : { data: [], error: null };
    const manilaToday = getManilaTodayDate();
    const currentWeekStart = getWeekStartMonday(manilaToday);
    const itemDailyViewsResult = itemIds.length
      ? await supabase
          .from('item_daily_view_counts')
          .select('item_id, viewed_date, total_views, unique_viewers')
          .in('item_id', itemIds)
          .eq('owner_id', authenticatedUserId)
          .eq('viewed_date', manilaToday)
      : { data: [], error: null };
    const itemWeeklyViewsResult = itemIds.length
      ? await supabase
          .from('item_weekly_view_counts')
          .select('item_id, week_start, total_views, unique_viewers')
          .in('item_id', itemIds)
          .eq('owner_id', authenticatedUserId)
          .eq('week_start', currentWeekStart)
      : { data: [], error: null };
    const bookingItemsResult = bookingItemIds.length
      ? await supabase
          .from('items')
          .select(
            'id, owner_id, category_id, subcategory_id, applies_to_all_programs, title, description, item_condition, rental_price_per_day, security_deposit, estimated_value, is_for_sale, sale_price, sale_inclusions, min_rental_days, max_rental_days, quantity, pickup_barangay, pickup_city, pickup_country, pickup_latitude, pickup_longitude, pickup_province, pickup_region, pickup_street, pickup_time, return_time, meetup_notes, status, is_active, created_at, updated_at'
          )
          .in('id', bookingItemIds)
      : { data: [], error: null };
    const bookingImagesResult = bookingItemIds.length
      ? await supabase
          .from('item_images')
          .select('id, item_id, image_url, is_primary, sort_order')
          .in('item_id', bookingItemIds)
          .order('sort_order', { ascending: true })
      : { data: [], error: null };
    const bookingProfilesResult = counterPartyIds.length
      ? await supabase
          .from('profiles')
          .select('id, first_name, middle_name, last_name, suffix, username, profile_photo_url')
          .in('id', counterPartyIds)
      : { data: [], error: null };
    const myReviewsResult = bookingIds.length
      ? await supabase.from('reviews').select('id, booking_id, reviewer_id').eq('reviewer_id', authenticatedUserId).in('booking_id', bookingIds)
      : { data: [], error: null };
    const bookingAddonsResult = bookingIds.length
      ? await supabase
          .from('booking_addons')
          .select('id, booking_id, item_addon_id, addon_name_snapshot, price_snapshot, pricing_type_snapshot, quantity, total_amount')
          .in('booking_id', bookingIds)
      : { data: [], error: null };
    const damageClaimsResult = bookingIds.length
      ? await supabase
          .from('damage_claims')
          .select(
            'id, report_id, booking_id, item_id, owner_id, borrower_id, damage_description, claimed_amount, admin_approved_amount, amount_due, status, admin_notes, reviewed_at, created_at, updated_at'
          )
          .in('booking_id', bookingIds)
          .order('created_at', { ascending: false })
      : { data: [], error: null };
    const purchaseRequestItemsResult = purchaseRequestItemIds.length
      ? await supabase
          .from('items')
          .select('id, owner_id, title, quantity, is_for_sale, status')
          .in('id', purchaseRequestItemIds)
      : { data: [], error: null };
    const purchaseRequestProfilesResult = purchaseRequestParticipantIds.length
      ? await supabase
          .from('profiles')
          .select('id, first_name, middle_name, last_name, suffix, username')
          .in('id', purchaseRequestParticipantIds)
      : { data: [], error: null };
    const purchaseRequestAddonsResult = rawPurchaseRequests.length
      ? await supabase
          .from('item_purchase_request_addons')
          .select('id, purchase_request_id, item_addon_id, addon_name_snapshot, description_snapshot, image_url_snapshot, price_snapshot, quantity, total_amount, is_required')
          .in('purchase_request_id', rawPurchaseRequests.map((request) => request.id))
          .order('created_at', { ascending: true })
      : { data: [], error: null };

    if (imagesResult.error) {
      nextErrors.push(`item_images: ${imagesResult.error.message}`);
    }
    if (itemSubcategoriesResult.error) {
      nextErrors.push(`item_subcategories: ${itemSubcategoriesResult.error.message}`);
    }
    if (itemProgramsResult.error) {
      nextErrors.push(`item_programs: ${itemProgramsResult.error.message}`);
    }
    if (itemDailyViewsResult.error) {
      nextErrors.push(`item_daily_view_counts: ${itemDailyViewsResult.error.message}`);
    }
    if (itemWeeklyViewsResult.error) {
      nextErrors.push(`item_weekly_view_counts: ${itemWeeklyViewsResult.error.message}`);
    }

    if (bookingItemsResult.error) {
      nextErrors.push(`booking items: ${bookingItemsResult.error.message}`);
    }

    if (bookingImagesResult.error) {
      nextErrors.push(`booking item images: ${bookingImagesResult.error.message}`);
    }

    if (bookingProfilesResult.error) {
      nextErrors.push(`booking profiles: ${bookingProfilesResult.error.message}`);
    }

    if (myReviewsResult.error) {
      nextErrors.push(`reviews: ${myReviewsResult.error.message}`);
    }

    if (bookingAddonsResult.error) {
      nextErrors.push(`booking addons: ${bookingAddonsResult.error.message}`);
    }

    if (damageClaimsResult.error) {
      nextErrors.push(`damage_claims: ${damageClaimsResult.error.message}`);
    }
    if (purchaseRequestItemsResult.error) {
      nextErrors.push(`purchase request items: ${purchaseRequestItemsResult.error.message}`);
    }
    if (purchaseRequestProfilesResult.error) {
      nextErrors.push(`purchase request profiles: ${purchaseRequestProfilesResult.error.message}`);
    }
    if (purchaseRequestAddonsResult.error) {
      nextErrors.push(`purchase request add-ons: ${purchaseRequestAddonsResult.error.message}`);
    }

    const imagesByItemId = new Map();
    const subcategoriesByItemId = new Map();
    const programCodesByItemId = new Map();
    const dailyViewsByItemId = new Map();
    const weeklyViewsByItemId = new Map();

    (imagesResult.data || []).forEach((image) => {
      const current = imagesByItemId.get(image.item_id) || [];
      current.push(image);
      imagesByItemId.set(image.item_id, current);
    });
    (itemSubcategoriesResult.data || []).forEach((row) => {
      const current = subcategoriesByItemId.get(row.item_id) || [];
      if (row.categories) {
        current.push(row.categories);
      }
      subcategoriesByItemId.set(row.item_id, current);
    });
    (itemProgramsResult.data || []).forEach((row) => {
      const current = programCodesByItemId.get(row.item_id) || [];
      current.push(row.program_code);
      programCodesByItemId.set(row.item_id, current);
    });
    (itemDailyViewsResult.data || []).forEach((row) => {
      dailyViewsByItemId.set(row.item_id, {
        total_views: Number(row.total_views) || 0,
        unique_viewers: Number(row.unique_viewers) || 0,
      });
    });
    (itemWeeklyViewsResult.data || []).forEach((row) => {
      weeklyViewsByItemId.set(row.item_id, {
        total_views: Number(row.total_views) || 0,
        unique_viewers: Number(row.unique_viewers) || 0,
      });
    });

    const bookingImagesByItemId = new Map();

    (bookingImagesResult.data || []).forEach((image) => {
      const current = bookingImagesByItemId.get(image.item_id) || [];
      current.push(image);
      bookingImagesByItemId.set(image.item_id, current);
    });

    const bookingProfilesById = new Map((bookingProfilesResult.data || []).map((profile) => [profile.id, profile]));
    const reviewedBookingIds = new Set((myReviewsResult.data || []).map((review) => review.booking_id));
    const bookingAddonsByBookingId = new Map();

    (bookingAddonsResult.data || []).forEach((addon) => {
      const current = bookingAddonsByBookingId.get(addon.booking_id) || [];
      current.push(addon);
      bookingAddonsByBookingId.set(addon.booking_id, current);
    });

    const damageClaimsByBookingId = new Map();
    (damageClaimsResult.data || []).forEach((claim) => {
      if (!damageClaimsByBookingId.has(claim.booking_id)) {
        damageClaimsByBookingId.set(claim.booking_id, claim);
      }
    });

    const nextItems = rawItems.map((item) => {
      const images = (imagesByItemId.get(item.id) || [])
        .slice()
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);

      return {
        ...item,
        category: categoryMap.get(item.category_id) || null,
        images,
        primaryImage: images[0] || null,
        subcategories: subcategoriesByItemId.get(item.id) || [],
        subcategory_ids: (subcategoriesByItemId.get(item.id) || []).map((subcategory) => subcategory.id),
        programCodes: programCodesByItemId.get(item.id) || [],
        today_views_total: dailyViewsByItemId.get(item.id)?.total_views || 0,
        today_unique_viewers: dailyViewsByItemId.get(item.id)?.unique_viewers || 0,
        week_views_total: weeklyViewsByItemId.get(item.id)?.total_views || 0,
        week_unique_viewers: weeklyViewsByItemId.get(item.id)?.unique_viewers || 0,
      };
    });

    const bookingItemsById = new Map((bookingItemsResult.data || []).map((bookingItem) => [bookingItem.id, bookingItem]));
    const purchaseItemsById = new Map((purchaseRequestItemsResult.data || []).map((item) => [item.id, item]));
    const purchaseProfilesById = new Map((purchaseRequestProfilesResult.data || []).map((person) => [person.id, person]));
    const purchaseAddonsByRequestId = new Map();
    (purchaseRequestAddonsResult.data || []).forEach((addon) => {
      const current = purchaseAddonsByRequestId.get(addon.purchase_request_id) || [];
      current.push(addon);
      purchaseAddonsByRequestId.set(addon.purchase_request_id, current);
    });
    const nextBookings = rawBookings.map((booking) => {
      const bookingItem = bookingItemsById.get(booking.item_id) || null;
      const bookingItemImages = (bookingImagesByItemId.get(booking.item_id) || [])
        .slice()
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);
      const counterPartyId = booking.owner_id === authenticatedUserId ? booking.borrower_id : booking.owner_id;

      return {
        ...booking,
        counterpart: bookingProfilesById.get(counterPartyId) || null,
        hasMyReview: reviewedBookingIds.has(booking.id),
        isBorrowerBooking: booking.borrower_id === authenticatedUserId,
        addons: bookingAddonsByBookingId.get(booking.id) || [],
        damageClaim: damageClaimsByBookingId.get(booking.id) || null,
        item: bookingItem
          ? {
              ...bookingItem,
              images: bookingItemImages,
              primaryImage: bookingItemImages[0] || null,
            }
          : null,
      };
    });
    const nextPurchaseRequests = rawPurchaseRequests.map((request) => ({
      ...request,
      buyer: purchaseProfilesById.get(request.buyer_id) || null,
      addons: purchaseAddonsByRequestId.get(request.id) || [],
      item: purchaseItemsById.get(request.item_id) || null,
      seller: purchaseProfilesById.get(request.seller_id) || null,
    }));

      setProfile(profileData);
      setCategories(nextCategories);
      setItems(nextItems);
      setBookings(nextBookings);
      setPurchaseRequests(nextPurchaseRequests);
      setError(nextErrors.join(' '));
      setLoading(false);
    } catch (loadError) {
      setError(loadError?.message || 'Unable to load bookings.');
      setLoading(false);
    } finally {
      loadListingsInFlightRef.current = false;
    }
  }, [authenticatedUserId]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  useEffect(() => {
    if (!showAddListing || editingItem) {
      return undefined;
    }

    saveListingDraft(listingDraftOwnerId, listingForm, listingAddons);
    return undefined;
  }, [editingItem, listingAddons, listingDraftOwnerId, listingForm, showAddListing]);

  useEffect(() => {
    if (!listingImageFiles.length) {
      setListingImagePreviews([]);
      return undefined;
    }

    const previews = listingImageFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      isPrimary: index === 0,
      name: file.name,
      url: URL.createObjectURL(file),
    }));

    setListingImagePreviews(previews);

    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [listingImageFiles]);

  useEffect(() => {
    listingAddonsRef.current = listingAddons;
  }, [listingAddons]);

  useEffect(() => () => revokeAddonPreviews(listingAddonsRef.current), []);

  useEffect(() => {
    if (!categoryPickerOpen) return undefined;

    function handleCategoryPickerOutsideClick(event) {
      if (categoryPickerRef.current?.contains(event.target)) return;
      setCategoryPickerOpen(false);
      setCategorySearch('');
    }

    document.addEventListener('pointerdown', handleCategoryPickerOutsideClick);
    return () => document.removeEventListener('pointerdown', handleCategoryPickerOutsideClick);
  }, [categoryPickerOpen]);

  const activeCategories = useMemo(() => categories.filter((category) => category.is_active), [categories]);
  const activeMainCategories = useMemo(
    () => activeCategories.filter((category) => !category.parent_category_id),
    [activeCategories]
  );
  const activeSubcategoriesByParentId = useMemo(() => {
    const map = new Map();
    activeCategories.forEach((category) => {
      if (!category.parent_category_id) {
        return;
      }
      const current = map.get(category.parent_category_id) || [];
      current.push(category);
      map.set(category.parent_category_id, current);
    });
    return map;
  }, [activeCategories]);
  const availableSubcategories = useMemo(
    () => activeSubcategoriesByParentId.get(listingForm.category_id) || [],
    [activeSubcategoriesByParentId, listingForm.category_id]
  );
  const selectedListingMainCategory = useMemo(
    () => activeMainCategories.find((category) => category.id === listingForm.category_id) || null,
    [activeMainCategories, listingForm.category_id]
  );
  const selectedListingSubcategory = useMemo(
    () => availableSubcategories.find((category) => category.id === listingForm.subcategory_id) || null,
    [availableSubcategories, listingForm.subcategory_id]
  );
  const targetSchoolPrograms = useMemo(
    () => listingForm.target_school_code === 'all'
      ? NUB_PROGRAMS
      : getNubProgramsForSchool(listingForm.target_school_code),
    [listingForm.target_school_code]
  );
  const selectedTargetSchool = useMemo(
    () => NUB_SCHOOLS.find((school) => school.code === listingForm.target_school_code) || null,
    [listingForm.target_school_code]
  );

  const listingMainCategoryOptions = useMemo(() => {
    const availableCategoryIds = new Set(items.map((item) => item.category_id).filter(Boolean));
    return activeMainCategories.filter((category) => availableCategoryIds.has(category.id));
  }, [activeMainCategories, items]);

  const listingBaseFilteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return items.filter((item) => {
      if (listingCategoryFilter !== 'all' && item.category_id !== listingCategoryFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        item.title,
        item.description,
        item.item_condition,
        item.status,
        item.category?.name,
        ...(item.subcategories || []).map((subcategory) => subcategory.name),
        buildItemLocation(item),
        buildListingSku(item),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [items, listingCategoryFilter, search]);

  const listingTabCounts = useMemo(
    () => ({
      active: listingBaseFilteredItems.filter((item) => isListingActiveStatus(item.status)).length,
      all: listingBaseFilteredItems.length,
      drafts: listingBaseFilteredItems.filter((item) => isListingDraftStatus(item.status)).length,
      out_of_stock: listingBaseFilteredItems.filter((item) => isListingOutOfStock(item)).length,
    }),
    [listingBaseFilteredItems]
  );

  const filteredItems = useMemo(() => {
    if (listingStatusFilter === 'active') {
      return listingBaseFilteredItems.filter((item) => isListingActiveStatus(item.status));
    }
    if (listingStatusFilter === 'drafts') {
      return listingBaseFilteredItems.filter((item) => isListingDraftStatus(item.status));
    }
    if (listingStatusFilter === 'out_of_stock') {
      return listingBaseFilteredItems.filter((item) => isListingOutOfStock(item));
    }
    return listingBaseFilteredItems;
  }, [listingBaseFilteredItems, listingStatusFilter]);

  const readinessIssues = useMemo(() => {
    const issues = [];

    if (!profile?.is_profile_complete) {
      issues.push('Complete your profile details first.');
    }

    if (!profile?.nub_registry_managed) {
      issues.push('Your account must be linked to the official NUB student registry.');
    }

    return issues;
  }, [profile]);

  const canCreateListing = readinessIssues.length === 0 && !activeDamageHold;
  const activeListingCount = useMemo(() => items.filter((item) => isListingActiveStatus(item.status)).length, [items]);
  const draftListingCount = useMemo(() => items.filter((item) => isListingDraftStatus(item.status)).length, [items]);
  const lowStockListings = useMemo(
    () => items.filter((item) => isListingActiveStatus(item.status) && (Number(item.quantity) || 0) <= 2),
    [items]
  );
  const newListingsThisWeek = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    return items.filter((item) => {
      const createdAt = new Date(item.created_at || 0).getTime();
      return Number.isFinite(createdAt) && now - createdAt <= weekMs;
    }).length;
  }, [items]);
  const listingPageSize = 10;
  const listingTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredItems.length / listingPageSize)),
    [filteredItems.length]
  );
  const currentListingPage = Math.min(listingPage, listingTotalPages);
  const pagedFilteredItems = useMemo(() => {
    const start = (currentListingPage - 1) * listingPageSize;
    return filteredItems.slice(start, start + listingPageSize);
  }, [currentListingPage, filteredItems]);
  const listingRangeStart = filteredItems.length ? (currentListingPage - 1) * listingPageSize + 1 : 0;
  const listingRangeEnd = filteredItems.length ? Math.min(currentListingPage * listingPageSize, filteredItems.length) : 0;

  useEffect(() => {
    setListingPage(1);
  }, [listingCategoryFilter, listingStatusFilter, search]);
  const listingStatusOptions = useMemo(() => {
    const dynamicStatuses = items.map((item) => String(item.status || '').toLowerCase()).filter(Boolean);
    const values = Array.from(new Set(['draft', 'available', 'reserved', 'on_loan', 'unavailable', 'archived', ...dynamicStatuses]));

    return values.map((value) => ({
      label: formatListingStatusLabel(value),
      value,
    }));
  }, [items]);

  function closeImageViewer() {
    setImageViewer({ activeUrl: '', images: [], itemTitle: '' });
  }

  function openImageViewer(item) {
    const availableImages = (item?.images || []).filter((image) => image?.image_url);

    if (!availableImages.length) {
      return;
    }

    setImageViewer({
      activeUrl: availableImages[0].image_url,
      images: availableImages,
      itemTitle: item.title || 'Listing image',
    });
  }

  function deriveItemActiveState(status, fallbackValue) {
    const normalized = String(status || '').toLowerCase();

    if (normalized === 'available') {
      return true;
    }

    if (['archived', 'cancelled', 'draft', 'inactive', 'pending', 'rejected', 'suspended'].includes(normalized)) {
      return false;
    }

    return fallbackValue;
  }

  async function handleStatusUpdate(item, nextStatus) {
    if (!item?.id || !nextStatus || item.status === nextStatus) {
      return;
    }

    setSavingStatusId(item.id);
    setMessage('');

    try {
      const nextIsActive = deriveItemActiveState(nextStatus, item.is_active);
      const { error: updateError } = await supabase
        .from('items')
        .update({
          is_active: nextIsActive,
          status: nextStatus,
        })
        .eq('id', item.id);

      if (updateError) {
        throw new Error(updateError.message);
      }

      setItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id
            ? {
                ...currentItem,
                is_active: nextIsActive,
                status: nextStatus,
                updated_at: new Date().toISOString(),
              }
            : currentItem
        )
      );
      setMessage(`Listing status updated to ${formatListingStatusLabel(nextStatus)}.`);
      setMessageTone('success');
    } catch (statusError) {
      setMessage(`Unable to update the listing status: ${statusError.message}`);
      setMessageTone('warning');
    } finally {
      setSavingStatusId('');
    }
  }

  async function handleDeleteListing(item) {
    if (!item?.id) {
      return;
    }

    setDeletingItemId(item.id);
    setMessage('');

    try {
      const { error: deleteError } = await supabase.from('items').delete().eq('id', item.id);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      setMessage('Product listing deleted.');
      setMessageTone('success');
      setDeleteTargetItem(null);
      if (editingItem?.id === item.id) {
        closeAddListing();
      }
      await loadListings(false);
    } catch (deleteListingError) {
      setMessage(`Unable to delete the listing: ${deleteListingError.message}`);
      setMessageTone('warning');
    } finally {
      setDeletingItemId('');
    }
  }

  function buildCsvCell(value) {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function handleExportListings() {
    const rows = filteredItems.map((item) => [
      buildListingSku(item),
      item.title || '',
      item.category?.name || '',
      item.item_condition || '',
      Number(item.rental_price_per_day) || 0,
      Number(item.security_deposit) || 0,
      Number(item.quantity) || 0,
      formatListingStatusLabel(item.status),
      buildItemLocation(item) || '',
      formatDate(item.updated_at),
    ]);

    const header = ['SKU', 'Title', 'Category', 'Condition', 'Rental Price Per Day', 'Security Deposit', 'Stock', 'Status', 'Location', 'Updated At'];
    const csvContent = [header, ...rows].map((line) => line.map(buildCsvCell).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const exportUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date();
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    anchor.href = exportUrl;
    anchor.setAttribute('download', `rental-listings-${dateKey}.csv`);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(exportUrl);
  }

  function handleFormChange(event) {
    const { name, value } = event.target;

    if (name === 'category_id') {
      setListingForm((current) => updateListingMainCategory(current, value));
      return;
    }

    if (name === 'subcategory_id') {
      setListingForm((current) => updateListingSubcategory(current, value));
      return;
    }

    setListingForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleMainCategorySelection(value) {
    handleFormChange({ target: { name: 'category_id', value } });
    setCategorySearch('');
    setCategoryPickerOpen(false);
  }

  function handleAllProgramsChange(event) {
    const checked = event.target.checked;
    setListingForm((current) => ({
      ...current,
      applicable_program_codes: checked ? [] : current.applicable_program_codes,
      applies_to_all_programs: checked,
      target_school_code: checked ? 'all' : current.target_school_code,
    }));
  }

  function handleTargetSchoolChange(event) {
    const targetSchoolCode = event.target.value;
    setListingForm((current) => {
      if (targetSchoolCode === 'all') {
        return {
          ...current,
          applies_to_all_programs: false,
          target_school_code: 'all',
        };
      }

      const schoolPrograms = getNubProgramsForSchool(targetSchoolCode);
      const allowedCodes = new Set(schoolPrograms.map((program) => program.code));
      const selectedForSchool = (current.applicable_program_codes || []).filter((code) => allowedCodes.has(code));

      return {
        ...current,
        applicable_program_codes: selectedForSchool.length
          ? selectedForSchool
          : schoolPrograms.map((program) => program.code),
        applies_to_all_programs: false,
        target_school_code: targetSchoolCode,
      };
    });
  }

  function handleAllTargetSchoolProgramsChange(event) {
    const checked = event.target.checked;
    const schoolProgramCodes = targetSchoolPrograms.map((program) => program.code);
    setListingForm((current) => ({
      ...current,
      applicable_program_codes: checked ? schoolProgramCodes : [],
      applies_to_all_programs: false,
    }));
  }

  function handleApplicableProgramToggle(programCode) {
    setListingForm((current) => {
      const selected = new Set(current.applicable_program_codes || []);
      if (selected.has(programCode)) selected.delete(programCode);
      else selected.add(programCode);
      return {
        ...current,
        applicable_program_codes: Array.from(selected),
        applies_to_all_programs: false,
      };
    });
  }

  function openAddListing() {
    if (!isAddPage) {
      navigate('/user/rental-items/add');
      return;
    }

    setMessage('');

    revokeAddonPreviews(listingAddons);
    const defaultForm = buildListingForm(profile);
    const draft = readListingDraft(listingDraftOwnerId, defaultForm);
    setListingForm(draft?.form || defaultForm);
    setCategorySearch('');
    setCategoryPickerOpen(false);
    setListingImageFiles([]);
    setSavedListingImages([]);
    setListingAddons(draft?.addons || []);
    setEditingItem(null);
    setShowAddListing(true);
  }

  async function openEditListing(item) {
    setMessage('');
    setLoadingListingDetails(true);
    setShowAddListing(true);
    setEditingItem(item);
    setListingForm(buildListingFormFromItem(item));
    setCategorySearch('');
    setCategoryPickerOpen(false);
    setListingImageFiles([]);
    setSavedListingImages(item.images || []);
    revokeAddonPreviews(listingAddons);
    setListingAddons([]);

    const { data: addonRows, error: addonError } = await supabase
      .from('item_addons')
      .select('addon_name, description, image_url, is_required, price, pricing_type, quantity, sort_order')
      .eq('item_id', item.id)
      .order('sort_order', { ascending: true });

    if (addonError) {
      setMessage(`Unable to load the add-ons for this product: ${addonError.message}`);
      setMessageTone('warning');
      setListingAddons([]);
    } else {
      setListingAddons((addonRows || []).map((addon) => buildAddonForm(addon)));
    }

    setLoadingListingDetails(false);
  }

  useEffect(() => {
    if (!isEditPage || !editItemId || !items.length) {
      if (!isEditPage) editListingRouteInitializedRef.current = '';
      return;
    }

    if (editListingRouteInitializedRef.current === editItemId) return;

    const targetItem = items.find((item) => item.id === editItemId);
    if (!targetItem) {
      setMessage('The selected product was not found.');
      setMessageTone('warning');
      navigate('/user/rental-items');
      return;
    }

    editListingRouteInitializedRef.current = editItemId;
    openEditListing(targetItem);
    // This route effect intentionally runs only when its route/item inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editItemId, isEditPage, items, navigate]);

  useEffect(() => {
    if (!isAddPage) {
      addListingRouteInitializedRef.current = false;
      return;
    }

    if (loading || addListingRouteInitializedRef.current) return;

    addListingRouteInitializedRef.current = true;
    openAddListing();
    // Opening the add route waits for profile defaults and runs once per route entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddPage, loading]);

  useEffect(() => {
    if (isListingFormPage) {
      return;
    }

    revokeAddonPreviews(listingAddons);
    setShowAddListing(false);
    setSavingListing(false);
    setLoadingListingDetails(false);
    setListingImageFiles([]);
    setSavedListingImages([]);
    setListingAddons([]);
    setAddonEditor(null);
    setAddonEditorError('');
    setEditingItem(null);
    // Run only when entering or leaving the listing routes; form changes must not
    // retrigger this cleanup and reset the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListingFormPage]);

  function closeAddListing() {
    if (addonEditor) {
      closeAddonEditor();
    }
    revokeAddonPreviews(listingAddons);
    setShowAddListing(false);
    setSavingListing(false);
    setLoadingListingDetails(false);
    setListingImageFiles([]);
    setSavedListingImages([]);
    setListingAddons([]);
    setAddonEditor(null);
    setAddonEditorError('');
    setDeleteTargetItem(null);
    setEditingItem(null);
    setListingForm(buildListingForm(profile));
    setCategorySearch('');
    setCategoryPickerOpen(false);
    clearListingDraft(listingDraftOwnerId);
    if (isListingFormPage) {
      navigate('/user/rental-items');
    }
  }

  function addAddonRow() {
    setAddonEditor({ index: -1, value: createEmptyAddon() });
    setAddonEditorError('');
  }

  function editAddonRow(index) {
    const addon = listingAddons[index];

    if (!addon) {
      return;
    }

    setAddonEditor({ index, value: { ...addon } });
    setAddonEditorError('');
  }

  function closeAddonEditor() {
    const sourcePreview = addonEditor?.index >= 0 ? listingAddons[addonEditor.index]?.imagePreview : '';
    const editorPreview = addonEditor?.value?.imagePreview;

    if (editorPreview && editorPreview !== sourcePreview) {
      revokeAddonPreview(editorPreview);
    }

    setAddonEditor(null);
    setAddonEditorError('');
  }

  function handleAddonEditorChange(field, value) {
    setAddonEditor((current) =>
      current
        ? {
            ...current,
            value: {
              ...current.value,
              [field]: field === 'is_required' ? Boolean(value) : value,
            },
          }
        : current
    );
  }

  function handleAddonEditorImageChange(file) {
    setAddonEditor((current) => {
      if (!current) {
        return current;
      }

      const sourcePreview = current.index >= 0 ? listingAddons[current.index]?.imagePreview : '';
      if (current.value.imagePreview && current.value.imagePreview !== sourcePreview) {
        revokeAddonPreview(current.value.imagePreview);
      }

      if (!file) {
        return {
          ...current,
          value: {
            ...current.value,
            imageFile: null,
            imagePreview: '',
            image_url: '',
          },
        };
      }

      return {
        ...current,
        value: {
          ...current.value,
          imageFile: file,
          imagePreview: URL.createObjectURL(file),
        },
      };
    });
  }

  function saveAddonEditor() {
    if (!addonEditor) {
      return;
    }

    const addon = addonEditor.value;
    const addonName = sanitizeText(addon.addon_name);
    const price = Number(addon.price);
    const quantity = Number(addon.quantity);

    if (!addonName) {
      setAddonEditorError('Add-on name is required.');
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setAddonEditorError('Add-on price must be 0 or greater.');
      return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      setAddonEditorError('Available quantity must be a whole number of at least 1.');
      return;
    }

    const savedAddon = {
      ...addon,
      addon_name: addonName,
      quantity: String(quantity),
    };

    setListingAddons((current) => {
      if (addonEditor.index < 0) {
        return [...current, savedAddon];
      }

      const previousPreview = current[addonEditor.index]?.imagePreview;
      if (previousPreview && previousPreview !== savedAddon.imagePreview) {
        revokeAddonPreview(previousPreview);
      }

      return current.map((currentAddon, index) => (index === addonEditor.index ? savedAddon : currentAddon));
    });
    setAddonEditor(null);
    setAddonEditorError('');
  }


  function removeAddonRow(index) {
    setListingAddons((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      revokeAddonPreview(current[index]?.imagePreview);
      return next;
    });
  }

  function handleListingImagesChange(event) {
    const nextFiles = Array.from(event.target.files || []);

    if (!nextFiles.length) {
      return;
    }

    setListingImageFiles((current) => {
      const remainingSlots = MAX_LISTING_IMAGES - current.length;

      if (remainingSlots <= 0) {
        setMessage(`You can upload up to ${MAX_LISTING_IMAGES} product images only.`);
        setMessageTone('warning');
        return current;
      }

      const acceptedFiles = nextFiles.slice(0, remainingSlots);

      if (acceptedFiles.length < nextFiles.length) {
        setMessage(`Only ${MAX_LISTING_IMAGES} product images are allowed. Extra images were not added.`);
        setMessageTone('warning');
      }

      return [...current, ...acceptedFiles];
    });
    event.target.value = '';
  }

  function removeListingImage(indexToRemove) {
    setListingImageFiles((current) => current.filter((_, index) => index !== indexToRemove));
  }

  async function uploadListingImages(itemId, { existingImageCount = 0, hasPrimaryImage = false } = {}) {
    if (!listingImageFiles.length || !userId) {
      return [];
    }

    const uploadTimestamp = Date.now();
    const uploadedRows = [];

    for (const [index, file] of listingImageFiles.entries()) {
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'png';
      const sortOrder = existingImageCount + index;
      const filePath = `${userId}/${itemId}/${sortOrder}-${uploadTimestamp}.${fileExt}`;

      const { error: uploadError } = await supabase.storage.from(ITEM_IMAGES_BUCKET).upload(filePath, file, { upsert: true });

      if (uploadError) {
        throw new Error(`Listing saved, but image upload failed: ${uploadError.message}`);
      }

      const { data: publicUrlData } = supabase.storage.from(ITEM_IMAGES_BUCKET).getPublicUrl(filePath);
      const imageUrl = publicUrlData?.publicUrl || '';

      if (!imageUrl) {
        throw new Error('Listing saved, but an uploaded image URL could not be resolved.');
      }

      uploadedRows.push({
        image_url: imageUrl,
        is_primary: !hasPrimaryImage && index === 0,
        item_id: itemId,
        sort_order: sortOrder,
      });
    }

    const { error: imageInsertError } = await supabase.from('item_images').insert(uploadedRows);

    if (imageInsertError) {
      throw new Error(`Listing saved, but the image records failed: ${imageInsertError.message}`);
    }

    return uploadedRows;
  }

  async function uploadAddonImage(itemId, file, index) {
    if (!file || !userId) {
      return '';
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase() || 'png';
    const filePath = `${userId}/${itemId}/addons/${index}-${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage.from(ITEM_IMAGES_BUCKET).upload(filePath, file, { upsert: true });

    if (uploadError) {
      throw new Error(`Product saved, but an add-on image failed to upload: ${uploadError.message}`);
    }

    const { data: publicUrlData } = supabase.storage.from(ITEM_IMAGES_BUCKET).getPublicUrl(filePath);
    const imageUrl = publicUrlData?.publicUrl || '';

    if (!imageUrl) {
      throw new Error('Product saved, but an add-on image URL could not be resolved.');
    }

    return imageUrl;
  }

  async function handleCreateListing(event) {
    event.preventDefault();
    setSavingListing(true);
    setMessage('');

    try {
      if (!userId) {
        throw new Error('User not authenticated.');
      }

      if (!canCreateListing) {
        throw new Error(
          activeDamageHold
            ? 'You cannot list items while an admin-approved damage hold is active. Settle the damage claim first.'
            : 'Complete your profile details and confirm that your account is linked to the official NUB student registry before creating a listing.'
        );
      }

      if (await userHasActiveDamageHold(userId)) {
        setActiveDamageHold(true);
        throw new Error('You cannot list items while an admin-approved damage hold is active. Settle the damage claim first.');
      }

      const title = sanitizeText(listingForm.title);
      const description = sanitizeText(listingForm.description);
      const categoryId = sanitizeText(listingForm.category_id);
      const subcategoryId = sanitizeText(listingForm.subcategory_id);
      const itemCondition = normalizeItemCondition(sanitizeText(listingForm.item_condition));
      const pickupBarangay = sanitizeText(listingForm.pickup_barangay);
      const pickupCity = sanitizeText(listingForm.pickup_city);
      const pickupProvince = sanitizeText(listingForm.pickup_province);
      const pickupTime = String(listingForm.pickup_time || '').trim();
      const returnTime = String(listingForm.return_time || '').trim();

      if (!title) {
        throw new Error('Product title is required.');
      }

      if (!description) {
        throw new Error('Product description is required.');
      }

      if (!categoryId) {
        throw new Error('Category or classification is required.');
      }
      const selectedMainCategory = activeMainCategories.find((category) => category.id === categoryId);
      if (!selectedMainCategory) {
        throw new Error('Please select a valid main category.');
      }
      const selectedSubcategory = (activeSubcategoriesByParentId.get(categoryId) || [])
        .find((subcategory) => subcategory.id === subcategoryId);
      if (!selectedSubcategory) {
        throw new Error('Select one valid subcategory under the chosen parent category.');
      }

      const appliesToAllPrograms = Boolean(listingForm.applies_to_all_programs);
      const validProgramCodes = new Set(NUB_PROGRAMS.map((program) => program.code));
      const applicableProgramCodes = Array.from(new Set((listingForm.applicable_program_codes || []).filter(Boolean)));
      const targetSchoolCode = sanitizeText(listingForm.target_school_code) || 'all';
      if (applicableProgramCodes.some((programCode) => !validProgramCodes.has(programCode))) {
        throw new Error('One or more selected applicable programs are not official NU Baliwag undergraduate programs.');
      }
      if (targetSchoolCode !== 'all') {
        const targetSchool = NUB_SCHOOLS.find((school) => school.code === targetSchoolCode);
        const targetSchoolProgramCodes = new Set(getNubProgramsForSchool(targetSchoolCode).map((program) => program.code));
        if (!targetSchool) {
          throw new Error('Select a valid NU Baliwag target school.');
        }
        if (applicableProgramCodes.some((programCode) => !targetSchoolProgramCodes.has(programCode))) {
          throw new Error(`Every selected course must belong to ${targetSchool.code}.`);
        }
      }
      if (!appliesToAllPrograms && !applicableProgramCodes.length) {
        throw new Error('Select at least one applicable NU Baliwag program or choose all programs.');
      }

      if (!itemCondition) {
        throw new Error('Item condition is required.');
      }

      if (!itemConditionOptions.includes(itemCondition)) {
        throw new Error(`Item condition must be one of: ${itemConditionOptions.map((value) => formatListingStatusLabel(value)).join(', ')}.`);
      }

      if (!pickupBarangay || !pickupCity || !pickupProvince) {
        throw new Error('Pickup barangay, city, and province are required.');
      }

      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(returnTime)) {
        throw new Error('Valid pickup and return times are required.');
      }

      const rentalPricePerDay = parseCurrency(listingForm.rental_price_per_day, 'Rental price per day');
      const securityDeposit = parseCurrency(listingForm.security_deposit, 'Security deposit');
      const estimatedValue = parseCurrency(listingForm.estimated_value, 'Estimated value', { allowEmpty: true });
      const isForSale = Boolean(listingForm.is_for_sale);
      const salePrice = isForSale ? parseCurrency(listingForm.sale_price, 'Sale price') : null;
      const saleInclusions = isForSale ? sanitizeText(listingForm.sale_inclusions) : null;
      const minRentalDays = parseWholeNumber(listingForm.min_rental_days, 'Minimum rental days');
      const maxRentalDays = parseWholeNumber(listingForm.max_rental_days, 'Maximum rental days', { allowEmpty: true, min: minRentalDays });
      const quantity = parseWholeNumber(listingForm.quantity, 'Quantity');
      const { latitude: pickupLatitude, longitude: pickupLongitude } = validateCoordinates(
        listingForm.pickup_latitude,
        listingForm.pickup_longitude
      );
      if (maxRentalDays !== null && maxRentalDays < minRentalDays) {
        throw new Error('Maximum rental days must be greater than or equal to minimum rental days.');
      }

      if (isForSale && !saleInclusions) {
        throw new Error('Sale inclusions are required when the item is available for purchase.');
      }
      const preparedAddons = listingAddons.reduce((accumulator, addon, index) => {
        const addonName = sanitizeText(addon.addon_name);
        const addonDescription = sanitizeText(addon.description);
        const currentImageUrl = sanitizeText(addon.image_url);
        const hasAnyValue = Boolean(addonName || addonDescription || addon.price || addon.is_required || addon.imageFile || currentImageUrl);

        if (!hasAnyValue) {
          return accumulator;
        }

        if (!addonName) {
          throw new Error(`Add-on ${index + 1} needs a name.`);
        }

        const pricingType = sanitizeText(addon.pricing_type) || 'per_rental';

        if (!addonPricingOptions.some((option) => option.value === pricingType)) {
          throw new Error(`Add-on ${index + 1} has an invalid pricing type.`);
        }

        accumulator.push({
          addon_name: addonName,
          description: addonDescription || null,
          imageFile: addon.imageFile || null,
          image_url: currentImageUrl || null,
          is_active: true,
          is_required: Boolean(addon.is_required),
          price: parseCurrency(addon.price, `Add-on ${index + 1} price`),
          pricing_type: pricingType,
          quantity: parseWholeNumber(addon.quantity, `Add-on ${index + 1} quantity`),
          sort_order: index,
        });

        return accumulator;
      }, []);

      const insertPayload = {
        applies_to_all_programs: appliesToAllPrograms,
        category_id: categoryId,
        description,
        estimated_value: estimatedValue,
        is_for_sale: isForSale,
        is_active: true,
        item_condition: itemCondition,
        max_rental_days: maxRentalDays,
        meetup_notes: buildMeetupNotesWithTags(listingForm.meetup_notes, listingForm.search_tags),
        min_rental_days: minRentalDays,
        owner_id: userId,
        pickup_barangay: pickupBarangay,
        pickup_city: pickupCity,
        pickup_country: sanitizeText(listingForm.pickup_country) || 'Philippines',
        pickup_latitude: pickupLatitude,
        pickup_longitude: pickupLongitude,
        pickup_province: pickupProvince,
        pickup_region: sanitizeText(listingForm.pickup_region) || null,
        pickup_street: sanitizeText(listingForm.pickup_street) || null,
        pickup_time: pickupTime,
        quantity,
        rental_price_per_day: rentalPricePerDay,
        return_time: returnTime,
        sale_inclusions: saleInclusions,
        sale_price: salePrice,
        security_deposit: securityDeposit,
        status: 'draft',
        subcategory_id: subcategoryId,
        title,
      };

      let currentItemId = editingItem?.id || '';

      if (editingItem) {
        const { error: updateError } = await supabase.from('items').update(insertPayload).eq('id', editingItem.id);

        if (updateError) {
          throw new Error(updateError.message);
        }
      } else {
        const { data: createdItem, error: createError } = await supabase.from('items').insert([insertPayload]).select('id').single();

        if (createError) {
          throw new Error(createError.message);
        }

        currentItemId = createdItem.id;
      }

      if (!currentItemId) {
        throw new Error('The product could not be resolved for saving.');
      }

      const { error: deleteSubcategoriesError } = await supabase.from('item_subcategories').delete().eq('item_id', currentItemId);
      if (deleteSubcategoriesError) {
        throw new Error(`Product saved, but existing subcategories could not be refreshed: ${deleteSubcategoriesError.message}`);
      }

      const { error: insertSubcategoriesError } = await supabase.from('item_subcategories').insert([{
        item_id: currentItemId,
        subcategory_id: subcategoryId,
      }]);
      if (insertSubcategoriesError) {
        throw new Error(`Product saved, but its subcategory failed to save: ${insertSubcategoriesError.message}`);
      }

      const { error: deleteProgramsError } = await supabase.from('item_programs').delete().eq('item_id', currentItemId);
      if (deleteProgramsError) {
        throw new Error(`Product saved, but its existing program scope could not be refreshed: ${deleteProgramsError.message}`);
      }

      if (!appliesToAllPrograms) {
        const { error: insertProgramsError } = await supabase.from('item_programs').insert(
          applicableProgramCodes.map((programCode) => ({ item_id: currentItemId, program_code: programCode }))
        );
        if (insertProgramsError) {
          throw new Error(`Product saved, but its applicable programs failed to save: ${insertProgramsError.message}`);
        }
      }

      let followUpMessage = editingItem ? 'Product listing updated.' : 'Product listing saved.';

      if (editingItem) {
        const { error: addonDeleteError } = await supabase.from('item_addons').delete().eq('item_id', currentItemId);

        if (addonDeleteError) {
          throw new Error(`Product updated, but the existing add-ons could not be refreshed: ${addonDeleteError.message}`);
        }
      }

      if (preparedAddons.length) {
        const normalizedAddons = [];

        for (const [index, addon] of preparedAddons.entries()) {
          let imageUrl = addon.image_url;

          if (addon.imageFile) {
            imageUrl = await uploadAddonImage(currentItemId, addon.imageFile, index);
          }

          normalizedAddons.push({
            addon_name: addon.addon_name,
            description: addon.description,
            image_url: imageUrl,
            is_active: addon.is_active,
            is_required: addon.is_required,
            item_id: currentItemId,
            price: addon.price,
            pricing_type: addon.pricing_type,
            quantity: addon.quantity,
            sort_order: addon.sort_order,
          });
        }

        const { error: addonInsertError } = await supabase.from('item_addons').insert(
          normalizedAddons
        );

        if (addonInsertError) {
          throw new Error(`${editingItem ? 'Product updated' : 'Listing saved'}, but the add-on records failed: ${addonInsertError.message}`);
        }

        followUpMessage =
          normalizedAddons.length === 1
            ? `${editingItem ? 'Product listing updated' : 'Product listing saved'} with 1 add-on.`
            : `${editingItem ? 'Product listing updated' : 'Product listing saved'} with ${normalizedAddons.length} add-ons.`;
      }

      if (listingImageFiles.length) {
        try {
          await uploadListingImages(currentItemId, {
            existingImageCount: savedListingImages.length,
            hasPrimaryImage: savedListingImages.some((image) => image.is_primary),
          });
          const imageMessage = `${listingImageFiles.length} image${listingImageFiles.length === 1 ? '' : 's'}`;
          const baseMessage = editingItem ? 'Product listing updated.' : 'Product listing saved.';
          followUpMessage = followUpMessage === baseMessage ? `${editingItem ? 'Product listing updated' : 'Product listing saved'} with ${imageMessage}.` : `${followUpMessage} Added ${imageMessage}.`;
        } catch (imageError) {
          followUpMessage = imageError.message;
          setMessageTone('warning');
        }
      }

      if (followUpMessage === 'Product listing saved.' || followUpMessage === 'Product listing updated.') {
        setMessageTone('success');
      }

      setMessage(followUpMessage);
      clearListingDraft(listingDraftOwnerId);
      closeAddListing();
      await loadListings(false);
    } catch (saveError) {
      setMessage(saveError.message);
      setMessageTone('warning');
      setSavingListing(false);
    }
  }

  const ownerBookings = useMemo(() => bookings.filter((booking) => isSameEntityId(booking.owner_id, userId)), [bookings, userId]);
  const borrowerBookings = useMemo(() => bookings.filter((booking) => isSameEntityId(booking.borrower_id, userId)), [bookings, userId]);
  const lateBorrowerBookings = useMemo(
    () => borrowerBookings.filter((booking) =>
      LATE_FEE_PAYABLE_STATUSES.has(String(booking.status || '').toLowerCase()) && calculateLateFee(booking).total > 0
    ),
    [borrowerBookings]
  );
  const regularBorrowerBookings = useMemo(() => {
    const lateBookingIds = new Set(lateBorrowerBookings.map((booking) => String(booking.id)));
    return borrowerBookings.filter((booking) => !lateBookingIds.has(String(booking.id)));
  }, [borrowerBookings, lateBorrowerBookings]);
  const sortedRegularBorrowerBookings = useMemo(
    () => sortBookingRows(regularBorrowerBookings, bookingSorts.borrowed),
    [bookingSorts.borrowed, regularBorrowerBookings]
  );
  const sortedLateBorrowerBookings = useMemo(
    () => sortBookingRows(lateBorrowerBookings, bookingSorts.late),
    [bookingSorts.late, lateBorrowerBookings]
  );
  const pendingApprovals = useMemo(
    () => ownerBookings.filter((booking) => String(booking.status || '').toLowerCase() === 'pending'),
    [ownerBookings]
  );
  const pendingPurchaseApprovals = useMemo(
    () => purchaseRequests.filter((request) => isSameEntityId(request.seller_id, userId) && String(request.status || '').toLowerCase() === 'pending'),
    [purchaseRequests, userId]
  );
  const sellerPurchaseRequests = useMemo(
    () => purchaseRequests.filter((request) => isSameEntityId(request.seller_id, userId)),
    [purchaseRequests, userId]
  );
  const buyerPurchaseRequests = useMemo(
    () => purchaseRequests.filter((request) => isSameEntityId(request.buyer_id, userId)),
    [purchaseRequests, userId]
  );
  const completedOwnerBookings = useMemo(() => ownerBookings.filter((booking) => isReturnedBookingStatus(booking.status)), [ownerBookings]);
  const reportableCompletedBookings = useMemo(
    () => completedOwnerBookings.filter((booking) =>
      getDamageReportWindowStatus(booking).canReport && (!booking.damageClaim || isRejectedDamageClaim(booking.damageClaim))
    ),
    [completedOwnerBookings]
  );
  const payableDamageBookings = useMemo(
    () =>
      borrowerBookings.filter((booking) => {
        const claim = booking.damageClaim;
        if (!claim) {
          return false;
        }
        if (!isPayableDamageClaim(claim)) {
          return false;
        }
        const amountDue = Number(claim.amount_due) || Number(claim.admin_approved_amount) || Number(claim.claimed_amount) || 0;
        return amountDue > 0;
      }),
    [borrowerBookings]
  );
  const bookingDetail = useMemo(() => bookings.find((booking) => booking.id === bookingDetailId) || null, [bookings, bookingDetailId]);
  const isLateFeePaymentReturn = (() => {
    const query = new URLSearchParams(window.location.search);
    return query.get('payment_status') === 'success' && query.get('late_fee_paid') === 'true';
  })();
  const bookingDetailLateFee = useMemo(() => calculateLateFee(bookingDetail), [bookingDetail]);
  useEffect(() => {
    if (!bookingDetail?.id) {
      setBookingDetailLateFeePayments([]);
      setBookingDetailLateFeePaymentsError('');
      setBookingDetailLateFeePaymentsLoading(false);
      return undefined;
    }

    let ignore = false;
    setBookingDetailLateFeePaymentsLoading(true);
    setBookingDetailLateFeePaymentsError('');

    async function loadLateFeePayments() {
      const { data, error: paymentError } = await supabase
        .from('payment_transactions')
        .select('id, amount, status, payment_method, transaction_type, transaction_at, notes')
        .eq('booking_id', bookingDetail.id)
        .in('transaction_type', ['late_fee_owner_share', 'late_fee_admin_share'])
        .order('transaction_at', { ascending: true });

      if (ignore) {
        return;
      }

      if (paymentError) {
        setBookingDetailLateFeePayments([]);
        setBookingDetailLateFeePaymentsError(paymentError.message || 'Unable to load late-fee payment status.');
      } else {
        setBookingDetailLateFeePayments(data || []);
      }
      setBookingDetailLateFeePaymentsLoading(false);
    }

    loadLateFeePayments();

    return () => {
      ignore = true;
    };
  }, [bookingDetail?.id, bookingDetail?.status, bookingDetail?.updated_at]);
  const bookingDetailLateFeePaymentTotal = useMemo(() => {
    if (!bookingDetailLateFeePayments.length) {
      return bookingDetailLateFee.total;
    }
    return toMoneyAmount(bookingDetailLateFeePayments.reduce((total, payment) => total + Number(payment.amount || 0), 0));
  }, [bookingDetailLateFee.total, bookingDetailLateFeePayments]);
  const bookingDetailLateFeePaid = useMemo(
    () => toMoneyAmount(bookingDetailLateFeePayments
      .filter((payment) => SETTLED_LATE_FEE_PAYMENT_STATUSES.has(String(payment.status || '').toLowerCase()))
      .reduce((total, payment) => total + Number(payment.amount || 0), 0)),
    [bookingDetailLateFeePayments]
  );
  const bookingDetailLateFeeDepositApplied = useMemo(
    () => toMoneyAmount(bookingDetailLateFeePayments
      .filter((payment) =>
        payment.payment_method === 'security_deposit' &&
        SETTLED_LATE_FEE_PAYMENT_STATUSES.has(String(payment.status || '').toLowerCase())
      )
      .reduce((total, payment) => total + Number(payment.amount || 0), 0)),
    [bookingDetailLateFeePayments]
  );
  const bookingDetailLateFeePayMongoPaid = toMoneyAmount(Math.max(0, bookingDetailLateFeePaid - bookingDetailLateFeeDepositApplied));
  const bookingDetailLateFeeRemaining = toMoneyAmount(Math.max(0, bookingDetailLateFeePaymentTotal - bookingDetailLateFeePaid));
  const bookingDetailLateFeeIsPaid = bookingDetailLateFeePaymentTotal > 0 && bookingDetailLateFeeRemaining <= 0;
  const bookingDetailLateFeeDays = useMemo(() => {
    const notes = bookingDetailLateFeePayments.map((payment) => String(payment.notes || ''));
    const match = notes.map((note) => note.match(/(\d+)\s+day\(s\)\s+overdue/i)).find(Boolean);
    return match ? Number(match[1]) : bookingDetailLateFee.daysLate;
  }, [bookingDetailLateFee.daysLate, bookingDetailLateFeePayments]);
  const bookingDetailLateFeePaidAt = useMemo(() => {
    const paidPayments = bookingDetailLateFeePayments.filter((payment) =>
      SETTLED_LATE_FEE_PAYMENT_STATUSES.has(String(payment.status || '').toLowerCase()) && payment.transaction_at
    );
    return paidPayments.reduce((latest, payment) => {
      const paymentTime = new Date(payment.transaction_at).getTime();
      return Number.isFinite(paymentTime) && paymentTime > latest ? paymentTime : latest;
    }, 0);
  }, [bookingDetailLateFeePayments]);
  const bookingDetailHasLateFee = bookingDetailLateFeePayments.length > 0 || (
    bookingDetailLateFee.total > 0 &&
    (LATE_FEE_PAYABLE_STATUSES.has(String(bookingDetail?.status || '').toLowerCase()) ||
      String(bookingDetail?.status || '').toLowerCase() === BOOKING_STATUS.RETURN_PENDING)
  );
  const bookingDetailCanOwnerCompleteReturn = Boolean(
    bookingDetail &&
    isSameEntityId(bookingDetail.owner_id, userId) &&
    OWNER_RETURNABLE_STATUSES.includes(String(bookingDetail.status || '').toLowerCase()) &&
    (bookingDetailLateFee.total <= 0 || (
      bookingDetailLateFeeIsPaid &&
      !bookingDetailLateFeePaymentsLoading &&
      !bookingDetailLateFeePaymentsError
    ))
  );
  const bookingDetailDepositApplied = bookingDetailLateFeePayments.length
    ? bookingDetailLateFeeDepositApplied
    : toMoneyAmount(Math.min(Number(bookingDetail?.security_deposit || 0), bookingDetailLateFee.total));
  const bookingDetailPayMongoDue = toMoneyAmount(
    bookingDetailLateFeePayments.length
      ? bookingDetailLateFeeRemaining
      : Math.max(0, bookingDetailLateFee.total - bookingDetailDepositApplied)
  );
  const reviewRating = Number(reviewForm.rating) || 0;
  const showManageBooking = viewMode === 'all' || viewMode === 'manage-booking';
  const showRentalItems = viewMode === 'all' || viewMode === 'rental-items';
  const pageTitle = '';
  const pageSubtitle = '';
  const bookingFilters = [
    { count: pendingApprovals.length + pendingPurchaseApprovals.length, key: 'approval', label: 'Needs approval' },
    { count: regularBorrowerBookings.length, key: 'borrowed', label: 'Borrowed' },
    { count: lateBorrowerBookings.length, key: 'late', label: 'Late bookings' },
    { count: ownerBookings.length, key: 'returns', label: 'Return completion' },
    { count: reportableCompletedBookings.length + payableDamageBookings.length, key: 'damage-reports', label: 'Damage reports' },
    { count: sellerPurchaseRequests.length + buyerPurchaseRequests.length, key: 'purchase-requests', label: 'Purchase requests' },
  ];
  const mobileSellingTotal = useMemo(() => {
    const rentalsTotal = ownerBookings.reduce((sum, booking) => sum + (Number(booking.rental_fee_total ?? booking.total_due) || 0), 0);
    const salesTotal = sellerPurchaseRequests.reduce((sum, request) => {
      const qty = Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 1;
      const totalPaid = Number(request.sale_total_amount_snapshot) || (Number(request.sale_price_snapshot) || 0) * qty;
      const sellerAmount = Math.max(0, totalPaid - (Number(request.commission_fee_snapshot) || 0));
      return sum + sellerAmount;
    }, 0);
    return rentalsTotal + salesTotal;
  }, [ownerBookings, sellerPurchaseRequests]);
  const mobileRecentOrders = useMemo(
    () =>
      [...borrowerBookings, ...ownerBookings]
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 4),
    [borrowerBookings, ownerBookings]
  );

  const renderBookingSort = (group) => (
    <label className="borrowed-bookings-sort">Sort by
      <select aria-label={`Sort ${group} table`} onChange={(event) => setBookingSorts((current) => ({ ...current, [group]: event.target.value }))} value={bookingSorts[group]}>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="amount-high">Amount: high to low</option>
        <option value="amount-low">Amount: low to high</option>
        <option value="status">Status</option>
        <option value="item">Item name</option>
      </select>
    </label>
  );

  const recordRentalCheckoutTransactions = useCallback(
    async (bookingsToRecord) => {
      const failures = [];
      const adminPayeeId = await resolveAdminPayeeId();

      for (const booking of bookingsToRecord || []) {
        if (!booking?.id || !booking?.owner_id || !booking?.borrower_id) {
          continue;
        }

        const rentalFeeAmount = toMoneyAmount(booking.rental_fee_total);
        const securityDepositAmount = toMoneyAmount(booking.security_deposit);
        const totalDueAmount = toMoneyAmount(booking.total_due);
        const platformFeeAmount = toMoneyAmount(Math.max(0, totalDueAmount - rentalFeeAmount - securityDepositAmount));
        const bookedItemLabel = booking.item?.title || 'rental item';

        const lineItems = [
          {
            amount: rentalFeeAmount,
            notes: `Rental fee payment for ${bookedItemLabel}.`,
            payee_id: booking.owner_id,
            reference_number: `paymongo:rent:rental_fee:${booking.id}`,
            transactionTypeCandidates: PAYMENT_TYPE_CANDIDATES.rentalFee,
          },
          {
            amount: securityDepositAmount,
            notes: `Security deposit payment for ${bookedItemLabel}.`,
            payee_id: booking.owner_id,
            reference_number: `paymongo:rent:security_deposit:${booking.id}`,
            transactionTypeCandidates: PAYMENT_TYPE_CANDIDATES.securityDeposit,
          },
          {
            amount: platformFeeAmount,
            notes: `Platform commission fee for ${bookedItemLabel}.`,
            payee_id: adminPayeeId,
            reference_number: `paymongo:rent:platform_fee:${booking.id}`,
            transactionTypeCandidates: PAYMENT_TYPE_CANDIDATES.platformFee,
          },
        ].filter((lineItem) => lineItem.amount > 0);

        for (const lineItem of lineItems) {
          try {
            await insertPaymentTransactionWithTypeFallback(
              {
                amount: lineItem.amount,
                booking_id: booking.id,
                notes: lineItem.notes,
                payee_id: lineItem.payee_id,
                payer_id: booking.borrower_id,
                payment_method: PAYMONGO_PAYMENT_METHOD,
                reference_number: lineItem.reference_number,
                status: DEFAULT_PAYMENT_STATUS,
                transaction_at: new Date().toISOString(),
              },
              lineItem.transactionTypeCandidates
            );
          } catch (error) {
            failures.push(`${booking.id}: ${error.message || 'Unable to record rental payment transaction.'}`);
          }
        }
      }

      return failures;
    },
    [resolveAdminPayeeId]
  );

  useEffect(() => {
    const queryTab = new URLSearchParams(location.search).get('tab');
    if (queryTab === 'dues') {
      setActiveBookingFilter('borrowed');
    } else if (queryTab === 'schedule') {
      setActiveBookingFilter('approval');
    }
  }, [location.search]);

  function openBookingDetail(booking) {
    if (!booking?.id) {
      return;
    }

    setBookingDetailLateFeePayments([]);
    setBookingDetailLateFeePaymentsError('');
    setBookingDetailLateFeePaymentsLoading(true);
    setBookingDetailId(booking.id);
  }

  function closeBookingDetail() {
    setBookingDetailId('');
    setBookingDetailLateFeePayments([]);
    setBookingDetailLateFeePaymentsError('');
    setBookingDetailLateFeePaymentsLoading(false);
  }

  const autoApprovePaidBookings = useCallback(async (bookingIds) => {
    const normalizedBookingIds = Array.from(new Set((bookingIds || []).filter(Boolean)));

    if (!normalizedBookingIds.length) {
      return { failedIds: [], updatedCount: 0 };
    }

    const { data: fetchedBookings, error: fetchError } = await supabase
      .from('bookings')
      .select('id, item_id, borrower_id, owner_id, requested_start, requested_end, approved_start, approved_end, rental_days, rental_price_per_day, rental_fee_total, security_deposit, total_due, borrower_message, status, cancelled_by, cancellation_reason, created_at, updated_at')
      .in('id', normalizedBookingIds)
      .eq('borrower_id', userId);

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    const borrowerBookingsFromPayment = fetchedBookings || [];
    const transactionRecordFailures = await recordRentalCheckoutTransactions(borrowerBookingsFromPayment);
    const targetBookings = borrowerBookingsFromPayment.filter(
      (booking) => String(booking.status || '').toLowerCase() === BOOKING_STATUS.PENDING
    );
    const updatesById = new Map();
    const failedIds = [];

    for (const booking of targetBookings) {
      let appliedStatus = '';

      for (const status of APPROVAL_STATUS_CANDIDATES) {
        const { error: updateError } = await supabase
          .from('bookings')
          .update({
            approved_end: booking.requested_end,
            approved_start: booking.requested_start,
            status,
          })
          .eq('id', booking.id)
          .eq('borrower_id', userId)
          .eq('status', BOOKING_STATUS.PENDING);

        if (!updateError) {
          appliedStatus = status;
          break;
        }
      }

      if (!appliedStatus) {
        failedIds.push(booking.id);
        continue;
      }

      updatesById.set(booking.id, {
        approved_end: booking.requested_end,
        approved_start: booking.requested_start,
        status: appliedStatus,
      });
    }

    if (updatesById.size) {
      setBookings((current) =>
        current.map((booking) => {
          const update = updatesById.get(booking.id);

          if (!update) {
            return booking;
          }

          return {
            ...booking,
            approved_end: update.approved_end,
            approved_start: update.approved_start,
            status: update.status,
            updated_at: new Date().toISOString(),
          };
        })
      );
    }

    return {
      failedIds,
      transactionRecordFailures,
      updatedCount: updatesById.size,
    };
  }, [recordRentalCheckoutTransactions, userId]);

  async function updateBookingStatusWithFallback(booking, statuses, extraPayload = {}) {
    let lastError = null;

    for (const status of statuses) {
      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          ...extraPayload,
          status,
        })
        .eq('id', booking.id)
        .eq('owner_id', userId);

      if (!updateError) {
        return status;
      }

      lastError = updateError;
    }

    if (lastError) {
      throw new Error(lastError.message);
    }

    throw new Error('Unable to update booking status.');
  }

  async function cancelBorrowerBookingWithFallback(booking, statuses, extraPayload = {}) {
    let lastError = null;

    for (const status of statuses) {
      const { data: updatedRows, error: updateError } = await supabase
        .from('bookings')
        .update({
          ...extraPayload,
          status: BOOKING_STATUS.CANCELLED,
        })
        .eq('id', booking.id)
        .eq('borrower_id', userId)
        .eq('status', status)
        .select('id, status, cancelled_by, cancellation_reason')
        .limit(1);

      if (updateError) {
        lastError = updateError;
        continue;
      }

      if ((updatedRows || []).length) {
        return updatedRows[0];
      }
    }

    if (lastError) {
      throw new Error(lastError.message);
    }

    throw new Error('This booking could not be cancelled. It may have already changed status.');
  }

  useEffect(() => {
    if (loading || !userId || payMongoAutoApprovalHandledRef.current) {
      return;
    }

    const query = new URLSearchParams(window.location.search);

    if (query.get('paymongo') !== 'success') {
      return;
    }

    payMongoAutoApprovalHandledRef.current = true;

    const bookingIds = String(query.get('booking_ids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    let ignore = false;

    async function applyPaidAutoApproval() {
      setBookingActionBusyId('paymongo-auto-approve');

      try {
        const { failedIds, transactionRecordFailures, updatedCount } = await autoApprovePaidBookings(bookingIds);

        if (ignore) {
          return;
        }

        if (!bookingIds.length) {
          setMessage('Payment callback was detected, but no booking references were provided.');
          setMessageTone('warning');
          return;
        }

        if (!updatedCount) {
          setMessage('Payment finished, but no pending bookings were auto-approved.');
          setMessageTone('warning');
          return;
        }

        if (failedIds.length) {
          setMessage(`Payment succeeded. ${updatedCount} booking(s) were auto-approved, but ${failedIds.length} booking(s) still need attention.`);
          setMessageTone('warning');
        } else if (transactionRecordFailures?.length) {
          console.warn('Payment transaction records need synchronization:', transactionRecordFailures);
          setMessage(`Payment completed and ${updatedCount} booking(s) were approved. Your receipt is still being synchronized.`);
          setMessageTone('warning');
        } else {
          setMessage(`Payment succeeded. ${updatedCount} booking(s) were automatically approved.`);
          setMessageTone('success');
        }
      } catch (approvalError) {
        if (!ignore) {
          setMessage(`Payment succeeded, but auto-approval failed: ${approvalError.message}`);
          setMessageTone('warning');
        }
      } finally {
        if (!ignore) {
          await loadListings(false);
          setActiveBookingFilter('borrowed');
          setBookingActionBusyId('');
          setPaymentReturnProcessing(false);
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    }

    applyPaidAutoApproval();

    return () => {
      ignore = true;
    };
  }, [autoApprovePaidBookings, loadListings, loading, userId]);

  useEffect(() => {
    if (loading || !userId) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const paymentStatus = query.get('payment_status');
    const bookingId = query.get('booking_id');
    const isLateFeePayment = query.get('late_fee_paid') === 'true';

    if (paymentStatus !== 'success' || !isLateFeePayment || !bookingId) {
      return;
    }

    let ignore = false;

    async function processLateFeePayment() {
      setBookingActionBusyId(bookingId);

      try {
        const adminPayeeId = await resolveAdminPayeeId();
        // Find the late fee transactions for this booking
        let { data: lateFeeTxns, error: fetchError } = await supabase
          .from('payment_transactions')
          .select('id, transaction_type, amount, status, payment_method')
          .eq('booking_id', bookingId)
          .in('transaction_type', ['late_fee_owner_share', 'late_fee_admin_share']);

        if (fetchError) {
          throw new Error(fetchError.message);
        }

        if (!lateFeeTxns || lateFeeTxns.length === 0) {
          const { data: bookingRow, error: bookingError } = await supabase
            .from('bookings')
            .select('id, borrower_id, owner_id, approved_end, requested_end, rental_price_per_day')
            .eq('id', bookingId)
            .limit(1)
            .maybeSingle();

          if (bookingError) {
            throw new Error(bookingError.message);
          }

          if (!bookingRow?.id) {
            throw new Error('Booking not found for late fee transaction recording.');
          }

          const lateFee = calculateLateFee(bookingRow);
          const fallbackLateFeeTransactions = [
            {
              amount: lateFee.ownerShare,
              booking_id: bookingRow.id,
              notes: `Late fee: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Owner share 85%.`,
              payee_id: bookingRow.owner_id,
              payer_id: bookingRow.borrower_id,
              payment_method: PAYMONGO_PAYMENT_METHOD,
              reference_number: `paymongo:late_fee:owner:${bookingRow.id}`,
              status: 'pending',
              transaction_at: new Date().toISOString(),
              transaction_type: 'late_fee_owner_share',
            },
            {
              amount: lateFee.adminShare,
              booking_id: bookingRow.id,
              notes: `Late fee: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Admin share 15%.`,
              payee_id: adminPayeeId,
              payer_id: bookingRow.borrower_id,
              payment_method: PAYMONGO_PAYMENT_METHOD,
              reference_number: `paymongo:late_fee:admin:${bookingRow.id}`,
              status: 'pending',
              transaction_at: new Date().toISOString(),
              transaction_type: 'late_fee_admin_share',
            },
          ].filter((transaction) => Number(transaction.amount) > 0);

          if (fallbackLateFeeTransactions.length) {
            const { error: lateFeeInsertError } = await supabase.from('payment_transactions').insert(fallbackLateFeeTransactions);
            if (lateFeeInsertError) {
              throw new Error(lateFeeInsertError.message);
            }
          }

          const { data: recreatedLateFeeTxns, error: refetchError } = await supabase
            .from('payment_transactions')
            .select('id, transaction_type, amount, status, payment_method')
            .eq('booking_id', bookingId)
            .in('transaction_type', ['late_fee_owner_share', 'late_fee_admin_share']);

          if (refetchError) {
            throw new Error(refetchError.message);
          }

          lateFeeTxns = recreatedLateFeeTxns || [];
        }

        if (!lateFeeTxns.length) {
          throw new Error('No late fee transactions are available for this booking.');
        }

        // Update all pending late fee transactions to recorded
        const { error: updateError } = await supabase
          .from('payment_transactions')
          .update({ status: 'recorded', transaction_at: new Date().toISOString() })
          .eq('booking_id', bookingId)
          .in('transaction_type', ['late_fee_owner_share', 'late_fee_admin_share'])
          .eq('status', 'pending');

        if (updateError) {
          throw new Error(updateError.message);
        }

        const { data: updatedBookings, error: bookingUpdateError } = await supabase
          .from('bookings')
          .update({ status: BOOKING_STATUS.RETURN_PENDING, updated_at: new Date().toISOString() })
          .eq('id', bookingId)
          .eq('borrower_id', userId)
          .select('id, status')
          .limit(1);

        const returnPendingBooking = (updatedBookings || [])[0];
        if (bookingUpdateError || !returnPendingBooking) {
          throw new Error(bookingUpdateError?.message || 'Late fee was recorded, but the return could not be submitted for owner confirmation.');
        }

        // Reload bookings to reflect updated state
        await loadListings(false);

        if (!ignore) {
          const totalAmount = lateFeeTxns.reduce((sum, txn) => sum + Number(txn.amount), 0);
          const depositApplied = lateFeeTxns
            .filter((transaction) => transaction.payment_method === 'security_deposit')
            .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
          const payMongoAmount = Math.max(0, totalAmount - depositApplied);
          setBookings((current) => current.map((booking) => booking.id === bookingId ? { ...booking, status: returnPendingBooking.status, updated_at: new Date().toISOString() } : booking));
          setBookingDetailId(bookingId);
          setActiveBookingFilter('borrowed');
          setMessage(
          `${currencyFormatter.format(depositApplied)} was applied from the security deposit and `
            + `${currencyFormatter.format(payMongoAmount)} was paid through PayMongo. `
            + 'The return is awaiting the owner\u2019s confirmation.'
          );
          setMessageTone('success');
          setBookingActionBusyId('');
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch (paymentError) {
        if (!ignore) {
          setMessage(`Payment succeeded, but failed to update late fee status: ${paymentError.message}`);
          setMessageTone('warning');
          setBookingActionBusyId('');
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    }

    processLateFeePayment();

    return () => {
      ignore = true;
    };
  }, [loading, userId, loadListings, resolveAdminPayeeId]);

  useEffect(() => {
    if (loading || !userId) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const paymentStatus = query.get('payment_status');
    const purchaseRequestId = query.get('purchase_request_id');
    const isPurchasePayment = query.get('purchase_paid') === 'true';

    if (paymentStatus !== 'success' || !isPurchasePayment || !purchaseRequestId) {
      return;
    }

    let ignore = false;

    async function processPurchasePayment() {
      setBookingActionBusyId(`purchase:${purchaseRequestId}`);

      try {
        const { data: paymentResult, error: paymentError } = await supabase.functions.invoke('purchase-payment', {
          body: {
            checkout_session_id: query.get('checkout_session_id') || undefined,
            purchase_request_id: purchaseRequestId,
          },
        });
        if (paymentError) {
          let details = paymentError.message || 'Unable to verify the PayMongo payment.';
          if (paymentError.context && typeof paymentError.context.json === 'function') {
            const responseBody = await paymentError.context.json().catch(() => null);
            details = responseBody?.error || details;
          }
          throw new Error(details);
        }
        if (!paymentResult?.paid) throw new Error(paymentResult?.error || 'PayMongo has not confirmed this payment yet.');

        await loadListings(false);

        if (!ignore) {
          setActiveBookingFilter('purchase-requests');
          setMessage('Purchase payment completed. You can now mark the item as claimed after pickup.');
          setMessageTone('success');
          setBookingActionBusyId('');
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch (paymentError) {
        if (!ignore) {
          setMessage(`Unable to verify or record purchase payment: ${paymentError.message}`);
          setMessageTone('warning');
          setBookingActionBusyId('');
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    }

    processPurchasePayment();

    return () => {
      ignore = true;
    };
  }, [loading, userId, loadListings]);

  useEffect(() => {
    if (loading || !userId) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const paymentStatus = query.get('payment_status');
    const bookingId = query.get('booking_id');
    const damageClaimId = query.get('damage_claim_id');
    const isDamageClaimPayment = query.get('damage_claim_paid') === 'true';

    if (paymentStatus !== 'success' || !isDamageClaimPayment || !bookingId || !damageClaimId) {
      return;
    }

    let ignore = false;

    async function processDamageClaimPayment() {
      setBookingActionBusyId(bookingId);

      try {
        const { data: bookingRow, error: bookingFetchError } = await supabase
          .from('bookings')
          .select('id, borrower_id, owner_id, item_id')
          .eq('id', bookingId)
          .limit(1)
          .maybeSingle();

        if (bookingFetchError) {
          throw new Error(bookingFetchError.message);
        }

        const { data: claimRow, error: claimFetchError } = await supabase
          .from('damage_claims')
          .select('id, amount_due, admin_approved_amount, claimed_amount')
          .eq('id', damageClaimId)
          .limit(1)
          .maybeSingle();

        if (claimFetchError) {
          throw new Error(claimFetchError.message);
        }

        const damageAmount = toMoneyAmount(
          claimRow?.amount_due || claimRow?.admin_approved_amount || claimRow?.claimed_amount || 0
        );

        const paymentReferenceNumber = `paymongo:damage:${damageClaimId}`;
        let damagePaymentTransactionId = '';

        if (damageAmount > 0) {
          const { data: existingDamagePayment, error: existingDamagePaymentError } = await supabase
            .from('payment_transactions')
            .select('id, status')
            .eq('booking_id', bookingId)
            .eq('damage_claim_id', damageClaimId)
            .eq('transaction_type', 'damage_payment')
            .order('transaction_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (existingDamagePaymentError) {
            throw new Error(existingDamagePaymentError.message);
          }

          if (!existingDamagePayment?.id) {
            const { transaction } = await insertPaymentTransactionWithTypeFallback(
              {
                amount: damageAmount,
                booking_id: bookingId,
                damage_claim_id: damageClaimId,
                notes: `Damage claim payment for booking ${bookingId}.`,
                payee_id: bookingRow?.owner_id || null,
                payer_id: bookingRow?.borrower_id || userId,
                payment_method: PAYMONGO_PAYMENT_METHOD,
                reference_number: paymentReferenceNumber,
                status: DEFAULT_PAYMENT_STATUS,
                transaction_at: new Date().toISOString(),
              },
              ['damage_payment', 'payment']
            );
            damagePaymentTransactionId = transaction?.id || '';
          } else {
            damagePaymentTransactionId = existingDamagePayment.id;
          }
        }

        const paymentUpdateQuery = supabase
          .from('payment_transactions')
          .update({ status: 'recorded', transaction_at: new Date().toISOString() })
          .eq('booking_id', bookingId)
          .eq('damage_claim_id', damageClaimId)
          .eq('reference_number', paymentReferenceNumber)
          .select('id, status');

        const { data: paymentUpdateRows, error: paymentUpdateError } = damagePaymentTransactionId
          ? await paymentUpdateQuery.eq('id', damagePaymentTransactionId)
          : await paymentUpdateQuery;

        if (paymentUpdateError) {
          throw new Error(paymentUpdateError.message);
        }

        if (!Array.isArray(paymentUpdateRows) || !paymentUpdateRows.length) {
          throw new Error('Payment transaction was not finalized. Please ask admin to review the payment record.');
        }

        const { error: finalizeClaimError } = await supabase.rpc('finalize_damage_claim_payment', {
          p_damage_claim_id: damageClaimId,
          p_payment_reference: paymentReferenceNumber,
        });

        if (finalizeClaimError) {
          throw new Error(finalizeClaimError.message);
        }

        await loadListings(false);

        if (!ignore) {
          setActiveBookingFilter('damage-reports');
          setMessage('Damage claim payment completed. Account restriction should now be lifted.');
          setMessageTone('success');
          setBookingActionBusyId('');
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch (paymentError) {
        if (!ignore) {
          setMessage(`Damage payment succeeded, but post-payment update failed: ${paymentError.message}`);
          setMessageTone('warning');
          setBookingActionBusyId('');
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    }

    processDamageClaimPayment();

    return () => {
      ignore = true;
    };
  }, [loading, userId, loadListings]);

  useEffect(() => {
    if (loading || !bookings.length) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const damageClaimId = query.get('damage_claim_id');
    const bookingId = query.get('booking_id');
    const isPaymentCallback = query.get('payment_status') === 'success';

    if (!damageClaimId && !bookingId) {
      return;
    }

    const targetBooking = bookings.find((booking) => {
      if (bookingId && booking.id === bookingId) {
        return true;
      }
      return damageClaimId && booking.damageClaim?.id === damageClaimId;
    });

    setActiveBookingFilter('borrowed');

    if (targetBooking?.id) {
      setBookingDetailId(targetBooking.id);
      if (targetBooking.damageClaim) {
        const amountDue = Number(targetBooking.damageClaim.amount_due) || Number(targetBooking.damageClaim.claimed_amount) || 0;
        setMessage(`Pending damage balance: ${currencyFormatter.format(amountDue)} for ${targetBooking.item?.title || 'the damaged item'}.`);
        setMessageTone('warning');
      }
    }

    // Payment effects clear callback parameters after their updates finish. Keeping
    // them here also lets React Strict Mode safely replay the callback effect.
    if (!isPaymentCallback) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [bookings, loading]);

  useEffect(() => {
    if (!bookingDetail?.damageClaim?.id) {
      setBookingDamageClaimDetail(null);
      setBookingDamageClaimLoading(false);
      return;
    }

    let ignore = false;
    setBookingDamageClaimLoading(true);

    async function loadBookingDamageClaimDetail() {
      try {
        const detail = await getDamageClaimWithEvidence(bookingDetail.damageClaim.id);
        if (!ignore) {
          setBookingDamageClaimDetail(detail || null);
        }
      } catch (_error) {
        if (!ignore) {
          setBookingDamageClaimDetail(null);
        }
      } finally {
        if (!ignore) {
          setBookingDamageClaimLoading(false);
        }
      }
    }

    loadBookingDamageClaimDetail();

    return () => {
      ignore = true;
    };
  }, [bookingDetail?.damageClaim?.id]);

  async function handleApproveBooking(booking) {
    if (!booking?.id) {
      return;
    }

    setBookingActionBusyId(booking.id);
    setMessage('');

    try {
      const nextStatus = await updateBookingStatusWithFallback(booking, APPROVAL_STATUS_CANDIDATES, {
        approved_end: booking.requested_end,
        approved_start: booking.requested_start,
      });

      setBookings((current) =>
        current.map((currentBooking) =>
          currentBooking.id === booking.id
            ? {
                ...currentBooking,
                approved_end: booking.requested_end,
                approved_start: booking.requested_start,
                status: nextStatus,
                updated_at: new Date().toISOString(),
              }
            : currentBooking
        )
      );

      setMessage('Booking approved.');
      setMessageTone('success');
      if (bookingDetailId === booking.id) {
        setBookingDetailId('');
      }
    } catch (approveError) {
      setMessage(`Unable to approve booking: ${approveError.message}`);
      setMessageTone('warning');
    } finally {
      setBookingActionBusyId('');
    }
  }

  async function handleApprovePurchaseRequest(request) {
    if (!request?.id) {
      return;
    }

    const approvedQuantity = Number(request.buyer_requested_quantity || 0);
    if (!Number.isInteger(approvedQuantity) || approvedQuantity < 1) {
      setMessage('Requested quantity is invalid.');
      setMessageTone('warning');
      return;
    }

    const busyKey = `purchase:${request.id}`;
    setBookingActionBusyId(busyKey);
    setMessage('');

    try {
      await approveItemPurchaseRequest({
        requestId: request.id,
        approvedQuantity,
        agreedPickupAt: request.buyer_preferred_pickup_at || null,
        pickupLocationText: null,
        sellerNotes: null,
      });

      setMessage(
        `Purchase request approved. ${approvedQuantity} unit${approvedQuantity === 1 ? '' : 's'} reserved from ${request.item?.title || 'the item'} stock.`
      );
      setMessageTone('success');
      await loadListings(false);
    } catch (approveError) {
      setMessage(`Unable to approve purchase request: ${approveError.message}`);
      setMessageTone('warning');
    } finally {
      setBookingActionBusyId('');
    }
  }

  async function handlePayPurchaseRequest(request) {
    if (!request?.id) {
      return;
    }

    const quantity = Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 0;
    const amountToPay = Number(request.sale_total_amount_snapshot) || (Number(request.sale_price_snapshot) || 0) * quantity;

    if (amountToPay <= 0) {
      setMessage('Purchase amount is invalid.');
      setMessageTone('warning');
      return;
    }

    const busyKey = `purchase:${request.id}`;
    setBookingActionBusyId(busyKey);
    setMessage('');

    try {
      const successUrl = `${window.location.origin}${window.location.pathname}?payment_status=success&purchase_paid=true&purchase_request_id=${encodeURIComponent(
        request.id
      )}`;
      const cancelUrl = `${window.location.origin}${window.location.pathname}`;
      const checkoutSession = await createTestCheckoutSession({
        amount: amountToPay,
        cancelUrl,
        currency: 'PHP',
        description: `Purchase payment for ${request.item?.title || 'sale item'}`,
        lineItems: [
          {
            amount: Number(request.sale_price_snapshot) || 0,
            name: `${request.item?.title || 'Sale item'} purchase`,
            quantity: quantity > 0 ? quantity : 1,
          },
          ...(request.addons || []).map((addon) => ({
            amount: Number(addon.price_snapshot) || 0,
            description: addon.description_snapshot || undefined,
            name: `${addon.addon_name_snapshot || 'Purchase'} add-on`,
            quantity: Number(addon.quantity) || 1,
          })),
          ...(Number(request.commission_fee_snapshot) > 0 ? [{
            amount: Number(request.commission_fee_snapshot),
            description: 'Borrow Ko To marketplace service fee',
            name: 'Platform commission (15%)',
            quantity: 1,
          }] : []),
        ],
        showLineItems: true,
        metadata: {
          item_id: request.item_id,
          purchase_request_id: request.id,
          source: 'purchase_request_payment',
        },
        referenceNumber: request.id,
        successUrl,
      });

      if (checkoutSession?.id && checkoutSession?.attributes?.checkout_url) {
        const { error: linkError } = await supabase.rpc('set_item_purchase_checkout_session', {
          p_checkout_session_id: checkoutSession.id,
          p_livemode: Boolean(checkoutSession.attributes.livemode),
          p_request_id: request.id,
        });
        if (linkError) throw new Error(linkError.message || 'Unable to link this checkout to the purchase request.');
        window.location.href = checkoutSession.attributes.checkout_url;
      } else {
        throw new Error('PayMongo did not return a checkout session.');
      }
    } catch (paymentError) {
      setMessage(`Unable to process purchase payment: ${paymentError.message}`);
      setMessageTone('warning');
      setBookingActionBusyId('');
    }
  }

  async function handleRecoverPurchasePayment() {
    const purchaseRequestId = purchasePaymentRecovery?.id;
    const checkoutSessionId = purchasePaymentRecoverySessionId.trim();
    if (!purchaseRequestId || !checkoutSessionId) return;

    const busyKey = `purchase-recovery:${purchaseRequestId}`;
    setBookingActionBusyId(busyKey);
    setMessage('');
    try {
      const { data, error } = await supabase.functions.invoke('purchase-payment', {
        body: { checkout_session_id: checkoutSessionId, purchase_request_id: purchaseRequestId },
      });
      if (error) {
        let details = error.message || 'Unable to verify the PayMongo payment.';
        if (error.context && typeof error.context.json === 'function') {
          const responseBody = await error.context.json().catch(() => null);
          details = responseBody?.error || details;
        }
        throw new Error(details);
      }
      if (!data?.paid) throw new Error(data?.error || 'PayMongo has not confirmed this payment yet.');

      setPurchasePaymentRecovery(null);
      setPurchasePaymentRecoverySessionId('');
      setMessage('The original PayMongo payment was verified and recorded.');
      setMessageTone('success');
      await loadListings(false);
    } catch (error) {
      setMessage(error.message || 'Unable to verify the PayMongo payment.');
      setMessageTone('warning');
    } finally {
      setBookingActionBusyId('');
    }
  }

  async function handleCancelPurchaseRequest(request) {
    if (!request?.id) return;

    const busyKey = `purchase:${request.id}`;
    setBookingActionBusyId(busyKey);
    setMessage('');

    try {
      const status = String(request.status || '').toLowerCase();
      if (status === 'awaiting_payment') {
        const cancelResult = await supabase.rpc('cancel_item_purchase_checkout', { p_request_id: request.id });
        if (cancelResult.error) throw new Error(cancelResult.error.message);
      } else {
        const cancelResult = await supabase
          .from('item_purchase_requests')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', request.id)
          .eq('buyer_id', userId)
          .eq('status', 'pending');
        if (cancelResult.error) throw new Error(cancelResult.error.message);
      }

      await loadListings(false);
      setActiveBookingFilter('purchase-requests');
      setMessage('Purchase request cancelled. Reserved stock was released.');
      setMessageTone('success');
    } catch (cancelError) {
      setMessage(`Unable to cancel purchase request: ${cancelError.message}`);
      setMessageTone('warning');
    } finally {
      setBookingActionBusyId('');
    }
  }

  async function handleMarkPurchaseClaimed(request) {
    if (!request?.id) {
      return;
    }

    const busyKey = `purchase:${request.id}`;
    setBookingActionBusyId(busyKey);
    setMessage('');

    try {
      const { data: claimed, error: claimError } = await supabase.rpc('claim_item_purchase_request', {
        p_request_id: request.id,
      });

      if (claimError) throw new Error(claimError.message);
      if (claimed !== true) throw new Error('The purchase status was not updated. Please refresh and try again.');

      setPurchaseRequests((current) => current.map((purchase) => (
        purchase.id === request.id
          ? { ...purchase, completed_at: purchase.completed_at || new Date().toISOString(), status: 'completed' }
          : purchase
      )));

      await loadListings(false);
      setActiveBookingFilter('purchase-requests');
      setMessage('Purchase marked as claimed.');
      setMessageTone('success');
    } catch (claimError) {
      setMessage(`Unable to mark purchase as claimed: ${claimError.message}`);
      setMessageTone('warning');
    } finally {
      setBookingActionBusyId('');
    }
  }

  async function handleMarkReturned(booking) {
    if (!booking?.id) {
      return;
    }

    setBookingActionBusyId(booking.id);
    setMessage('');
    setReturnCompletionNotice(null);

    try {
      const returnedAt = new Date();
      const lateFee = calculateLateFee(booking, returnedAt);
      let depositReturnRecordError = '';
      let depositReturnSkippedReason = '';
      let depositReturnedAmount = 0;
      const securityDepositAmount = toMoneyAmount(Number(booking.security_deposit || 0));
      let settledLateFeeTotal = Number(lateFee.total || 0);

      if (lateFee.total > 0) {
        const { data: lateFeeTransactions, error: lateFeeTransactionError } = await supabase
          .from('payment_transactions')
          .select('id, amount, status, transaction_type')
          .eq('booking_id', booking.id)
          .in('transaction_type', ['late_fee_owner_share', 'late_fee_admin_share']);

        if (lateFeeTransactionError) {
          throw new Error(`Unable to verify late-fee payment: ${lateFeeTransactionError.message}`);
        }

        const payableTransactions = (lateFeeTransactions || []).filter((transaction) => Number(transaction.amount || 0) > 0);
        const hasUnsettledPayment = payableTransactions.some(
          (transaction) => !SETTLED_LATE_FEE_PAYMENT_STATUSES.has(String(transaction.status || '').toLowerCase())
        );

        if (!payableTransactions.length || hasUnsettledPayment) {
          throw new Error('The borrower must pay the late fee through PayMongo before you can confirm the item return.');
        }

        settledLateFeeTotal = toMoneyAmount(
          payableTransactions.reduce((total, transaction) => total + Number(transaction.amount || 0), 0)
        );
      }

      const lateFeeCoveredByDeposit = toMoneyAmount(Math.min(securityDepositAmount, settledLateFeeTotal));
      const nextStatus = await updateBookingStatusWithFallback(booking, RETURN_STATUS_CANDIDATES);
      const refundableDepositAmount = lateFee.total > 0
        ? 0
        : securityDepositAmount;

      if (booking?.damageClaim?.id) {
        depositReturnSkippedReason = 'deposit is held because this booking has a damage claim';
      } else if (lateFee.total > 0 && securityDepositAmount > 0) {
        depositReturnSkippedReason = 'no security deposit refund is issued when a booking has a late fee';
      } else if (refundableDepositAmount <= 0 && securityDepositAmount > 0) {
        depositReturnSkippedReason = 'the security deposit was fully applied to the late fee';
      } else if (refundableDepositAmount > 0) {
        try {
          await insertPaymentTransactionWithTypeFallback(
            {
              amount: refundableDepositAmount,
              booking_id: booking.id,
              notes: `Security deposit return for ${booking.item?.title || 'rental item'} after return confirmation.`,
              payee_id: booking.borrower_id,
              payer_id: booking.owner_id,
              payment_method: 'security_deposit',
              reference_number: `paymongo:deposit:return:${booking.id}`,
              status: DEFAULT_PAYMENT_STATUS,
              transaction_at: returnedAt.toISOString(),
            },
            PAYMENT_TYPE_CANDIDATES.depositReturn
          );
          depositReturnedAmount = refundableDepositAmount;
        } catch (depositRecordError) {
          depositReturnRecordError = depositRecordError.message || 'Unable to record returned security deposit.';
        }
      }

      setBookings((current) =>
        current.map((currentBooking) =>
          currentBooking.id === booking.id
            ? {
                ...currentBooking,
                status: nextStatus,
                updated_at: new Date().toISOString(),
              }
          : currentBooking
        )
      );
      closeBookingDetail();

      if (lateFee.total > 0) {
        const payMongoBalance = toMoneyAmount(Math.max(0, settledLateFeeTotal - lateFeeCoveredByDeposit));
        const lateFeeMessage = 'The return was confirmed and the booking is now complete.';
        if (depositReturnRecordError) {
          setReturnCompletionNotice({
            message: `${lateFeeMessage} Deposit return record also failed: ${depositReturnRecordError}`,
            tone: 'warning',
            title: 'Booking completed with a deposit issue',
          });
        } else {
          setReturnCompletionNotice({
            itemTitle: booking.item?.title || 'Rented item',
            message: lateFeeMessage,
            paymentSummary: {
              depositApplied: lateFeeCoveredByDeposit,
              lateFeeTotal: lateFee.total,
              payMongoPaid: payMongoBalance,
            },
            tone: 'success',
            title: 'Booking completed',
          });
        }
      } else {
        const depositMessage =
          depositReturnedAmount > 0
            ? ` Security deposit returned: ${currencyFormatter.format(depositReturnedAmount)}.`
            : depositReturnSkippedReason
              ? ` Security deposit not returned now: ${depositReturnSkippedReason}.`
              : '';
        if (depositReturnRecordError) {
          setReturnCompletionNotice({
            message: `Booking marked as done/returned. No late fee was applied.${depositMessage} Deposit return recording failed: ${depositReturnRecordError}`,
            tone: 'warning',
            title: 'Booking completed with a deposit issue',
          });
        } else {
          setReturnCompletionNotice({
            itemTitle: booking.item?.title || 'Rented item',
            message: `Booking marked as done/returned. No late fee was applied.${depositMessage}`,
            securityDepositReturned: depositReturnedAmount,
            tone: 'success',
            title: 'Booking completed',
          });
        }
      }
    } catch (doneError) {
      setReturnCompletionNotice({
        message: `Unable to mark booking as done: ${doneError.message}`,
        tone: 'warning',
        title: 'Could not complete booking',
      });
    } finally {
      setBookingActionBusyId('');
    }
  }

  function openDamageReport(booking) {
    if (booking?.damageClaim && !isRejectedDamageClaim(booking.damageClaim)) {
      openDamageClaimDetail(booking);
      return;
    }

    const reportWindow = getDamageReportWindowStatus(booking);

    if (!reportWindow.canReport) {
      setMessage('Damage reports can only be submitted within 24 hours after the booking is completed.');
      setMessageTone('warning');
      return;
    }

    setDamageReportBooking(booking);
    setDamageReportForm(createDamageReportForm());
    setMessage('');
  }

  async function openDamageClaimDetail(booking) {
    setDamageClaimDetailBooking(booking);
    setDamageClaimDetail(null);

    if (!booking?.damageClaim?.id) {
      return;
    }

    setDamageClaimDetailLoading(true);
    try {
      const detail = await getDamageClaimWithEvidence(booking.damageClaim.id);
      setDamageClaimDetail(detail || null);
    } catch (_error) {
      setDamageClaimDetail(null);
    } finally {
      setDamageClaimDetailLoading(false);
    }
  }

  function closeDamageClaimDetail() {
    setDamageClaimDetailBooking(null);
    setDamageClaimDetail(null);
    setDamageClaimDetailLoading(false);
  }

  function closeDamageReport() {
    if (savingDamageReport) {
      return;
    }

    setDamageReportBooking(null);
    setDamageReportForm(createDamageReportForm());
  }

  async function handleSubmitDamageReport(event) {
    event.preventDefault();

    if (!damageReportBooking?.id || !userId) {
      return;
    }

    if (!getDamageReportWindowStatus(damageReportBooking).canReport) {
      setMessage('The 24-hour damage report window for this completed booking has already closed.');
      setMessageTone('warning');
      return;
    }

    if (damageReportBooking?.damageClaim && !isRejectedDamageClaim(damageReportBooking.damageClaim)) {
      setMessage('A damage report already exists for this booking. Open View report to review it.');
      setMessageTone('warning');
      return;
    }

    const description = sanitizeText(damageReportForm.description);
    const evidenceFiles = Array.from(damageReportForm.files || []);

    if (!description) {
      setMessage('Describe the damage before submitting the report.');
      setMessageTone('warning');
      return;
    }

    if (!evidenceFiles.length) {
      setMessage('Upload at least one damage photo before submitting the report.');
      setMessageTone('warning');
      return;
    }

    setSavingDamageReport(true);
    setMessage('');

    try {
      const { data: existingDamageClaim, error: existingDamageClaimError } = await supabase
        .from('damage_claims')
        .select('id, status')
        .eq('booking_id', damageReportBooking.id)
        .neq('status', 'rejected')
        .limit(1)
        .maybeSingle();

      if (existingDamageClaimError) {
        throw new Error(existingDamageClaimError.message);
      }

      if (existingDamageClaim?.id) {
        throw new Error('An active damage report already exists for this booking.');
      }

      const claimedAmount = Number(damageReportBooking?.item?.estimated_value || 0);
      const reportId = await createDamageReport({
        bookingId: damageReportBooking.id,
        borrowerId: damageReportBooking.borrower_id,
        description,
        ownerId: userId,
      });

      await Promise.all(evidenceFiles.map((file) => uploadDamageEvidence(reportId, file, userId)));

      await createDamageClaim({
        bookingId: damageReportBooking.id,
        borrowerId: damageReportBooking.borrower_id,
        claimedAmount,
        damageDescription: description,
        itemId: damageReportBooking.item_id,
        ownerId: userId,
        reportId,
      });

      setDamageReportBooking(null);
      setDamageReportForm(createDamageReportForm());
      setMessage('Damage report submitted with photo evidence. The borrower is not restricted until admin approval.');
      setMessageTone('success');
      await loadListings(false);
    } catch (damageError) {
      setMessage(`Unable to submit damage report: ${damageError.message}`);
      setMessageTone('warning');
    } finally {
      setSavingDamageReport(false);
    }
  }

  async function handleCancelBooking(booking) {
    if (!booking?.id) {
      return;
    }

    if (!isBorrowerCancellableStatus(booking.status)) {
      setMessage('This booking can no longer be cancelled from your side.');
      setMessageTone('warning');
      return;
    }

    setBookingActionBusyId(booking.id);
    setMessage('');

    try {
      await cancelBorrowerBookingWithFallback(booking, BORROWER_CANCELLABLE_STATUS_CANDIDATES, {
        cancellation_reason: 'Cancelled by borrower.',
        cancelled_by: userId,
      });

      setBookings((current) =>
        current.map((currentBooking) =>
          currentBooking.id === booking.id
            ? {
                ...currentBooking,
                cancellation_reason: 'Cancelled by borrower.',
                cancelled_by: userId,
                status: BOOKING_STATUS.CANCELLED,
                updated_at: new Date().toISOString(),
              }
            : currentBooking
        )
      );

      setMessage('Booking cancelled successfully.');
      setMessageTone('success');
    } catch (cancelBookingError) {
      setMessage(`Unable to cancel booking: ${cancelBookingError.message}`);
      setMessageTone('warning');
    } finally {
      setBookingActionBusyId('');
    }
  }

  function openReviewBooking(booking) {
    setReviewBooking(booking);
    setReviewForm({ rating: '5', review_text: '' });
    setShowReviewModal(true);
  }

  async function handlePayLateFee(booking) {
    if (!booking?.id) {
      return;
    }

    setBookingActionBusyId(booking.id);
    setMessage('');

    try {
      const lateFee = calculateLateFee(booking);

      if (lateFee.total <= 0) {
        setMessage('No late fee to pay for this booking.');
        setMessageTone('info');
        setBookingActionBusyId('');
        return;
      }

      const { data: settlement, error: settlementError } = await supabase.rpc('prepare_late_fee_settlement', {
        p_booking_id: booking.id,
      });

      if (settlementError) {
        throw new Error(settlementError.message);
      }

      const payMongoDue = Number(settlement?.paymongo_due || 0);
      const depositApplied = Number(settlement?.deposit_applied || 0);
      const refundableDeposit = Number(settlement?.refundable_deposit || 0);

      if (payMongoDue <= 0) {
        await loadListings(false);
        setBookings((current) => current.map((currentBooking) => currentBooking.id === booking.id
          ? { ...currentBooking, status: BOOKING_STATUS.RETURN_PENDING, updated_at: new Date().toISOString() }
          : currentBooking));
        setMessage(
          `The ${currencyFormatter.format(depositApplied)} late fee was covered by your security deposit. `
          + `No security deposit refund will be issued because this booking had a late fee.`
        );
        setMessageTone('success');
        setBookingActionBusyId('');
        return;
      }

      const successUrl = `${window.location.origin}/user/manage-booking?payment_status=success&booking_id=${booking.id}&late_fee_paid=true`;
      const cancelUrl = `${window.location.origin}/user/manage-booking?payment_status=cancelled&booking_id=${booking.id}`;

      const checkoutSession = await createTestCheckoutSession({
        amount: payMongoDue,
        cancelUrl,
        currency: 'PHP',
        description: `Remaining late fee for "${booking.item?.title || 'rental'}" after security deposit`,
        metadata: {
          booking_id: booking.id,
          deposit_applied: depositApplied,
          late_fee_total: Number(settlement?.late_fee_total || lateFee.total),
          paymongo_due: payMongoDue,
          refundable_deposit: refundableDeposit,
          days_late: Number(settlement?.days_late || lateFee.daysLate),
          source: 'late_fee_payment',
        },
        successUrl,
      });

      if (checkoutSession?.attributes?.checkout_url) {
        window.location.href = checkoutSession.attributes.checkout_url;
      } else {
        throw new Error('Failed to get checkout URL from PayMongo.');
      }
    } catch (paymentError) {
      setMessage(`Unable to process late fee payment: ${paymentError.message}`);
      setMessageTone('warning');
      setBookingActionBusyId('');
    }
  }

  async function handlePayDamageClaim(booking) {
    if (!booking?.id || !booking.damageClaim?.id) {
      return;
    }

    if (!isPayableDamageClaim(booking.damageClaim)) {
      setMessage('This damage claim is still under admin review and is not available for payment.');
      setMessageTone('info');
      return;
    }

    setBookingActionBusyId(booking.id);
    setMessage('');

    try {
      const claim = booking.damageClaim;
      const amountToPay = Number(claim.amount_due) || Number(claim.admin_approved_amount) || Number(claim.claimed_amount) || 0;

      if (amountToPay <= 0) {
        setMessage('No damage balance is due for this claim.');
        setMessageTone('info');
        setBookingActionBusyId('');
        return;
      }

      const { data: existingTxn, error: existingTxnError } = await supabase
        .from('payment_transactions')
        .select(
          'id, booking_id, damage_claim_id, payer_id, payee_id, transaction_type, amount, payment_method, status, reference_number, proof_url, transaction_at, notes'
        )
        .eq('booking_id', booking.id)
        .eq('damage_claim_id', claim.id)
        .eq('transaction_type', 'damage_payment')
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();

      if (existingTxnError) {
        throw new Error(existingTxnError.message);
      }

      if (!existingTxn?.id) {
        await insertPaymentTransactionWithTypeFallback(
          {
            amount: amountToPay,
            booking_id: booking.id,
            damage_claim_id: claim.id,
            notes: `Damage payment for ${booking.item?.title || 'rental item'}.`,
            payer_id: booking.borrower_id,
            payment_method: PAYMONGO_PAYMENT_METHOD,
            payee_id: booking.owner_id,
            reference_number: `paymongo:damage:${claim.id}`,
            status: 'pending',
            transaction_at: new Date().toISOString(),
          },
          ['damage_payment', 'payment']
        );
      }

      const successUrl = `${window.location.origin}/user/manage-booking?payment_status=success&booking_id=${booking.id}&damage_claim_id=${claim.id}&damage_claim_paid=true`;
      const cancelUrl = `${window.location.origin}/user/manage-booking?payment_status=cancelled&booking_id=${booking.id}&damage_claim_id=${claim.id}`;

      const checkoutSession = await createTestCheckoutSession({
        amount: amountToPay,
        cancelUrl,
        currency: 'PHP',
        description: `Damage claim payment for "${booking.item?.title || 'rental item'}"`,
        metadata: {
          booking_id: booking.id,
          damage_claim_id: claim.id,
          source: 'damage_claim_payment',
        },
        successUrl,
      });

      if (checkoutSession?.attributes?.checkout_url) {
        window.location.href = checkoutSession.attributes.checkout_url;
      } else {
        throw new Error('Failed to get checkout URL from PayMongo.');
      }
    } catch (paymentError) {
      setMessage(`Unable to process damage claim payment: ${paymentError.message}`);
      setMessageTone('warning');
      setBookingActionBusyId('');
    }
  }

  function closeReviewModal() {
    setShowReviewModal(false);
    setReviewBooking(null);
    setSavingReview(false);
    setReviewForm({ rating: '5', review_text: '' });
  }

  async function handleSubmitReview(event) {
    event.preventDefault();

    if (!reviewBooking?.id || !userId) {
      return;
    }

    setSavingReview(true);
    setMessage('');

    try {
      const rating = Number(reviewForm.rating);

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5.');
      }

      const revieweeId = reviewBooking.borrower_id === userId ? reviewBooking.owner_id : reviewBooking.borrower_id;
      const reviewerRole = reviewBooking.borrower_id === userId ? 'borrower' : 'owner';

      const { error: reviewInsertError } = await supabase.from('reviews').insert({
        booking_id: reviewBooking.id,
        item_id: reviewBooking.item_id,
        rating,
        review_text: sanitizeText(reviewForm.review_text) || null,
        reviewee_id: revieweeId,
        reviewer_id: userId,
        reviewer_role: reviewerRole,
      });

      if (reviewInsertError) {
        throw new Error(reviewInsertError.message);
      }

      setBookings((current) =>
        current.map((booking) =>
          booking.id === reviewBooking.id
            ? {
                ...booking,
                hasMyReview: true,
              }
            : booking
        )
      );

      setMessage('Review submitted successfully.');
      setMessageTone('success');
      closeReviewModal();
    } catch (reviewError) {
      setMessage(`Unable to submit review: ${reviewError.message}`);
      setMessageTone('warning');
      setSavingReview(false);
    }
  }

  if (loading) {
    return (
      <UserShell subtitle={pageSubtitle} title={pageTitle}>
        <DataLoadingScreen
          label={showRentalItems ? 'Loading rental items' : 'Loading bookings'}
          message="Loading your bookings and listings from the database."
          title={showRentalItems && !showManageBooking ? 'Getting your listings' : 'Getting your bookings'}
        />
      </UserShell>
    );
  }

  return (
    <UserShell subtitle={pageSubtitle} title={pageTitle}>
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
      {paymentReturnProcessing ? <StatusMessage tone="info">Payment received. Finalizing your booking and loading the latest records...</StatusMessage> : null}

      <div className="my-bookings-page" style={{ alignContent: 'start', alignItems: 'start', display: 'grid', gap: 10 }}>
        {showManageBooking && !paymentReturnProcessing ? (
        <Panel
          className="workspace-flat-panel booking-workspace-panel"
          style={{ borderRadius: 0, marginTop: 0 }}
        >
          <div
            className="booking-hub"
            style={{
              background: `linear-gradient(180deg, ${alpha(theme.colors.panel, 0.72)} 0%, ${alpha(theme.colors.panel, 0.5)} 100%)`,
              border: `1px solid ${alpha(theme.colors.ink, 0.06)}`,
              display: 'grid',
              gap: 16,
              padding: 12,
            }}
          >
            <section className="booking-mobile-overview">
              <div className="booking-mobile-stats-grid">
                <article className="booking-mobile-stat-card tone-danger">
                  <span>Needs approval</span>
                  <strong>{loading ? '--' : String(pendingApprovals.length).padStart(2, '0')}</strong>
                  <small>Action required</small>
                </article>
                <article className="booking-mobile-stat-card tone-info">
                  <span>Borrowed</span>
                  <strong>{loading ? '--' : String(borrowerBookings.length).padStart(2, '0')}</strong>
                  <small>My rentals</small>
                </article>
                <article className="booking-mobile-stat-card tone-warning">
                  <span>Incoming</span>
                  <strong>{loading ? '--' : String(ownerBookings.length).padStart(2, '0')}</strong>
                  <small>Owner bookings</small>
                </article>
                <article className="booking-mobile-stat-card tone-success">
                  <span>Selling</span>
                  <strong>{loading ? '--' : currencyFormatter.format(mobileSellingTotal)}</strong>
                  <small>Total revenue</small>
                </article>
              </div>

              <article className="booking-mobile-recent-card">
                <div className="booking-mobile-schedule-head">
                  <h3>Recent orders</h3>
                </div>
                {mobileRecentOrders.length ? (
                  <div className="booking-mobile-recent-list">
                    {mobileRecentOrders.map((booking) => (
                      <button
                        className="booking-mobile-recent-row"
                        key={`mobile-recent-${booking.id}`}
                        onClick={() => openBookingDetail(booking)}
                        type="button"
                      >
                        <div>
                          <strong>{booking.item?.title || 'Rental item'}</strong>
                          <span>{formatListingStatusLabel(booking.status)}</span>
                        </div>
                        <em>{currencyFormatter.format(Number(booking.total_due) || 0)}</em>
                      </button>
                    ))}
                  </div>
                ) : (
                  <StatusMessage tone="info">No orders yet.</StatusMessage>
                )}
              </article>
            </section>

            <div className="booking-desktop-metrics">
              <SectionGrid columns={3} style={{ gap: 12 }}>
                <div className="booking-metric-card">
                  <MetricCard
                    detail="Booking requests waiting for your owner approval."
                    icon={<CalendarIcon size={18} />}
                    label="Needs approval"
                    style={{ borderRadius: 0 }}
                    tone={theme.colors.coral}
                    value={loading ? 'Loading...' : `${pendingApprovals.length}`}
                  />
                </div>
                <div className="booking-metric-card">
                  <MetricCard
                    detail="Bookings where you are the borrower."
                    icon={<CheckIcon size={18} />}
                    label="Borrowed"
                    style={{ borderRadius: 0 }}
                    tone={theme.colors.success}
                    value={loading ? 'Loading...' : `${borrowerBookings.length}`}
                  />
                </div>
                <div className="booking-metric-card">
                  <MetricCard
                    detail="Bookings where you are the owner."
                    icon={<UploadIcon size={18} />}
                    label="Incoming"
                    style={{ borderRadius: 0 }}
                    tone={theme.colors.sky}
                    value={loading ? 'Loading...' : `${ownerBookings.length}`}
                  />
                </div>
              </SectionGrid>
            </div>

            <div className="booking-inner-tabs" role="tablist" aria-label="Manage booking view">
              <button
                aria-selected={manageBookingView === 'bookings'}
                className={manageBookingView === 'bookings' ? 'active' : ''}
                onClick={() => setManageBookingView('bookings')}
                role="tab"
                type="button"
              >
                Booking records
              </button>
              <button
                aria-selected={manageBookingView === 'calendar'}
                className={manageBookingView === 'calendar' ? 'active' : ''}
                onClick={() => setManageBookingView('calendar')}
                role="tab"
                type="button"
              >
                Schedule calendar
              </button>
            </div>

            <div className={`booking-desktop-schedule booking-inner-panel ${manageBookingView === 'calendar' ? 'active' : ''}`}>
              <div className="booking-inner-panel-head">
                <strong className="booking-section-title">Schedule calendar</strong>
              </div>
              <UserRentalsCalendar embedded />
            </div>

            <div className={`booking-list-panel ${manageBookingView === 'bookings' ? 'active' : ''}`}>

            <div className="booking-filter-tabs" role="tablist" aria-label="Booking sections">
              {bookingFilters.map((filter) => (
                <button
                  aria-selected={activeBookingFilter === filter.key}
                  className={activeBookingFilter === filter.key ? 'active' : ''}
                  key={filter.key}
                  onClick={() => setActiveBookingFilter(filter.key)}
                  role="tab"
                  type="button"
                >
                  <span>{filter.label}</span>
                  <strong>{loading ? '...' : filter.count}</strong>
                </button>
              ))}
            </div>

            {activeBookingFilter === 'approval' ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="borrowed-bookings-toolbar"><strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Incoming requests requiring your approval</strong>{renderBookingSort('approval')}</div>
              {!pendingApprovals.length ? (
                <StatusMessage tone="info">No pending booking requests right now.</StatusMessage>
              ) : (
                <div
                  className="booking-table-wrap"
                  style={{
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 0,
                    maxHeight: 430,
                    overflow: 'auto',
                    overflowX: 'auto',
                  }}
                >
                  <table className="booking-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1020, width: '100%' }}>
                    <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                      <tr>
                        <th style={headerCellStyle}>Item</th>
                        <th style={headerCellStyle}>Borrower</th>
                        <th style={headerCellStyle}>Add-ons</th>
                        <th style={headerCellStyle}>Requested schedule</th>
                        <th style={headerCellStyle}>Total due</th>
                        <th style={headerCellStyle}>Status</th>
                        <th style={headerCellStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortBookingRows(pendingApprovals, bookingSorts.approval).map((booking, index) => (
                        <tr className="booking-row" key={booking.id} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                          <td style={bodyCellStyle}>
                            <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                              {booking.item?.primaryImage?.image_url ? (
                                <img
                                  alt={booking.item.title}
                                  className="booking-thumb"
                                  src={booking.item.primaryImage.image_url}
                                  style={{
                                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                                    height: 48,
                                    objectFit: 'cover',
                                    width: 48,
                                  }}
                                />
                              ) : null}
                              <div style={{ display: 'grid', gap: 4 }}>
                                <strong style={{ color: theme.colors.ink }}>{booking.item?.title || 'Unknown item'}</strong>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>{booking.item?.item_condition || 'Condition not set'}</span>
                              </div>
                            </div>
                          </td>
                          <td style={bodyCellStyle}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <span style={{ color: theme.colors.ink }}>{buildPersonName(booking.counterpart) || booking.counterpart?.username || 'Borrower'}</span>
                              <span style={{ color: theme.colors.slate, fontSize: 13 }}>{booking.counterpart?.username ? `@${booking.counterpart.username}` : ''}</span>
                            </div>
                          </td>
                          <td className="booking-addons-cell" style={bodyCellStyle}>
                            {booking.addons?.length ? (
                              <div className="booking-addon-list">
                                {booking.addons.map((addon) => (
                                  <div className="booking-addon-row" key={addon.id}>
                                    <strong>{addon.addon_name_snapshot || 'Add-on'}</strong>
                                    <span>
                                      ×{Math.max(1, Number(addon.quantity) || 1)} · {currencyFormatter.format(
                                        Number(addon.total_amount) || (Number(addon.price_snapshot) || 0) * (Number(addon.quantity) || 1)
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="booking-addon-empty">None</span>
                            )}
                          </td>
                          <td style={bodyCellStyle}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <span style={{ color: theme.colors.ink }}>{formatDateTime(booking.requested_start)}</span>
                              <span style={{ color: theme.colors.slate }}>to {formatDateTime(booking.requested_end)}</span>
                            </div>
                          </td>
                          <td style={bodyCellStyle}>{currencyFormatter.format(Number(booking.total_due) || 0)}</td>
                          <td style={bodyCellStyle}>
                            <Badge tone={bookingStatusTone(booking.status)}>{formatListingStatusLabel(booking.status)}</Badge>
                          </td>
                          <td style={bodyCellStyle}>
                            <Button className="booking-action-button" onClick={() => openBookingDetail(booking)} type="button" variant="secondary">
                              View details
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            ) : null}

            {activeBookingFilter === 'approval' ? (
            <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>
              <div className="borrowed-bookings-toolbar"><strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Pending purchase requests for your sale listings</strong>{renderBookingSort('approval')}</div>
              {!pendingPurchaseApprovals.length ? (
                <StatusMessage tone="info">No pending purchase requests right now.</StatusMessage>
              ) : (
                <div
                  className="booking-table-wrap"
                  style={{
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 0,
                    maxHeight: 300,
                    overflow: 'auto',
                    overflowX: 'auto',
                  }}
                >
                  <table className="booking-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1000, width: '100%' }}>
                    <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                      <tr>
                        <th style={headerCellStyle}>Item</th>
                        <th style={headerCellStyle}>Buyer</th>
                        <th style={headerCellStyle}>Requested quantity</th>
                        <th style={headerCellStyle}>Price snapshot</th>
                        <th style={headerCellStyle}>Preferred pickup</th>
                        <th style={headerCellStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortBookingRows(pendingPurchaseApprovals, bookingSorts.approval).map((request, index) => {
                        const qty = Number(request.buyer_requested_quantity) || 0;
                        const unitPrice = Number(request.sale_price_snapshot) || 0;
                        const total = Number(request.sale_total_amount_snapshot) || unitPrice * qty;
                        const busyKey = `purchase:${request.id}`;

                        return (
                          <tr className="booking-row" key={request.id} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <strong style={{ color: theme.colors.ink }}>{request.item?.title || 'Unknown item'}</strong>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                                  Remaining stock: {Number(request.item?.quantity) || 0}
                                </span>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{buildPersonName(request.buyer) || request.buyer?.username || 'Buyer'}</span>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>{request.buyer?.username ? `@${request.buyer.username}` : ''}</span>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              <span style={{ color: theme.colors.ink }}>{qty}</span>
                            </td>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{currencyFormatter.format(unitPrice)} each</span>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>Total: {currencyFormatter.format(total)}</span>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              <span style={{ color: theme.colors.ink }}>{formatDateTime(request.buyer_preferred_pickup_at)}</span>
                            </td>
                            <td style={bodyCellStyle}>
                              <Button
                                className="booking-action-button"
                                disabled={bookingActionBusyId === busyKey}
                                onClick={() => handleApprovePurchaseRequest(request)}
                                type="button"
                                variant="secondary"
                              >
                                {bookingActionBusyId === busyKey ? 'Approving...' : 'Approve purchase'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            ) : null}

            {activeBookingFilter === 'borrowed' || activeBookingFilter === 'late' ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="borrowed-bookings-toolbar">
                <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>
                  {activeBookingFilter === 'late' ? 'My late bookings' : 'My borrowed bookings'}
                </strong>
                {renderBookingSort(activeBookingFilter === 'late' ? 'late' : 'borrowed')}
              </div>
              {!(activeBookingFilter === 'late' ? lateBorrowerBookings : regularBorrowerBookings).length ? (
                <StatusMessage tone="info">
                  {activeBookingFilter === 'late' ? 'You do not have any late bookings.' : 'You do not have any current borrowed bookings.'}
                </StatusMessage>
              ) : (
                <div
                  className="booking-table-wrap"
                  style={{
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 0,
                    maxHeight: 430,
                    overflow: 'auto',
                    overflowX: 'auto',
                  }}
                >
                  <table className="booking-table borrowed-bookings-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1180, width: '100%' }}>
                    <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                      <tr>
                        <th style={headerCellStyle}>Item</th>
                        <th style={headerCellStyle}>Owner</th>
                        <th style={headerCellStyle}>Add-ons</th>
                        <th style={headerCellStyle}>Schedule</th>
                        <th style={headerCellStyle}>Total due</th>
                        <th style={headerCellStyle}>Status</th>
                        <th style={headerCellStyle}>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeBookingFilter === 'late' ? sortedLateBorrowerBookings : sortedRegularBorrowerBookings).map((booking, index) => {
                        const isReturned = isReturnedBookingStatus(booking.status);
                        const canCancel = isBorrowerCancellableStatus(booking.status);
                        const lateFee = calculateLateFee(booking);
                        const depositAppliedToLateFee = toMoneyAmount(Math.min(Number(booking.security_deposit || 0), lateFee.total));
                        const remainingLateFee = toMoneyAmount(Math.max(0, lateFee.total - depositAppliedToLateFee));

                        return (
                          <tr className="booking-row" key={booking.id} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <strong style={{ color: theme.colors.ink }}>{booking.item?.title || 'Unknown item'}</strong>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>{booking.item?.item_condition || 'Condition not set'}</span>
                                <Button
                                  className="booking-action-button"
                                  onClick={() => openBookingDetail(booking)}
                                  style={{ fontSize: 12, justifySelf: 'start', minHeight: 32, padding: '0 10px' }}
                                  type="button"
                                  variant="ghost"
                                >
                                  View rented item
                                </Button>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{buildPersonName(booking.counterpart) || booking.counterpart?.username || 'Owner'}</span>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>{booking.counterpart?.username ? `@${booking.counterpart.username}` : ''}</span>
                              </div>
                            </td>
                            <td className="booking-addons-cell" style={bodyCellStyle}>
                              {booking.addons?.length ? (
                                <div className="booking-addon-list">
                                  {booking.addons.map((addon) => (
                                    <div className="booking-addon-row" key={addon.id}>
                                      <strong>{addon.addon_name_snapshot || 'Add-on'}</strong>
                                      <span>
                                        ×{Math.max(1, Number(addon.quantity) || 1)} · {currencyFormatter.format(
                                          Number(addon.total_amount) || (Number(addon.price_snapshot) || 0) * (Number(addon.quantity) || 1)
                                        )}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : <span className="booking-addon-empty">None</span>}
                            </td>
                            <td className="booking-schedule-cell" style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{formatDateTime(booking.approved_start || booking.requested_start)}</span>
                                <span style={{ color: theme.colors.slate }}>to {formatDateTime(booking.approved_end || booking.requested_end)}</span>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{currencyFormatter.format(Number(booking.total_due) || 0)}</span>
                                {lateFee.total > 0 && LATE_FEE_PAYABLE_STATUSES.has(String(booking.status || '').toLowerCase()) ? (
                                  <span style={{ color: theme.colors.danger, display: 'grid', fontSize: 12, fontWeight: 700, gap: 2 }}>
                                    <span>{currencyFormatter.format(lateFee.total)} late fee ({lateFee.daysLate} day{lateFee.daysLate === 1 ? '' : 's'})</span>
                                    <span>− {currencyFormatter.format(depositAppliedToLateFee)} security deposit</span>
                                    <span>{currencyFormatter.format(remainingLateFee)} remaining</span>
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              <Badge tone={bookingStatusTone(booking.status)}>{formatListingStatusLabel(booking.status)}</Badge>
                            </td>
                            <td style={bodyCellStyle}>
                              {isReturned ? (
                                booking.hasMyReview ? (
                                  <Badge tone="success">Reviewed</Badge>
                                ) : (
                                  <Button className="booking-action-button" onClick={() => openReviewBooking(booking)} type="button" variant="secondary">
                                    Review item
                                  </Button>
                                )
                              ) : lateFee.total > 0 && LATE_FEE_PAYABLE_STATUSES.has(String(booking.status || '').toLowerCase()) ? (
                                <Button
                                  className="booking-action-button"
                                  disabled={bookingActionBusyId === booking.id}
                                  onClick={() => handlePayLateFee(booking)}
                                  type="button"
                                  variant="secondary"
                                >
                                  {bookingActionBusyId === booking.id
                                    ? 'Processing...'
                                    : remainingLateFee > 0
                                      ? `Pay ${currencyFormatter.format(remainingLateFee)} remaining`
                                      : 'Apply deposit and submit return'}
                                </Button>
                              ) : canCancel ? (
                                <Button
                                  className="booking-action-button"
                                  disabled={bookingActionBusyId === booking.id}
                                  onClick={() => handleCancelBooking(booking)}
                                  type="button"
                                  variant="ghost"
                                >
                                  {bookingActionBusyId === booking.id ? 'Cancelling...' : 'Cancel booking'}
                                </Button>
                              ) : (
                                <span style={{ color: theme.colors.slate }}>Available after return</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            ) : null}

            {activeBookingFilter === 'returns' ? (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="borrowed-bookings-toolbar"><strong className="booking-section-title">Owner return completion</strong>{renderBookingSort('returns')}</div>
              {!ownerBookings.length ? (
                <StatusMessage tone="info">No incoming bookings are assigned to your listings.</StatusMessage>
              ) : (
                <div className="booking-table-wrap">
                  <table className="booking-table">
                    <thead>
                      <tr>
                        <th style={headerCellStyle}>Item</th>
                        <th style={headerCellStyle}>Borrower</th>
                        <th style={headerCellStyle}>Approved schedule</th>
                        <th style={headerCellStyle}>Late fee</th>
                        <th style={headerCellStyle}>Status</th>
                        <th style={headerCellStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortBookingRows(ownerBookings, bookingSorts.returns).map((booking) => {
                        const normalizedBookingStatus = String(booking.status || '').toLowerCase();
                        const lateFee = calculateLateFee(booking);
                        const depositAppliedToLateFee = toMoneyAmount(Math.min(Number(booking.security_deposit || 0), lateFee.total));
                        const remainingLateFee = toMoneyAmount(Math.max(0, lateFee.total - depositAppliedToLateFee));
                        const awaitingBorrowerLateFeePayment = lateFee.total > 0 && LATE_FEE_PAYABLE_STATUSES.has(normalizedBookingStatus);
                        const canReviewReturn = OWNER_RETURNABLE_STATUSES.includes(normalizedBookingStatus);

                        return (
                          <tr className="booking-row" key={booking.id}>
                            <td data-label="Item" style={bodyCellStyle}>
                              <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                                {booking.item?.primaryImage?.image_url ? (
                                  <img
                                    alt={booking.item.title}
                                    className="booking-thumb"
                                    src={booking.item.primaryImage.image_url}
                                  />
                                ) : null}
                                <span style={{ color: theme.colors.ink }}>{booking.item?.title || 'Unknown item'}</span>
                              </div>
                            </td>
                            <td data-label="Borrower" style={bodyCellStyle}>
                              {buildPersonName(booking.counterpart) || booking.counterpart?.username || 'Borrower'}
                            </td>
                            <td data-label="Approved schedule" style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{formatDateTime(booking.approved_start || booking.requested_start)}</span>
                                <span style={{ color: theme.colors.slate }}>to {formatDateTime(booking.approved_end || booking.requested_end)}</span>
                              </div>
                            </td>
                            <td data-label="Late fee" style={bodyCellStyle}>
                              {lateFee.total > 0 && OWNER_RETURNABLE_STATUSES.includes(String(booking.status || '').toLowerCase()) ? (
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <strong style={{ color: theme.colors.danger }}>{currencyFormatter.format(lateFee.total)}</strong>
                                  <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                                    {lateFee.daysLate} day{lateFee.daysLate === 1 ? '' : 's'} late
                                  </span>
                                  <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                                    Deposit: −{currencyFormatter.format(depositAppliedToLateFee)}
                                  </span>
                                  <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                                    PayMongo balance: {currencyFormatter.format(remainingLateFee)}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ color: theme.colors.slate }}>None</span>
                              )}
                            </td>
                            <td data-label="Status" style={bodyCellStyle}>
                              <Badge tone={bookingStatusTone(booking.status)}>{formatListingStatusLabel(booking.status)}</Badge>
                            </td>
                            <td data-label="Action" style={bodyCellStyle}>
                              {canReviewReturn ? (
                                <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
                                  <Button
                                    className="booking-action-button"
                                    onClick={() => openBookingDetail(booking)}
                                    type="button"
                                    variant="secondary"
                                  >
                                    View item and payment
                                  </Button>
                                  {awaitingBorrowerLateFeePayment ? <Badge tone="warning">Awaiting borrower payment</Badge> : null}
                                </div>
                              ) : isReturnedBookingStatus(booking.status) ? (
                                <Badge tone="success">Completed</Badge>
                              ) : (
                                <span style={{ color: theme.colors.slate }}>No action needed</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            ) : null}

            {activeBookingFilter === 'damage-reports' ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div className="borrowed-bookings-toolbar"><strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Damage balances to settle</strong>{renderBookingSort('damage')}</div>
              {!payableDamageBookings.length ? (
                <StatusMessage tone="info">No borrower damage balances are pending payment right now.</StatusMessage>
              ) : (
                <div
                  className="booking-table-wrap"
                  style={{
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 0,
                    maxHeight: 340,
                    overflow: 'auto',
                    overflowX: 'auto',
                  }}
                >
                  <table className="booking-table damage-report-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 980, width: '100%' }}>
                    <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                      <tr>
                        <th style={headerCellStyle}>Item</th>
                        <th style={headerCellStyle}>Seller</th>
                        <th style={headerCellStyle}>Amount due</th>
                        <th style={headerCellStyle}>Claim status</th>
                        <th style={headerCellStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortBookingRows(payableDamageBookings, bookingSorts.damage).map((booking, index) => {
                        const claim = booking.damageClaim;
                        const amountDue =
                          Number(claim?.amount_due) || Number(claim?.admin_approved_amount) || Number(claim?.claimed_amount) || 0;

                        return (
                          <tr className="booking-row" key={`payable-${booking.id}`} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                            <td style={bodyCellStyle}>
                              <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                                {booking.item?.primaryImage?.image_url ? (
                                  <img
                                    alt={booking.item.title}
                                    className="booking-thumb"
                                    src={booking.item.primaryImage.image_url}
                                    style={{
                                      border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                                      height: 44,
                                      objectFit: 'cover',
                                      width: 44,
                                    }}
                                  />
                                ) : null}
                                <span style={{ color: theme.colors.ink }}>{booking.item?.title || 'Unknown item'}</span>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>{buildPersonName(booking.counterpart) || booking.counterpart?.username || 'Owner'}</td>
                            <td style={bodyCellStyle}>
                              <strong style={{ color: theme.colors.danger }}>{currencyFormatter.format(amountDue)}</strong>
                            </td>
                            <td style={bodyCellStyle}>
                              <Badge tone={bookingStatusTone(claim?.status)}>{formatListingStatusLabel(claim?.status)}</Badge>
                            </td>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <Button className="booking-action-button" onClick={() => openBookingDetail(booking)} type="button" variant="ghost">
                                  View balance
                                </Button>
                                <Button
                                  className="booking-action-button"
                                  disabled={bookingActionBusyId === booking.id}
                                  onClick={() => handlePayDamageClaim(booking)}
                                  type="button"
                                  variant="danger"
                                >
                                  {bookingActionBusyId === booking.id ? 'Processing...' : `Pay damage charge ${currencyFormatter.format(amountDue)}`}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="borrowed-bookings-toolbar"><strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Completed transactions eligible for damage report</strong>{renderBookingSort('damage')}</div>
              {!completedOwnerBookings.length ? (
                <StatusMessage tone="info">No completed owner transactions are available for damage reporting.</StatusMessage>
              ) : (
                <>
                  <StatusMessage tone={reportableCompletedBookings.length ? 'warning' : 'info'}>
                    {reportableCompletedBookings.length
                      ? `${reportableCompletedBookings.length} completed transaction(s) can still be reported within the 24-hour window.`
                      : 'All completed transaction report windows are already closed.'}
                  </StatusMessage>
                  <div
                    className="booking-table-wrap"
                    style={{
                      border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                      borderRadius: 0,
                      maxHeight: 430,
                      overflow: 'auto',
                      overflowX: 'auto',
                    }}
                  >
                    <table className="booking-table damage-report-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1080, width: '100%' }}>
                      <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                        <tr>
                          <th style={headerCellStyle}>Item</th>
                          <th style={headerCellStyle}>Borrower</th>
                          <th style={headerCellStyle}>Completed</th>
                          <th style={headerCellStyle}>Report deadline</th>
                          <th style={headerCellStyle}>Window</th>
                          <th style={headerCellStyle}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortBookingRows(completedOwnerBookings, bookingSorts.damage).map((booking, index) => {
                          const reportWindow = getDamageReportWindowStatus(booking);

                          return (
                            <tr className="booking-row" key={booking.id} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                              <td style={bodyCellStyle}>
                                <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                                  {booking.item?.primaryImage?.image_url ? (
                                    <img
                                      alt={booking.item.title}
                                      className="booking-thumb"
                                      src={booking.item.primaryImage.image_url}
                                      style={{
                                        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                                        height: 44,
                                        objectFit: 'cover',
                                        width: 44,
                                      }}
                                    />
                                  ) : null}
                                  <span style={{ color: theme.colors.ink }}>{booking.item?.title || 'Unknown item'}</span>
                                </div>
                              </td>
                              <td style={bodyCellStyle}>{buildPersonName(booking.counterpart) || booking.counterpart?.username || 'Borrower'}</td>
                              <td style={bodyCellStyle}>
                                <span style={{ color: theme.colors.ink }}>{formatDateTime(booking.updated_at)}</span>
                              </td>
                              <td style={bodyCellStyle}>
                                <span style={{ color: theme.colors.ink }}>{reportWindow.deadline ? formatDateTime(reportWindow.deadline) : 'Not set'}</span>
                              </td>
                              <td style={bodyCellStyle}>
                                <Badge tone={reportWindow.tone}>{reportWindow.label}</Badge>
                              </td>
                              <td style={bodyCellStyle}>
                                {booking.damageClaim && isRejectedDamageClaim(booking.damageClaim) && reportWindow.canReport ? (
                                  <Button
                                    className="booking-action-button"
                                    disabled={bookingActionBusyId === booking.id}
                                    onClick={() => openDamageReport(booking)}
                                    type="button"
                                    variant="danger"
                                  >
                                    Resubmit report
                                  </Button>
                                ) : booking.damageClaim ? (
                                  <Button
                                    className="booking-action-button"
                                    onClick={() => openDamageClaimDetail(booking)}
                                    type="button"
                                    variant="ghost"
                                  >
                                    View report
                                  </Button>
                                ) : reportWindow.canReport ? (
                                  <Button
                                    className="booking-action-button"
                                    disabled={bookingActionBusyId === booking.id}
                                    onClick={() => openDamageReport(booking)}
                                    type="button"
                                    variant="danger"
                                  >
                                    Report damage
                                  </Button>
                                ) : (
                                  <span style={{ color: theme.colors.slate }}>No longer reportable</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
            ) : null}

            {activeBookingFilter === 'purchase-requests' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="borrowed-bookings-toolbar"><strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Purchase requests for your sale listings</strong>{renderBookingSort('purchase')}</div>
              {!sellerPurchaseRequests.length ? (
                <StatusMessage tone="info">No incoming purchase requests yet.</StatusMessage>
              ) : (
                <div
                  className="booking-table-wrap"
                  style={{
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 0,
                    maxHeight: 320,
                    overflow: 'auto',
                    overflowX: 'auto',
                  }}
                >
                  <table className="booking-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1080, width: '100%' }}>
                    <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                      <tr>
                        <th style={headerCellStyle}>Item</th>
                        <th style={headerCellStyle}>Buyer</th>
                        <th style={headerCellStyle}>Quantity</th>
                        <th style={headerCellStyle}>Total</th>
                        <th style={headerCellStyle}>Status</th>
                        <th style={headerCellStyle}>Requested</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortBookingRows(sellerPurchaseRequests, bookingSorts.purchase).map((request, index) => (
                        <tr className="booking-row" key={`seller-purchase-${request.id}`} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                          <td style={bodyCellStyle}>
                            <strong>{request.item?.title || 'Unknown item'}</strong>
                            {request.addons?.length ? (
                              <small style={{ color: theme.colors.slate, display: 'block', marginTop: 4 }}>
                                Add-ons: {request.addons.map((addon) => `${addon.addon_name_snapshot} ×${addon.quantity}`).join(', ')}
                              </small>
                            ) : null}
                          </td>
                          <td style={bodyCellStyle}>
                            {buildPersonName(request.buyer) || request.buyer?.username || 'Buyer'}
                          </td>
                          <td style={bodyCellStyle}>{Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 0}</td>
                          <td style={bodyCellStyle}>
                            {currencyFormatter.format(
                              Number(request.sale_total_amount_snapshot) ||
                              (Number(request.sale_price_snapshot) || 0) * (Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 0)
                            )}
                          </td>
                          <td style={bodyCellStyle}>
                            <Badge tone={bookingStatusTone(request.status)}>{formatListingStatusLabel(request.status)}</Badge>
                          </td>
                          <td style={bodyCellStyle}>{formatDateTime(request.requested_at || request.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="borrowed-bookings-toolbar"><strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Your purchase requests to other sellers</strong>{renderBookingSort('purchase')}</div>
              {!buyerPurchaseRequests.length ? (
                <StatusMessage tone="info">You have not submitted purchase requests yet.</StatusMessage>
              ) : (
                <div
                  className="booking-table-wrap"
                  style={{
                    border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                    borderRadius: 0,
                    maxHeight: 320,
                    overflow: 'auto',
                    overflowX: 'auto',
                  }}
                >
                  <table className="booking-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1120, width: '100%' }}>
                    <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                      <tr>
                        <th style={headerCellStyle}>Item</th>
                        <th style={headerCellStyle}>Seller</th>
                        <th style={headerCellStyle}>Quantity</th>
                        <th style={headerCellStyle}>Total</th>
                        <th style={headerCellStyle}>Status</th>
                        <th style={headerCellStyle}>Preferred pickup</th>
                        <th style={headerCellStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortBookingRows(buyerPurchaseRequests, bookingSorts.purchase).map((request, index) => {
                        const busyKey = `purchase:${request.id}`;
                        const normalizedStatus = String(request.status || '').toLowerCase();
                        const canPay = ['awaiting_payment', 'approved'].includes(normalizedStatus);
                        const canCancel = ['awaiting_payment', 'pending'].includes(normalizedStatus);
                        const canMarkClaimed = ['paid', 'ready_for_pickup'].includes(normalizedStatus);

                        return (
                          <tr className="booking-row" key={`buyer-purchase-${request.id}`} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                            <td style={bodyCellStyle}>
                              <strong>{request.item?.title || 'Unknown item'}</strong>
                              {request.addons?.length ? (
                                <small style={{ color: theme.colors.slate, display: 'block', marginTop: 4 }}>
                                  Add-ons: {request.addons.map((addon) => `${addon.addon_name_snapshot} ×${addon.quantity}`).join(', ')}
                                </small>
                              ) : null}
                            </td>
                            <td style={bodyCellStyle}>
                              {buildPersonName(request.seller) || request.seller?.username || 'Seller'}
                            </td>
                            <td style={bodyCellStyle}>{Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 0}</td>
                            <td style={bodyCellStyle}>
                              {currencyFormatter.format(
                                Number(request.sale_total_amount_snapshot) ||
                                (Number(request.sale_price_snapshot) || 0) * (Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 0)
                              )}
                            </td>
                            <td style={bodyCellStyle}>
                              <Badge tone={bookingStatusTone(request.status)}>{formatListingStatusLabel(request.status)}</Badge>
                            </td>
                            <td style={bodyCellStyle}>{formatDateTime(request.buyer_preferred_pickup_at)}</td>
                            <td style={bodyCellStyle}>
                              {canPay || canCancel ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {canPay ? (
                                    <Button
                                      className="booking-action-button"
                                      disabled={bookingActionBusyId === busyKey}
                                      onClick={() => handlePayPurchaseRequest(request)}
                                      type="button"
                                      variant="danger"
                                    >
                                      {bookingActionBusyId === busyKey
                                        ? 'Processing...'
                                        : `Pay ${currencyFormatter.format(
                                          Number(request.sale_total_amount_snapshot) ||
                                            (Number(request.sale_price_snapshot) || 0) *
                                              (Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 0)
                                      )}`}
                                    </Button>
                                  ) : null}
                                  {normalizedStatus === 'awaiting_payment' && !request.paymongo_checkout_session_id ? (
                                    <Button
                                      className="booking-action-button"
                                      onClick={() => {
                                        setPurchasePaymentRecovery(request);
                                        setPurchasePaymentRecoverySessionId('');
                                      }}
                                      type="button"
                                      variant="secondary"
                                    >
                                      Verify previous payment
                                    </Button>
                                  ) : null}
                                  {canCancel ? (
                                    <Button
                                      className="booking-action-button"
                                      disabled={bookingActionBusyId === busyKey}
                                      onClick={() => handleCancelPurchaseRequest(request)}
                                      type="button"
                                      variant="ghost"
                                    >
                                      {bookingActionBusyId === busyKey ? 'Cancelling...' : 'Cancel'}
                                    </Button>
                                  ) : null}
                                </div>
                              ) : canMarkClaimed ? (
                                <Button
                                  className="booking-action-button"
                                  disabled={bookingActionBusyId === busyKey}
                                  onClick={() => handleMarkPurchaseClaimed(request)}
                                  type="button"
                                  variant="secondary"
                                >
                                  {bookingActionBusyId === busyKey ? 'Saving...' : 'Mark claimed'}
                                </Button>
                              ) : (
                                <span style={{ color: theme.colors.slate }}>No action</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            ) : null}
            </div>
          </div>
        </Panel>
        ) : null}

        {showRentalItems && !isListingFormPage ? (
        <Panel
          className="workspace-flat-panel inventory-workspace-panel"
          subtitle=""
          style={{ borderRadius: 0, marginTop: 0 }}
          title=""
        >
          <div style={{ display: 'grid', gap: 14 }}>
            {!loading && !canCreateListing ? (
              <StatusMessage tone="warning">
                {readinessIssues.map((issue) => issue).join(' ')}
              </StatusMessage>
            ) : null}

            <section className="inventory-layout">
              {loading ? (
                <DataLoadingScreen
                  label="Loading rental item listings"
                  message="Loading your product listings from the database."
                  title="Getting your listings"
                />
              ) : <>
              <div className="inventory-stat-grid">
                <article className="inventory-stat-card">
                  <header>
                    <span>Active Listings</span>
                    <CatalogIcon size={16} />
                  </header>
                  <strong>{loading ? '--' : activeListingCount}</strong>
                  <p>{loading ? 'Loading...' : `+${newListingsThisWeek} this week Â· ${draftListingCount} drafts`}</p>
                </article>

                <article className="inventory-stat-card">
                  <header>
                    <span>Pending Orders</span>
                    <FilterIcon size={16} />
                  </header>
                  <strong>{loading ? '--' : pendingApprovals.length + pendingPurchaseApprovals.length}</strong>
                  <p>{loading ? 'Loading...' : `${pendingApprovals.length} rental, ${pendingPurchaseApprovals.length} purchase`}</p>
                </article>

                <article className="inventory-stat-card">
                  <header>
                    <span>Low Stock Alerts</span>
                    <StarIcon size={16} />
                  </header>
                  <strong>{loading ? '--' : lowStockListings.length}</strong>
                  <p>{loading ? 'Loading...' : 'Items at 2 qty or below'}</p>
                </article>
              </div>

              <div className="inventory-table-shell">
                <div className="inventory-toolbar">
                  <div className="inventory-mobile-status-tabs">
                    <button
                      className={listingStatusFilter === 'all' ? 'active' : ''}
                      onClick={() => setListingStatusFilter('all')}
                      type="button"
                    >
                      All Products
                    </button>
                    <button
                      className={listingStatusFilter === 'active' ? 'active' : ''}
                      onClick={() => setListingStatusFilter('active')}
                      type="button"
                    >
                      Active
                    </button>
                    <button
                      className={listingStatusFilter === 'drafts' ? 'active' : ''}
                      onClick={() => setListingStatusFilter('drafts')}
                      type="button"
                    >
                      Draft
                    </button>
                    <button
                      className={listingStatusFilter === 'out_of_stock' ? 'active' : ''}
                      onClick={() => setListingStatusFilter('out_of_stock')}
                      type="button"
                    >
                      Out of Stock
                    </button>
                  </div>
                  <div className="inventory-toolbar-right">
                    <FormField label="Status">
                      <select
                        name="listing_status_filter"
                        onChange={(event) => setListingStatusFilter(event.target.value)}
                        style={{ ...selectStyle, minHeight: 42, padding: '0 12px', width: 220 }}
                        value={listingStatusFilter}
                      >
                        <option value="all">{`All Products (${listingTabCounts.all})`}</option>
                        <option value="active">{`Active (${listingTabCounts.active})`}</option>
                        <option value="drafts">{`Drafts (${listingTabCounts.drafts})`}</option>
                        <option value="out_of_stock">{`Out of Stock (${listingTabCounts.out_of_stock})`}</option>
                      </select>
                    </FormField>
                    <FormField label="Category">
                      <select
                        name="listing_category_filter"
                        onChange={(event) => setListingCategoryFilter(event.target.value)}
                        style={{ ...selectStyle, minHeight: 42, padding: '0 12px', width: 210 }}
                        value={listingCategoryFilter}
                      >
                        <option value="all">All categories</option>
                        {listingMainCategoryOptions.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Search listings">
                      <Input name="listing_search" onChange={(event) => setSearch(event.target.value)} placeholder="Search by product name" value={search} />
                    </FormField>
                  </div>
                  <div className="inventory-header-actions inventory-toolbar-actions">
                    <Button onClick={handleExportListings} type="button" variant="secondary">
                      Export
                    </Button>
                    <Button disabled={!canCreateListing} onClick={openAddListing} type="button">
                      + Add Product
                    </Button>
                  </div>
                </div>

            {!loading && !filteredItems.length ? <StatusMessage tone="info">No product listings are saved on your account yet.</StatusMessage> : null}

            {!loading && filteredItems.length ? (
              <div className="inventory-mobile-list">
                {pagedFilteredItems.map((item) => {
                  const quantity = Number(item.quantity) || 0;
                  const isDraft = isListingDraftStatus(item.status);
                  const stockState = isDraft ? 'draft' : quantity <= 2 ? 'low' : 'ok';
                  const stockLabel = isDraft ? 'Draft' : quantity <= 2 ? `Low Stock (${quantity})` : `In Stock (${quantity})`;
                  return (
                    <article className="inventory-mobile-card" key={`mobile-listing-${item.id}`}>
                      <div className="inventory-mobile-card-media">
                        {item.primaryImage?.image_url ? (
                          <img alt={item.title} className="inventory-thumb" src={item.primaryImage.image_url} />
                        ) : (
                          <div className="inventory-thumb inventory-thumb-placeholder">
                            <CatalogIcon size={16} />
                          </div>
                        )}
                      </div>
                      <div className="inventory-mobile-card-main">
                        <strong className="inventory-mobile-card-title">{item.title}</strong>
                        <div className="inventory-mobile-meta">
                          <span className={`inventory-mobile-stock-chip ${stockState}`}>{stockLabel}</span>
                          <span className="inventory-mobile-sku">SKU: {buildListingSku(item)}</span>
                        </div>
                        <div className="inventory-mobile-card-foot">
                          <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)}</strong>
                          <Button onClick={() => navigate(`/user/rental-items/edit/${item.id}`)} style={{ ...listingButtonStyle, minHeight: 32, padding: '0 10px' }} type="button" variant="ghost">
                            Edit
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            {!loading && filteredItems.length ? (
              <div
                className="responsive-table-wrap listing-desktop-table"
                style={{
                  border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  borderRadius: 12,
                  overflow: 'hidden',
                  overflowX: 'auto',
                }}
              >
                <table className="listing-table" style={{ background: 'var(--ui-background-color)', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'auto', width: '100%' }}>
                  <thead style={{ background: 'var(--ui-background-color)' }}>
                    <tr>
                      <th style={listingHeaderCellStyle}>Product details</th>
                      <th style={listingHeaderCellStyle}>SKU</th>
                      <th style={listingHeaderCellStyle}>Price</th>
                      <th style={listingHeaderCellStyle}>Stock</th>
                      <th style={listingHeaderCellStyle}>Status</th>
                      <th style={listingHeaderCellStyle}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFilteredItems.map((item) => (
                      <tr key={item.id}>
                        <td style={listingBodyCellStyle}>
                          <div className="inventory-product-cell">
                            <div className="inventory-thumb-wrap">
                              {item.primaryImage?.image_url ? (
                                <img alt={item.title} className="inventory-thumb" src={item.primaryImage.image_url} />
                              ) : (
                                <div className="inventory-thumb inventory-thumb-placeholder">
                                  <CatalogIcon size={16} />
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                              <strong style={{ color: theme.colors.ink, fontSize: 16, lineHeight: 1.2 }}>{item.title}</strong>
                              <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                                {(item.category?.name || 'No category') + (item.item_condition ? ` > ${formatListingStatusLabel(item.item_condition)}` : '')}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td style={listingBodyCellStyle}>
                          <span style={{ color: theme.colors.slate, fontSize: 13, fontWeight: 700 }}>{buildListingSku(item)}</span>
                        </td>
                        <td style={listingBodyCellStyle}>
                          <div style={{ display: 'grid', gap: 3 }}>
                            <strong style={{ color: theme.colors.ink, fontSize: 16 }}>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)}</strong>
                            <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                              Deposit: {currencyFormatter.format(Number(item.security_deposit) || 0)}
                            </span>
                          </div>
                        </td>
                        <td style={listingBodyCellStyle}>
                          <input
                            aria-label={`Stock for ${item.title}`}
                            className="inventory-stock-input"
                            readOnly
                            type="number"
                            value={Number(item.quantity) || 0}
                          />
                        </td>
                        <td style={listingBodyCellStyle}>
                          <div style={{ display: 'grid', gap: 8 }}>
                            <select
                              disabled={savingStatusId === item.id}
                              onChange={(event) => handleStatusUpdate(item, event.target.value)}
                              style={{
                                ...selectStyle,
                                borderRadius: 10,
                                fontSize: 12,
                                fontWeight: 600,
                                minHeight: 34,
                                padding: '0 10px',
                                width: 150,
                              }}
                              value={item.status || 'draft'}
                            >
                              {listingStatusOptions.map((status) => (
                                <option key={status.value} value={status.value}>
                                  {status.label}
                                </option>
                              ))}
                            </select>
                            <span style={{ color: theme.colors.slate }}>Updated {formatDate(item.updated_at)}</span>
                          </div>
                        </td>
                        <td style={listingBodyCellStyle}>
                          <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                              <Button onClick={() => navigate(`/user/rental-items/edit/${item.id}`)} style={listingButtonStyle} type="button" variant="ghost">
                                Edit
                              </Button>
                              {item.primaryImage?.image_url ? (
                                <Button onClick={() => openImageViewer(item)} style={listingButtonStyle} type="button" variant="secondary">
                                  Image
                                </Button>
                              ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
                {!loading && filteredItems.length ? (
                  <div className="inventory-pagination">
                    <span>
                      Showing {listingRangeStart} to {listingRangeEnd} of {filteredItems.length} entries
                    </span>
                    <div className="inventory-pagination-controls">
                      <button disabled={currentListingPage <= 1} onClick={() => setListingPage((current) => Math.max(1, current - 1))} type="button">
                        <ChevronLeftIcon size={14} />
                      </button>
                      {Array.from({ length: listingTotalPages }, (_, index) => index + 1)
                        .slice(Math.max(0, currentListingPage - 2), Math.max(0, currentListingPage - 2) + 3)
                        .map((page) => (
                          <button
                            className={page === currentListingPage ? 'active' : ''}
                            key={`listing-page-${page}`}
                            onClick={() => setListingPage(page)}
                            type="button"
                          >
                            {page}
                          </button>
                        ))}
                      <button
                        disabled={currentListingPage >= listingTotalPages}
                        onClick={() => setListingPage((current) => Math.min(listingTotalPages, current + 1))}
                        type="button"
                      >
                        <ChevronRightIcon size={14} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              </>}
            </section>
          </div>
        </Panel>
        ) : null}
      </div>

      {Boolean(message) ? (
        <div
          onClick={() => setMessage('')}
          style={{
            alignItems: 'flex-start',
            display: 'flex',
            inset: 0,
            justifyContent: 'flex-end',
            padding: 18,
            pointerEvents: 'none',
            position: 'fixed',
            zIndex: 1100,
          }}
        >
          <div
            className="booking-notice"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: 'var(--ui-background-color)',
              border: '1px solid var(--ui-border-color)',
              borderRadius: 12,
              boxShadow: '0 18px 50px rgba(24, 33, 46, 0.16)',
              boxSizing: 'border-box',
              display: 'grid',
              gap: 12,
              maxWidth: 390,
              minWidth: 280,
              padding: 16,
              pointerEvents: 'auto',
              width: '100%',
            }}
          >
            <div
              style={{
                alignItems: 'center',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <strong
                style={{
                  color: theme.colors.ink,
                  fontFamily: theme.fonts.display,
                  fontSize: 18,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                }}
              >
                Notice
              </strong>
              <button aria-label="Close notice" onClick={() => setMessage('')} style={{ background: 'transparent', color: 'var(--ui-text-color)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }} type="button">×</button>
            </div>
            <StatusMessage tone={messageTone}>{message}</StatusMessage>
          </div>
        </div>
      ) : null}

      <Modal
        actions={(
          <>
            <Button
              onClick={() => {
                setPurchasePaymentRecovery(null);
                setPurchasePaymentRecoverySessionId('');
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={!purchasePaymentRecoverySessionId.trim() || bookingActionBusyId === `purchase-recovery:${purchasePaymentRecovery?.id}`}
              onClick={handleRecoverPurchasePayment}
              type="button"
            >
              {bookingActionBusyId === `purchase-recovery:${purchasePaymentRecovery?.id}` ? 'Verifying…' : 'Verify payment'}
            </Button>
          </>
        )}
        onClose={() => {
          setPurchasePaymentRecovery(null);
          setPurchasePaymentRecoverySessionId('');
        }}
        open={Boolean(purchasePaymentRecovery)}
        size="compact"
        title="Verify an existing payment"
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <StatusMessage tone="info">
            Enter the Checkout Session ID from the original PayMongo payment record. We’ll verify it against this purchase before recording anything. Do not submit another payment while checking the original one.
          </StatusMessage>
          <FormField label="PayMongo Checkout Session ID">
            <Input
              autoComplete="off"
              onChange={(event) => setPurchasePaymentRecoverySessionId(event.target.value)}
              placeholder="cs_…"
              value={purchasePaymentRecoverySessionId}
            />
          </FormField>
        </div>
      </Modal>

      <Modal
        actions={(
          <Button onClick={() => setReturnCompletionNotice(null)} type="button" variant="secondary">
            Close
          </Button>
        )}
        onClose={() => setReturnCompletionNotice(null)}
        open={Boolean(returnCompletionNotice)}
        size="compact"
        title={returnCompletionNotice?.title || 'Booking update'}
      >
        {returnCompletionNotice ? (
          <div style={{ display: 'grid', gap: 16 }}>
            {returnCompletionNotice.tone === 'success' ? (
              <>
                <div
                  style={{
                    alignItems: 'center',
                    background: 'linear-gradient(135deg, #f0fdf4 0%, #f7fef9 100%)',
                    border: '1px solid #bbebcc',
                    borderRadius: 16,
                    display: 'flex',
                    gap: 14,
                    padding: 18,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      alignItems: 'center',
                      background: '#dcfce7',
                      border: '1px solid #bbebcc',
                      borderRadius: '50%',
                      color: '#15803d',
                      display: 'inline-flex',
                      flex: '0 0 42px',
                      fontSize: 22,
                      height: 42,
                      justifyContent: 'center',
                      width: 42,
                    }}
                  >
                    {'\u2713'}
                  </span>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={{ color: '#166534', fontSize: 16 }}>{returnCompletionNotice.itemTitle || 'Rented item'}</strong>
                    <span style={{ color: '#3f6f50', lineHeight: 1.5 }}>{returnCompletionNotice.message}</span>
                  </div>
                </div>
                {returnCompletionNotice.paymentSummary ? (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, display: 'grid', gap: 10, padding: 16 }}>
                    <strong style={{ color: theme.colors.ink, fontSize: 14 }}>Return payment summary</strong>
                    <div style={{ display: 'grid', gap: 9 }}>
                      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: theme.colors.slate }}>Late fee</span>
                        <strong style={{ color: theme.colors.ink }}>{currencyFormatter.format(returnCompletionNotice.paymentSummary.lateFeeTotal)}</strong>
                      </div>
                      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: theme.colors.slate }}>Applied from security deposit</span>
                        <strong style={{ color: theme.colors.ink }}>{currencyFormatter.format(returnCompletionNotice.paymentSummary.depositApplied)}</strong>
                      </div>
                      <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: theme.colors.slate }}>Paid through PayMongo</span>
                        <strong style={{ color: theme.colors.ink }}>{currencyFormatter.format(returnCompletionNotice.paymentSummary.payMongoPaid)}</strong>
                      </div>
                      <div style={{ alignItems: 'center', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', gap: 16, paddingTop: 9 }}>
                        <span style={{ color: theme.colors.slate }}>Security deposit refund</span>
                        <strong style={{ color: '#9a3412' }}>Not issued due to late fee</strong>
                      </div>
                    </div>
                  </div>
                ) : returnCompletionNotice.securityDepositReturned > 0 ? (
                  <div style={{ alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, display: 'flex', justifyContent: 'space-between', gap: 12, padding: 14 }}>
                    <span style={{ color: theme.colors.slate }}>Security deposit returned</span>
                    <strong style={{ color: theme.colors.ink }}>{currencyFormatter.format(returnCompletionNotice.securityDepositReturned)}</strong>
                  </div>
                ) : null}
              </>
            ) : (
              <StatusMessage tone={returnCompletionNotice.tone}>{returnCompletionNotice.message}</StatusMessage>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        actions={
          <>
            {editingItem ? (
              <Button
                disabled={savingListing || deletingItemId === editingItem.id}
                onClick={() => setDeleteTargetItem(editingItem)}
                type="button"
                variant="danger"
              >
                {deletingItemId === editingItem.id ? 'Deleting...' : 'Delete listing'}
              </Button>
            ) : null}
            <Button onClick={closeAddListing} variant="ghost">
              Cancel
            </Button>
            <Button disabled={savingListing} form="add-listing-form" type="submit">
              {savingListing ? (editingItem ? 'Saving changes...' : 'Saving...') : editingItem ? 'Save changes' : 'Save listing'}
            </Button>
          </>
        }
        contentClassName={isListingFormPage ? 'listing-editor-shell' : undefined}
        contentStyle={isListingFormPage ? { borderRadius: 0 } : undefined}
        inline={isListingFormPage}
        onClose={closeAddListing}
        open={showAddListing && (!isEditPage || Boolean(editingItem))}
        title={editingItem ? 'Edit product listing' : 'Post a product listing'}
      >
        <div className="listing-form-page-head">
          <p>List your gear and start earning from your community.</p>
        </div>
        <form
          id="add-listing-form"
          onSubmit={handleCreateListing}
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            maxHeight: '70vh',
            overflowY: 'auto',
            paddingRight: 6,
          }}
          className="responsive-modal-grid responsive-scroll-form listing-form-page"
        >
          {loadingListingDetails ? <DataLoadingScreen compact label="Loading product details" message="Loading the selected product from the database." title="Getting product details" /> : null}

          <div className="listing-form-section" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Product Info</div>
            <div className="listing-product-info-layout">
              <div className="listing-product-info-core">
                <FormField hint="Name the actual item, template, component, model, or customizable prototype being listed." label="Actual item listing" required>
                  <Input name="title" onChange={handleFormChange} required value={listingForm.title} />
                </FormField>

                <FormField hint="Choose one of the valid item conditions from your database enum." label="Item condition" required>
                  <select name="item_condition" onChange={handleFormChange} style={selectStyle} value={listingForm.item_condition}>
                    <option value="">Select item condition</option>
                    {itemConditionOptions.map((option) => (
                      <option key={option} value={option}>
                        {formatListingStatusLabel(option)}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="listing-product-info-details">
                <FormField hint="Describe the item, its features, included parts, and anything borrowers should know." label="Product details" required>
                  <Textarea name="description" onChange={handleFormChange} value={listingForm.description} />
                </FormField>
              </div>

              <div className="listing-product-classification-grid">
                <div className="listing-main-category-column">
                  <FormField label="Main category" required>
                    <div className="listing-category-picker" ref={categoryPickerRef}>
                      <button
                        aria-expanded={categoryPickerOpen}
                        aria-haspopup="listbox"
                        className="listing-category-trigger"
                        onClick={() => setCategoryPickerOpen((current) => !current)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setCategoryPickerOpen(false);
                            setCategorySearch('');
                          }
                        }}
                        type="button"
                      >
                        <span>{selectedListingMainCategory?.name || 'Select a main category'}</span>
                        <span aria-hidden="true" className="listing-category-trigger-chevron">⌄</span>
                      </button>

                      {categoryPickerOpen ? (
                        <div className="listing-category-menu">
                          <input
                            aria-label="Search main categories"
                            autoFocus
                            className="listing-category-search"
                            onChange={(event) => setCategorySearch(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                setCategoryPickerOpen(false);
                                setCategorySearch('');
                              }
                            }}
                            placeholder="Search categories"
                            type="search"
                            value={categorySearch}
                          />
                          <div className="listing-category-options" id="listing-main-category-options" role="listbox">
                            {activeMainCategories
                              .filter((category) => category.name.toLowerCase().includes(categorySearch.trim().toLowerCase()))
                              .map((category) => (
                                <button
                                  aria-selected={listingForm.category_id === category.id}
                                  className={listingForm.category_id === category.id ? 'is-selected' : ''}
                                  key={category.id}
                                  onClick={() => handleMainCategorySelection(category.id)}
                                  role="option"
                                  type="button"
                                >
                                  <span>{category.name}</span>
                                  {listingForm.category_id === category.id ? <span aria-hidden="true">✓</span> : null}
                                </button>
                              ))}
                            {!activeMainCategories.some((category) => category.name.toLowerCase().includes(categorySearch.trim().toLowerCase())) ? (
                              <p className="listing-category-empty">No main categories match your search.</p>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </FormField>

                </div>

                <FormField
                  hint={listingForm.category_id ? 'Choose the single subcategory that best describes the actual listing.' : 'Select a parent category first.'}
                  label="Subcategory"
                  required
                >
                  <select disabled={!listingForm.category_id} name="subcategory_id" onChange={handleFormChange} required style={selectStyle} value={listingForm.subcategory_id}>
                    <option value="">{listingForm.category_id ? 'Select a subcategory' : 'Select a parent category first'}</option>
                    {availableSubcategories.map((subcategory) => (
                      <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>
                    ))}
                  </select>
                </FormField>
              </div>

              {isAcademicProjectCategory(selectedListingMainCategory?.name) ? (
                <StatusMessage tone="warning">
                  Academic-project listings must be templates, components, references, models, or customizable prototypes. Ready-to-submit graded work is not allowed.
                </StatusMessage>
              ) : null}

              <div className="listing-academic-targeting-grid">
                <FormField
                  hint="Choose the NU Baliwag school whose courses should see this listing. Course choices are linked automatically to the selected school."
                  label="Target school"
                  required
                >
                  <div className="listing-choice-box listing-school-choice-box">
                    <label className="listing-target-choice">
                      <input
                        checked={listingForm.target_school_code === 'all'}
                        name="target_school_code"
                        onChange={handleTargetSchoolChange}
                        type="radio"
                        value="all"
                      />
                      <span><strong>All schools</strong><small>Show every official undergraduate course</small></span>
                    </label>
                    {NUB_SCHOOLS.map((school) => (
                      <label className="listing-target-choice" key={school.code}>
                        <input
                          checked={listingForm.target_school_code === school.code}
                          name="target_school_code"
                          onChange={handleTargetSchoolChange}
                          type="radio"
                          value={school.code}
                        />
                        <span><strong>{school.code}</strong><small>{school.name}</small></span>
                      </label>
                    ))}
                  </div>
                </FormField>

                <FormField
                  hint={selectedTargetSchool
                    ? `Only ${selectedTargetSchool.code} courses are shown because every course is linked to its official school.`
                    : 'Choose all programs or select one or more official courses across NU Baliwag.'}
                  label="Applicable courses"
                  required
                >
                  <div className="listing-choice-box listing-program-choice-box">
                    {listingForm.target_school_code === 'all' ? (
                      <label className="listing-target-choice listing-target-choice-all">
                        <input checked={listingForm.applies_to_all_programs} onChange={handleAllProgramsChange} type="checkbox" />
                        <span><strong>Applicable to all NU Baliwag programs</strong><small>Students from every school and course can find this listing</small></span>
                      </label>
                    ) : (
                      <label className="listing-target-choice listing-target-choice-all">
                        <input
                          checked={targetSchoolPrograms.every((program) => (listingForm.applicable_program_codes || []).includes(program.code))}
                          onChange={handleAllTargetSchoolProgramsChange}
                          type="checkbox"
                        />
                        <span><strong>Select all {selectedTargetSchool?.code} courses</strong><small>Target the entire {selectedTargetSchool?.name}</small></span>
                      </label>
                    )}
                    {!listingForm.applies_to_all_programs ? targetSchoolPrograms.map((program) => (
                      <label className="listing-target-choice" key={program.code}>
                        <input
                          checked={(listingForm.applicable_program_codes || []).includes(program.code)}
                          onChange={() => handleApplicableProgramToggle(program.code)}
                          type="checkbox"
                        />
                        <span><strong>{program.displayCode}</strong><small>{program.name}</small></span>
                      </label>
                    )) : null}
                  </div>
                </FormField>
              </div>

              {selectedListingSubcategory ? (
                <div className="listing-classification-summary">
                  <span>Classification</span>
                  <strong>{selectedListingMainCategory?.name}</strong>
                  <i aria-hidden="true">→</i>
                  <strong>{selectedListingSubcategory.name}</strong>
                  <i aria-hidden="true">→</i>
                  <strong>{listingForm.title || 'Actual item listing'}</strong>
                </div>
              ) : null}
            </div>
          </div>

          <div className="listing-form-section" style={{ gridColumn: '1 / -1', minWidth: 0 }}>
            <div className="listing-form-section-title">Product Images</div>
            <FormField hint="Optional. Upload one or more product images. The first selected image will be used as the primary image." label="Product images">
              <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
                <input
                  accept="image/*"
                  multiple
                  onChange={handleListingImagesChange}
                  ref={listingImagesInputRef}
                  style={{ display: 'none' }}
                  type="file"
                />
                <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  <Button disabled={listingImageFiles.length >= MAX_LISTING_IMAGES} onClick={() => listingImagesInputRef.current?.click()} type="button" variant="secondary">
                    <span style={{ alignItems: 'center', display: 'inline-flex', gap: 8 }}>
                      <UploadIcon size={16} />
                      {listingImageFiles.length ? 'Add more images' : 'Upload images'}
                    </span>
                  </Button>
                  {listingImageFiles.length ? (
                    <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.55 }}>
                      {listingImageFiles.length} of {MAX_LISTING_IMAGES} image{MAX_LISTING_IMAGES === 1 ? '' : 's'} selected.
                    </span>
                  ) : null}
                </div>

                {listingImagePreviews.length ? (
                  <div
                    style={{
                      minWidth: 0,
                      overflowX: 'auto',
                      overflowY: 'hidden',
                      paddingBottom: 6,
                      width: '100%',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 12,
                        width: 'max-content',
                      }}
                    >
                      {listingImagePreviews.map((preview, index) => (
                        <div
                          key={preview.id}
                          style={{
                            background: alpha(theme.colors.panel, 0.76),
                            border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                            display: 'grid',
                            flex: '0 0 220px',
                            gap: 10,
                            minHeight: 276,
                            overflow: 'hidden',
                            padding: 12,
                            width: 220,
                          }}
                        >
                          <div
                            style={{
                              background: alpha(theme.colors.panel, 0.92),
                              border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                              height: 148,
                              overflow: 'hidden',
                            }}
                          >
                            <img
                              alt={preview.name}
                              src={preview.url}
                              style={{
                                display: 'block',
                                height: '100%',
                                objectFit: 'cover',
                                width: '100%',
                              }}
                            />
                          </div>

                          <div style={{ alignContent: 'start', display: 'grid', gap: 8 }}>
                            <span
                              style={{
                                color: theme.colors.ink,
                                fontSize: 13,
                                fontWeight: 600,
                                lineHeight: 1.45,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={preview.name}
                            >
                              {preview.name}
                            </span>
                            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              {preview.isPrimary ? <Badge tone="info">Primary image</Badge> : <span />}
                              <Button onClick={() => removeListingImage(index)} type="button" variant="ghost">
                                Remove
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {savedListingImages.length ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <span style={{ color: theme.colors.slate, fontSize: 13, fontWeight: 600, lineHeight: 1.55 }}>Saved images</span>
                    <div
                      style={{
                        minWidth: 0,
                        overflowX: 'auto',
                        overflowY: 'hidden',
                        paddingBottom: 6,
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          gap: 12,
                          width: 'max-content',
                        }}
                      >
                        {savedListingImages.map((image, index) => (
                          <div
                            key={image.id}
                            style={{
                              background: alpha(theme.colors.panel, 0.76),
                              border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                              display: 'grid',
                              flex: '0 0 220px',
                              gap: 10,
                              minHeight: 248,
                              overflow: 'hidden',
                              padding: 12,
                              width: 220,
                            }}
                          >
                            <div
                              style={{
                                background: alpha(theme.colors.panel, 0.92),
                                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                                height: 148,
                                overflow: 'hidden',
                              }}
                            >
                              <img
                                alt={`Saved product ${index + 1}`}
                                src={image.image_url}
                                style={{
                                  display: 'block',
                                  height: '100%',
                                  objectFit: 'cover',
                                  width: '100%',
                                }}
                              />
                            </div>

                            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              {image.is_primary ? <Badge tone="info">Current primary</Badge> : <Badge tone="neutral">Saved image</Badge>}
                              <span style={{ color: theme.colors.slate, fontSize: 12 }}>#{image.sort_order + 1}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.55 }}>
                      Uploading new images will append them to the existing product gallery.
                    </span>
                  </div>
                ) : null}
              </div>
            </FormField>
          </div>

          <div className="listing-form-section listing-form-section-grid listing-form-section-grid-3" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Pricing & Value</div>
            <FormField label="Rental price per day" required>
              <Input min="0" name="rental_price_per_day" onChange={handleFormChange} step="0.01" type="number" value={listingForm.rental_price_per_day} />
            </FormField>

            <FormField label="Security deposit" required>
              <Input min="0" name="security_deposit" onChange={handleFormChange} step="0.01" type="number" value={listingForm.security_deposit} />
            </FormField>

            <FormField
              hint="Use this as the replacement or damage fee basis if the item is returned broken or beyond normal wear."
              label="Estimated value"
            >
              <Input min="0" name="estimated_value" onChange={handleFormChange} step="0.01" type="number" value={listingForm.estimated_value} />
            </FormField>

          </div>

          <div className="listing-form-section" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Sale Settings</div>
            <label className="listing-sale-toggle">
              <input
                checked={Boolean(listingForm.is_for_sale)}
                onChange={(event) =>
                  setListingForm((current) => ({
                    ...current,
                    is_for_sale: event.target.checked,
                    sale_price: event.target.checked ? current.sale_price : '',
                    sale_inclusions: event.target.checked ? current.sale_inclusions : '',
                  }))
                }
                type="checkbox"
              />
              Allow renter to buy this item
            </label>

            <p className="listing-sale-hint">
              Turn this on if the borrower can choose to purchase the item instead of only renting it.
            </p>

            {listingForm.is_for_sale ? (
              <div className="listing-form-section-grid">
                <FormField label="Sale price" required>
                  <Input min="0" name="sale_price" onChange={handleFormChange} step="0.01" type="number" value={listingForm.sale_price} />
                </FormField>

                <div style={{ gridColumn: '1 / -1' }}>
                  <FormField label="Sale inclusions" required>
                    <Textarea
                      name="sale_inclusions"
                      onChange={handleFormChange}
                      placeholder="Example: Includes the item, accessories, case, remaining contents, and original packaging."
                      value={listingForm.sale_inclusions}
                    />
                  </FormField>
                </div>
              </div>
            ) : null}
          </div>

          <div className="listing-form-section listing-form-section-grid listing-form-section-grid-3" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Rental Constraints</div>
            <FormField label="Quantity" required>
              <Input min="1" name="quantity" onChange={handleFormChange} step="1" type="number" value={listingForm.quantity} />
            </FormField>

            <FormField label="Minimum rental days" required>
              <Input min="1" name="min_rental_days" onChange={handleFormChange} step="1" type="number" value={listingForm.min_rental_days} />
            </FormField>

            <FormField label="Maximum rental days">
              <Input min={listingForm.min_rental_days || '1'} name="max_rental_days" onChange={handleFormChange} step="1" type="number" value={listingForm.max_rental_days} />
            </FormField>

            <div style={{ gridColumn: '1 / -1' }}>
              <FormField
                hint="Comma-separated tags improve search. Example: gas canister, butane, camping."
                label="Mini tags for search"
              >
                <Input
                  name="search_tags"
                  onChange={handleFormChange}
                  placeholder="gas canister, butane, portable stove"
                  value={listingForm.search_tags}
                />
              </FormField>
            </div>
          </div>

          <div className="listing-form-section" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Pickup Location</div>
            <div className="listing-form-section-grid" style={{ marginBottom: 20 }}>
              <FormField hint="Borrowers can claim the item at this time on their selected check-in date." label="Daily pickup time" required>
                <Input name="pickup_time" onChange={handleFormChange} required type="time" value={listingForm.pickup_time} />
              </FormField>
              <FormField hint="Returns after this time on the selected check-out date are late and accrue the daily late fee." label="Daily return deadline" required>
                <Input name="return_time" onChange={handleFormChange} required type="time" value={listingForm.return_time} />
              </FormField>
            </div>
            <PhilippineAddressFields
              fieldMap={{
                barangay: 'pickup_barangay',
                city: 'pickup_city',
                country: 'pickup_country',
                latitude: 'pickup_latitude',
                longitude: 'pickup_longitude',
                province: 'pickup_province',
                region: 'pickup_region',
                street: 'pickup_street',
              }}
              form={listingForm}
              labels={{
                barangay: 'Pickup barangay',
                city: 'Pickup city / municipality',
                country: 'Pickup country',
                mapDescription:
                  'Choose the pickup location from your saved address or search for a place so renters can see the correct meetup point on the map.',
                mapTitle: 'Pickup map location',
                province: 'Pickup province',
                region: 'Pickup region',
                search: 'Search pickup place',
                searchPlaceholder: 'Search the pickup place in the Philippines',
                street: 'Pickup street',
                useProfileAddress: 'Use my saved profile address as the pickup location',
              }}
              profileSource={profile}
              setForm={setListingForm}
              showCoordinates={false}
              showUseProfileAddress
              requiredFields={['barangay', 'city', 'province']}
            />
          </div>

          <div className="listing-form-section" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Additional Details</div>
            <FormField label="Meetup notes">
              <Textarea className="listing-meetup-notes" name="meetup_notes" onChange={handleFormChange} style={{ minHeight: 96 }} value={listingForm.meetup_notes} />
            </FormField>
            <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 14 }}>
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong style={{ color: theme.colors.ink, fontSize: 15 }}>Optional add-ons</strong>
                <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.55 }}>
                  Add optional reusable accessories or services such as equipment sets, delivery, or cleaning with their own rental pricing.
                </span>
              </div>
              <Button onClick={addAddonRow} type="button" variant="secondary">
                Add add-on
              </Button>
            </div>

            {listingAddons.length ? (
              <div className="listing-addon-table-wrap">
                <table className="listing-addon-table">
                  <thead>
                    <tr>
                      <th>Add-on</th>
                      <th>Price</th>
                      <th>Quantity</th>
                      <th>Pricing</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listingAddons.map((addon, index) => (
                      <tr key={`addon-${index}`}>
                        <td data-label="Add-on">
                          <div className="listing-addon-table-product">
                            <div className="listing-addon-table-image">
                              {addon.imagePreview || addon.image_url ? (
                                <img alt={addon.addon_name || `Add-on ${index + 1}`} src={addon.imagePreview || addon.image_url} />
                              ) : (
                                <span>No image</span>
                              )}
                            </div>
                            <div>
                              <strong>{addon.addon_name || `Add-on ${index + 1}`}</strong>
                              <span>{addon.description || 'No description provided.'}</span>
                            </div>
                          </div>
                        </td>
                        <td data-label="Price">{currencyFormatter.format(Number(addon.price) || 0)}</td>
                        <td data-label="Quantity">{Math.max(1, Number(addon.quantity) || 1)}</td>
                        <td data-label="Pricing">{addonPricingOptions.find((option) => option.value === addon.pricing_type)?.label || 'Per rental'}</td>
                        <td data-label="Status">
                          <Badge tone={addon.is_required ? 'info' : 'neutral'}>{addon.is_required ? 'Required' : 'Optional'}</Badge>
                        </td>
                        <td data-label="Action">
                          <div className="listing-addon-table-actions">
                            <Button onClick={() => editAddonRow(index)} type="button" variant="secondary">Edit</Button>
                            <Button onClick={() => removeAddonRow(index)} type="button" variant="ghost">Remove</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <StatusMessage tone="info">No add-ons yet. Keep the listing simple or add optional extras with their own fees.</StatusMessage>
            )}
          </div>
          </div>
        </form>
      </Modal>

      <Modal
        actions={
          <>
            <Button onClick={closeAddonEditor} type="button" variant="ghost">Cancel</Button>
            <Button form="listing-addon-editor-form" type="submit">
              {addonEditor?.index >= 0 ? 'Save changes' : 'Add add-on'}
            </Button>
          </>
        }
        contentClassName="listing-addon-editor-modal"
        contentStyle={{ background: 'var(--ui-background-color, #fff)' }}
        onClose={closeAddonEditor}
        open={Boolean(addonEditor)}
        size="compact"
        title={addonEditor?.index >= 0 ? 'Edit add-on' : 'Add add-on'}
      >
        {addonEditor ? (
          <form
            className="listing-addon-editor-form"
            id="listing-addon-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveAddonEditor();
            }}
          >
            {addonEditorError ? <StatusMessage tone="warning">{addonEditorError}</StatusMessage> : null}

            <div className="listing-addon-editor-fields">
              <FormField label="Add-on name" required>
                <Input onChange={(event) => handleAddonEditorChange('addon_name', event.target.value)} required value={addonEditor.value.addon_name} />
              </FormField>

              <FormField label="Price" required>
                <Input min="0" onChange={(event) => handleAddonEditorChange('price', event.target.value)} required step="0.01" type="number" value={addonEditor.value.price} />
              </FormField>

              <FormField label="Available quantity" required>
                <Input min="1" onChange={(event) => handleAddonEditorChange('quantity', event.target.value)} required step="1" type="number" value={addonEditor.value.quantity} />
              </FormField>

              <FormField label="Pricing type" required>
                <select
                  onChange={(event) => handleAddonEditorChange('pricing_type', event.target.value)}
                  required
                  style={selectStyle}
                  value={addonEditor.value.pricing_type}
                >
                  {addonPricingOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
            </div>

            <FormField label="Description">
              <Textarea className="listing-addon-editor-description" onChange={(event) => handleAddonEditorChange('description', event.target.value)} value={addonEditor.value.description} />
            </FormField>

            <div className="listing-addon-editor-media">
              <FormField label="Image">
                <input
                  accept="image/*"
                  onChange={(event) => handleAddonEditorImageChange(event.target.files?.[0] || null)}
                  type="file"
                />
              </FormField>

              <div className="listing-addon-media-row">
                {addonEditor.value.imagePreview || addonEditor.value.image_url ? (
                  <div className="listing-addon-image-preview">
                    <img
                      alt={addonEditor.value.addon_name || 'Add-on preview'}
                      src={addonEditor.value.imagePreview || addonEditor.value.image_url}
                    />
                  </div>
                ) : (
                  <div className="listing-addon-image-placeholder">No image</div>
                )}
                <div className="listing-addon-media-actions">
                  {addonEditor.value.image_url && !addonEditor.value.imagePreview ? <Badge tone="info">Saved image</Badge> : null}
                  {addonEditor.value.imagePreview ? <Badge tone="success">New image</Badge> : null}
                  {addonEditor.value.imagePreview || addonEditor.value.image_url ? (
                    <Button onClick={() => handleAddonEditorImageChange(null)} type="button" variant="ghost">Remove image</Button>
                  ) : null}
                </div>
              </div>
            </div>

            <label className="listing-addon-required-toggle">
              <input
                checked={addonEditor.value.is_required}
                onChange={(event) => handleAddonEditorChange('is_required', event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Required add-on</strong>
                <small>Automatically include this add-on in every booking.</small>
              </span>
            </label>
          </form>
        ) : null}
      </Modal>

      <Modal
        actions={
          <>
            <Button disabled={Boolean(deletingItemId)} onClick={() => setDeleteTargetItem(null)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={Boolean(deletingItemId) || !deleteTargetItem}
              onClick={() => handleDeleteListing(deleteTargetItem)}
              type="button"
              variant="danger"
            >
              {deletingItemId ? 'Deleting...' : 'Delete permanently'}
            </Button>
          </>
        }
        onClose={() => setDeleteTargetItem(null)}
        open={Boolean(deleteTargetItem)}
        title="Delete listing"
      >
        <StatusMessage tone="warning">
          Delete "{deleteTargetItem?.title || 'this listing'}"? This cannot be undone.
        </StatusMessage>
      </Modal>

      <Modal
        actions={
          <>
            {bookingDetail &&
            isSameEntityId(bookingDetail.owner_id, userId) &&
            OWNER_RETURNABLE_STATUSES.includes(String(bookingDetail.status || '').toLowerCase()) ? (
              <Button
                className="booking-action-button"
                disabled={bookingActionBusyId === bookingDetail.id || !bookingDetailCanOwnerCompleteReturn}
                onClick={() => handleMarkReturned(bookingDetail)}
                type="button"
                variant="secondary"
              >
                {bookingActionBusyId === bookingDetail.id
                  ? 'Completing return...'
                  : bookingDetailLateFee.total > 0 && !bookingDetailLateFeeIsPaid
                    ? bookingDetailLateFeePaymentsError
                      ? 'Payment status unavailable'
                      : 'Awaiting borrower payment'
                    : 'Complete return'}
              </Button>
            ) : null}
            <Button onClick={closeBookingDetail} variant="ghost">
              Close
            </Button>
            {bookingDetail &&
            bookingDetail.borrower_id === userId &&
            bookingDetailLateFee.total > 0 &&
            LATE_FEE_PAYABLE_STATUSES.has(String(bookingDetail.status || '').toLowerCase()) ? (
              <Button
                className="booking-action-button late-fee-pay-button"
                disabled={bookingActionBusyId === bookingDetail.id}
                onClick={() => handlePayLateFee(bookingDetail)}
                type="button"
                variant="danger"
              >
                {bookingActionBusyId === bookingDetail.id
                  ? isLateFeePaymentReturn
                    ? 'Recording payment...'
                    : 'Opening secure checkout...'
                  : bookingDetailPayMongoDue > 0
                    ? `Pay ${currencyFormatter.format(bookingDetailPayMongoDue)}`
                    : 'Apply deposit and submit return'}
              </Button>
            ) : null}
            {bookingDetail &&
            bookingDetail.borrower_id === userId &&
            bookingDetail.damageClaim &&
            isPayableDamageClaim(bookingDetail.damageClaim) ? (
              <Button
                className="booking-action-button"
                disabled={bookingActionBusyId === bookingDetail.id}
                onClick={() => handlePayDamageClaim(bookingDetail)}
                type="button"
                variant="danger"
              >
                {bookingActionBusyId === bookingDetail.id
                  ? 'Processing...'
                  : `Pay damage charge ${currencyFormatter.format(
                      Number(bookingDetail.damageClaim.amount_due) ||
                        Number(bookingDetail.damageClaim.admin_approved_amount) ||
                        Number(bookingDetail.damageClaim.claimed_amount) ||
                        0
                    )}`}
              </Button>
            ) : null}
            {bookingDetail && bookingDetail.owner_id === userId && String(bookingDetail.status || '').toLowerCase() === 'pending' ? (
              <Button
                className="booking-action-button"
                disabled={bookingActionBusyId === bookingDetail.id}
                onClick={() => handleApproveBooking(bookingDetail)}
                type="button"
                variant="secondary"
              >
                {bookingActionBusyId === bookingDetail.id ? 'Approving...' : 'Approve booking'}
              </Button>
            ) : null}
          </>
        }
        onClose={closeBookingDetail}
        open={Boolean(bookingDetail)}
        contentClassName="booking-detail-modal"
        title={bookingDetail?.item?.title ? `Booking details: ${bookingDetail.item.title}` : 'Booking details'}
      >
        {bookingDetail ? (
          <div className="booking-detail-modal-layout">
            <StatusMessage tone="info">
              {bookingDetail.owner_id === userId && String(bookingDetail.status || '').toLowerCase() === 'pending'
                ? 'Review booking details and selected add-ons before approval.'
                : 'Review the rented item, schedule, fees, and selected add-ons for this booking.'}
            </StatusMessage>

            {bookingDetail.item ? (
              <div className="booking-detail-card booking-detail-section-card">
                <strong style={{ color: theme.colors.ink, fontSize: 16 }}>Rented item</strong>
                <div style={{ alignItems: 'start', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  {bookingDetail.item.primaryImage?.image_url ? (
                    <img
                      alt={bookingDetail.item.title || 'Rented item'}
                      className="booking-thumb"
                      src={bookingDetail.item.primaryImage.image_url}
                      style={{ borderRadius: 12, height: 120, objectFit: 'cover', width: 140 }}
                    />
                  ) : null}
                  <div style={{ display: 'grid', gap: 6, minWidth: 180 }}>
                    <strong style={{ color: theme.colors.ink }}>{bookingDetail.item.title || 'Unknown item'}</strong>
                    <span style={{ color: theme.colors.slate }}>Condition: {bookingDetail.item.item_condition || 'Not specified'}</span>
                    {bookingDetail.item.description ? (
                      <span style={{ color: theme.colors.slate, lineHeight: 1.5 }}>{bookingDetail.item.description}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

                {bookingDetail.damageClaim && bookingDetail.borrower_id === userId && isPayableDamageClaim(bookingDetail.damageClaim) ? (
              <StatusMessage tone="warning">
                This booking has a pending damage balance of{' '}
                {currencyFormatter.format(
                  Number(bookingDetail.damageClaim.amount_due) || Number(bookingDetail.damageClaim.claimed_amount) || 0
                )}
                . Current claim status: {formatListingStatusLabel(bookingDetail.damageClaim.status)}.
              </StatusMessage>
            ) : null}

            {bookingDetail.damageClaim && !(bookingDetail.borrower_id === userId && String(bookingDetail.damageClaim.status || '').toLowerCase() === 'pending_admin_review') ? (
              <div
                className="booking-detail-card"
                style={{
                  background: alpha(theme.colors.panel, 0.92),
                  border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                  borderRadius: 18,
                  display: 'grid',
                  gap: 10,
                  padding: 14,
                }}
              >
                <strong style={{ color: theme.colors.ink, fontSize: 17, letterSpacing: '-0.02em' }}>Damage claim details</strong>
                <span style={{ color: theme.colors.slate }}>
                  Status: {formatListingStatusLabel(bookingDamageClaimDetail?.status || bookingDetail.damageClaim.status)}
                </span>
                <span style={{ color: theme.colors.slate }}>
                  Submitted: {formatDateTime(bookingDamageClaimDetail?.created_at || bookingDetail.damageClaim.created_at)}
                </span>
                <span style={{ color: theme.colors.slate }}>
                  Claimed amount: {currencyFormatter.format(Number(bookingDamageClaimDetail?.claimed_amount || bookingDetail.damageClaim.claimed_amount) || 0)}
                </span>
                <span style={{ color: theme.colors.slate }}>
                  Approved amount:{' '}
                  {currencyFormatter.format(Number(bookingDamageClaimDetail?.admin_approved_amount || bookingDetail.damageClaim.admin_approved_amount) || 0)}
                </span>
                <span style={{ color: theme.colors.slate }}>
                  Amount due:{' '}
                  {currencyFormatter.format(
                    Number(bookingDamageClaimDetail?.amount_due || bookingDetail.damageClaim.amount_due || bookingDetail.damageClaim.claimed_amount) || 0
                  )}
                </span>
                <span style={{ color: theme.colors.slate, lineHeight: 1.6 }}>
                  Description: {bookingDamageClaimDetail?.damage_description || bookingDetail.damageClaim.damage_description || 'No description saved.'}
                </span>

                {bookingDamageClaimLoading ? (
                  <DataLoadingScreen compact label="Loading damage evidence" message="Loading report evidence from the database." title="Getting evidence" />
                ) : Array.isArray(bookingDamageClaimDetail?.evidence) && bookingDamageClaimDetail.evidence.length ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <strong style={{ color: theme.colors.ink, fontSize: 13 }}>Photo evidence</strong>
                    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                      {bookingDamageClaimDetail.evidence.map((evidence) => (
                        <a
                          href={evidence.display_url || evidence.evidence_url}
                          key={evidence.id}
                          rel="noreferrer"
                          style={{
                            border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                            borderRadius: 10,
                            display: 'block',
                            maxWidth: 220,
                            overflow: 'hidden',
                          }}
                          target="_blank"
                        >
                          <img
                            alt="Damage evidence"
                            src={evidence.display_url || evidence.evidence_url}
                            style={{ display: 'block', height: 140, objectFit: 'cover', width: '100%' }}
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : (
                  <StatusMessage tone="info">No photo evidence loaded for this damage claim yet.</StatusMessage>
                )}
              </div>
            ) : null}

            <div className="booking-detail-card booking-detail-summary-card">
              <div className="booking-detail-head-row">
                <strong style={{ color: theme.colors.ink }}>Booking summary</strong>
                <Badge tone={bookingStatusTone(bookingDetail.status)}>{formatListingStatusLabel(bookingDetail.status)}</Badge>
              </div>
              <div className="booking-detail-kv-grid">
                <div>
                  <span>{bookingDetail.owner_id === userId ? 'Borrower' : 'Owner'}</span>
                  <strong>
                    {buildPersonName(bookingDetail.counterpart) || bookingDetail.counterpart?.username || (bookingDetail.owner_id === userId ? 'Borrower' : 'Owner')}
                  </strong>
                </div>
                <div>
                  <span>Requested start</span>
                  <strong>{formatDateTime(bookingDetail.requested_start)}</strong>
                </div>
                <div>
                  <span>Requested end</span>
                  <strong>{formatDateTime(bookingDetail.requested_end)}</strong>
                </div>
                <div>
                  <span>Rental days</span>
                  <strong>{Number(bookingDetail.rental_days) || 0}</strong>
                </div>
                <div>
                  <span>Rental fee total</span>
                  <strong>{currencyFormatter.format(Number(bookingDetail.rental_fee_total) || 0)}</strong>
                </div>
                <div>
                  <span>Security deposit</span>
                  <strong>{currencyFormatter.format(Number(bookingDetail.security_deposit) || 0)}</strong>
                </div>
              </div>
              {bookingDetailHasLateFee ? (
                <div className={`late-fee-payment-panel${bookingDetailLateFeeIsPaid ? ' is-paid' : ''}`}>
                  <div className="late-fee-payment-head">
                    <div>
                      <span>
                        {bookingDetailLateFeePaymentsLoading
                          ? 'Checking payment status'
                          : bookingDetailLateFeePaymentsError
                            ? 'Payment status unavailable'
                            : isLateFeePaymentReturn && bookingActionBusyId === bookingDetail.id
                              ? 'Recording payment'
                            : bookingDetailLateFeeIsPaid
                              ? 'Payment complete'
                              : bookingDetailLateFeePayments.some((payment) =>
                                  Number(payment.amount || 0) > 0 &&
                                  !SETTLED_LATE_FEE_PAYMENT_STATUSES.has(String(payment.status || '').toLowerCase())
                                )
                                ? 'Payment processing'
                                : 'Payment required'}
                      </span>
                      <strong>Late return fee</strong>
                    </div>
                    <span className={`late-fee-overdue-pill${bookingDetailLateFeeIsPaid ? ' is-paid' : ''}`}>
                      {bookingDetailLateFeeIsPaid
                        ? 'Paid'
                        : `${bookingDetailLateFeeDays} day${bookingDetailLateFeeDays === 1 ? '' : 's'} overdue`}
                    </span>
                  </div>
                  <div className="late-fee-payment-total">
                    <span>Total late fee</span>
                    <strong>{currencyFormatter.format(bookingDetailLateFeePaymentTotal)}</strong>
                  </div>
                  <div className="late-fee-breakdown">
                    <div>
                      <span>Security deposit applied</span>
                      <strong>{'\u2212'}{currencyFormatter.format(bookingDetailDepositApplied)}</strong>
                      <small>Applied to the late fee</small>
                    </div>
                    <div>
                      <span>Paid through PayMongo</span>
                      <strong>{currencyFormatter.format(bookingDetailLateFeePayMongoPaid)}</strong>
                      <small>Recorded late-fee payment</small>
                    </div>
                    <div>
                      <span>Remaining balance</span>
                      <strong>{currencyFormatter.format(bookingDetailLateFeeRemaining)}</strong>
                      <small>{bookingDetailLateFeeRemaining > 0 ? 'Still due' : 'Fully settled'}</small>
                    </div>
                  </div>
                  {bookingDetailLateFeePaymentsError ? (
                    <div className="late-fee-payment-note">
                      {bookingDetailLateFeePaymentsError} Late-fee payment status could not be loaded.
                    </div>
                  ) : bookingDetailLateFeeIsPaid ? (
                    <div className="late-fee-payment-note">
                      {bookingDetailLateFeePaidAt
                        ? `Late fee payment recorded ${formatDateTime(new Date(bookingDetailLateFeePaidAt).toISOString())}. `
                        : 'Late fee payment is recorded. '}
                      {String(bookingDetail.status || '').toLowerCase() === BOOKING_STATUS.RETURN_PENDING
                        ? 'The return is awaiting owner confirmation.'
                        : 'The original booking total above is separate from this paid late fee.'}
                    </div>
                  ) : bookingDetail.borrower_id === userId ? (
                    <div className="late-fee-payment-note">
                      {bookingDetailLateFeeRemaining > 0
                        ? 'Any late fee balance not covered by the security deposit is collected through PayMongo.'
                        : 'Your security deposit covers the late fee.'}
                    </div>
                  ) : bookingDetail.owner_id === userId ? (
                    <div className="late-fee-payment-note">
                      {bookingDetailLateFeePaymentsLoading
                        ? 'Checking the borrower’s late-fee payment.'
                        : bookingDetailLateFeePaymentsError
                          ? 'Payment could not be verified. Try reopening the item details before completing the return.'
                          : 'Verify the late-fee payment above before completing the return.'}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="booking-detail-total-row">
                <span>Original booking total</span>
                <strong>{currencyFormatter.format(Number(bookingDetail.total_due) || 0)}</strong>
              </div>
            </div>

            {bookingDetail.borrower_message ? (
              <div className="booking-detail-card booking-detail-section-card">
                <strong style={{ color: theme.colors.ink }}>Borrower message</strong>
                <span style={{ color: theme.colors.slate, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{bookingDetail.borrower_message}</span>
              </div>
            ) : null}

            <div className="booking-detail-card booking-detail-section-card">
              <strong style={{ color: theme.colors.ink }}>Booked add-ons</strong>
              {!bookingDetail.addons?.length ? (
                <span style={{ color: theme.colors.slate }}>No add-ons selected for this booking.</span>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {bookingDetail.addons.map((addon) => {
                    const pricingType = String(addon.pricing_type_snapshot || 'per_rental')
                      .split('_')
                      .join(' ');

                    return (
                      <div
                        className="booking-addon-card"
                        key={addon.id}
                        style={{
                          border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                          display: 'grid',
                          gap: 4,
                          padding: 10,
                        }}
                      >
                        <strong style={{ color: theme.colors.ink }}>{addon.addon_name_snapshot || 'Addon'}</strong>
                        <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                          {currencyFormatter.format(Number(addon.price_snapshot) || 0)} ({pricingType}) x {Number(addon.quantity) || 1}
                        </span>
                        <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                          Total: {currencyFormatter.format(Number(addon.total_amount) || 0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        actions={
          <>
            {damageClaimDetailBooking?.damageClaim &&
            isRejectedDamageClaim(damageClaimDetailBooking.damageClaim) &&
            getDamageReportWindowStatus(damageClaimDetailBooking).canReport ? (
              <Button
                onClick={() => {
                  const bookingToResubmit = damageClaimDetailBooking;
                  closeDamageClaimDetail();
                  openDamageReport(bookingToResubmit);
                }}
                type="button"
                variant="danger"
              >
                Resubmit report
              </Button>
            ) : null}
            <Button onClick={closeDamageClaimDetail} variant="ghost">
              Close
            </Button>
          </>
        }
        size="compact"
        onClose={closeDamageClaimDetail}
        open={Boolean(damageClaimDetailBooking)}
        title={damageClaimDetailBooking?.item?.title ? `Damage report: ${damageClaimDetailBooking.item.title}` : 'Damage report'}
      >
        {damageClaimDetailLoading ? (
          <DataLoadingScreen compact label="Loading damage report" message="Loading report details from the database." title="Getting report details" />
        ) : damageClaimDetailBooking?.damageClaim ? (
          <div className="booking-detail-modal-layout">
            {isRejectedDamageClaim(damageClaimDetailBooking.damageClaim) ? (
              <StatusMessage tone={getDamageReportWindowStatus(damageClaimDetailBooking).canReport ? 'warning' : 'info'}>
                {getDamageReportWindowStatus(damageClaimDetailBooking).canReport
                  ? `This report was rejected. You can revise and resubmit it before ${formatDateTime(getDamageReportWindowStatus(damageClaimDetailBooking).deadline)}.`
                  : 'This report was rejected, but the 24-hour damage report window has closed.'}
              </StatusMessage>
            ) : (
              <StatusMessage tone="info">A damage report has already been submitted for this booking.</StatusMessage>
            )}
            <div className="booking-detail-card booking-detail-summary-card">
              <div className="booking-detail-kv-grid">
                <div>
                  <span>Status</span>
                  <strong>{formatListingStatusLabel(damageClaimDetail?.status || damageClaimDetailBooking.damageClaim.status)}</strong>
                </div>
                <div>
                  <span>Submitted</span>
                  <strong>{formatDateTime(damageClaimDetail?.created_at || damageClaimDetailBooking.damageClaim.created_at)}</strong>
                </div>
                <div>
                  <span>Estimated amount</span>
                  <strong>
                    {currencyFormatter.format(Number(damageClaimDetail?.claimed_amount || damageClaimDetailBooking.damageClaim.claimed_amount) || 0)}
                  </strong>
                </div>
                <div>
                  <span>Damage description</span>
                  <strong>{damageClaimDetail?.damage_description || damageClaimDetailBooking.damageClaim.damage_description || 'No description saved.'}</strong>
                </div>
              </div>
            </div>
            {isRejectedDamageClaim(damageClaimDetailBooking.damageClaim) ? (
              <div className="damage-report-rejection-reason">
                <strong>Admin’s reason for rejection</strong>
                <p>{damageClaimDetail?.admin_notes || damageClaimDetailBooking.damageClaim.admin_notes || 'No specific reason was provided.'}</p>
              </div>
            ) : null}
            {Array.isArray(damageClaimDetail?.evidence) && damageClaimDetail.evidence.length ? (
              <div className="booking-detail-card booking-detail-section-card">
                <strong style={{ color: theme.colors.ink, fontSize: 13 }}>Uploaded photo evidence</strong>
                <div className="booking-detail-evidence-grid">
                  {damageClaimDetail.evidence.map((evidence) => (
                    <a
                      href={evidence.display_url || evidence.evidence_url}
                      key={evidence.id}
                      rel="noreferrer"
                      className="booking-detail-evidence-link"
                      target="_blank"
                    >
                      <img
                        alt="Damage evidence"
                        src={evidence.display_url || evidence.evidence_url}
                        className="booking-detail-evidence-image"
                      />
                    </a>
                  ))}
                </div>
              </div>
            ) : (
              <StatusMessage tone="info">No photo evidence was loaded for this report yet.</StatusMessage>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        actions={
          <>
            <Button disabled={savingDamageReport} onClick={closeDamageReport} variant="ghost">
              Not now
            </Button>
            <Button className="booking-action-button damage-report-submit" disabled={savingDamageReport} form="damage-report-form" type="submit" variant="danger">
              {savingDamageReport ? 'Submitting report...' : 'Submit for admin review'}
            </Button>
          </>
        }
        onClose={closeDamageReport}
        open={Boolean(damageReportBooking)}
        contentClassName="damage-report-modal"
        title="Report item damage"
      >
        {damageReportBooking ? (
          <form className="damage-report-form" id="damage-report-form" onSubmit={handleSubmitDamageReport}>
            <div className="damage-report-item-context">
              {damageReportBooking.item?.primaryImage?.image_url ? (
                <img alt="" src={damageReportBooking.item.primaryImage.image_url} />
              ) : (
                <span><UploadIcon size={22} /></span>
              )}
              <div>
                <small>Completed rental</small>
                <strong>{damageReportBooking.item?.title || 'Rented item'}</strong>
                <p>Borrower: {buildPersonName(damageReportBooking.counterpart) || damageReportBooking.counterpart?.username || 'Borrower'}</p>
              </div>
              <div className="damage-report-estimate">
                <span>Estimated value</span>
                <strong>{currencyFormatter.format(Number(damageReportBooking.item?.estimated_value) || 0)}</strong>
              </div>
            </div>

            {isRejectedDamageClaim(damageReportBooking.damageClaim) ? (
              <div className="damage-report-rejection-reason">
                <strong>Admin’s reason for rejecting the previous report</strong>
                <p>{damageReportBooking.damageClaim.admin_notes || 'No specific reason was provided.'}</p>
                <span>Address this feedback in your updated description and evidence.</span>
              </div>
            ) : null}

            <div className="damage-report-review-notice">
              <strong>Admin review required</strong>
              <span>The borrower is only restricted if an administrator approves this claim. Your amount may be adjusted after evidence review.</span>
            </div>

            <div className="damage-report-field">
              <div className="damage-report-field-head">
                <div>
                  <strong>Describe the damage<span aria-hidden="true" className="required-asterisk">*</span></strong>
                  <span>Include the affected parts, visible condition, and what happened during return.</span>
                </div>
                <small>{damageReportForm.description.length}/1000</small>
              </div>
              <Textarea
                maxLength={1000}
                onChange={(event) => setDamageReportForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Example: The screen has a visible crack in the upper-right corner and no longer displays correctly..."
                required
                rows={5}
                value={damageReportForm.description}
              />
            </div>

            <div className="damage-report-field">
              <div className="damage-report-field-head">
                <div>
                  <strong>Upload photo evidence<span aria-hidden="true" className="required-asterisk">*</span></strong>
                  <span>Add clear images showing the item and damaged areas.</span>
                </div>
                <small>{damageReportForm.files.length} selected</small>
              </div>
              <label className="damage-evidence-uploader">
                <UploadIcon size={24} />
                <strong>{damageReportForm.files.length ? 'Add or replace photos' : 'Choose evidence photos'}</strong>
                <span>PNG, JPG, or WEBP · Multiple files allowed</span>
              <input
                accept="image/*"
                multiple
                onChange={(event) => setDamageReportForm((current) => ({ ...current, files: Array.from(event.target.files || []) }))}
                required
                type="file"
              />
              </label>
            </div>

            {damageReportForm.files.length ? (
              <div className="damage-evidence-file-list">
                {damageReportForm.files.map((file) => (
                  <div key={`${file.name}-${file.lastModified}`}>
                    <span><UploadIcon size={15} /></span>
                    <div>
                      <strong>{file.name}</strong>
                      <small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="damage-report-upload-note">Files upload only after you submit the report.</p>
          </form>
        ) : null}
      </Modal>

      <Modal
        actions={
          <>
            <Button onClick={closeReviewModal} variant="ghost">
              Not now
            </Button>
            <Button className="booking-action-button review-submit-button" disabled={savingReview} form="booking-review-form" type="submit">
              {savingReview ? 'Publishing review...' : 'Publish review'}
            </Button>
          </>
        }
        onClose={closeReviewModal}
        open={showReviewModal}
        contentClassName="booking-review-modal"
        title="Share your rental experience"
      >
        <form className="booking-review-form" id="booking-review-form" onSubmit={handleSubmitReview}>
          <div className="review-item-context">
            {reviewBooking?.item?.primaryImage?.image_url ? (
              <img alt="" src={reviewBooking.item.primaryImage.image_url} />
            ) : (
              <span className="review-item-placeholder"><StarIcon size={22} /></span>
            )}
            <div>
              <span>Completed rental</span>
              <strong>{reviewBooking?.item?.title || 'Rented item'}</strong>
              <small>
                From {buildPersonName(reviewBooking?.counterpart) || reviewBooking?.counterpart?.username || 'the item owner'}
              </small>
            </div>
          </div>

          <section className="review-rating-section">
            <div className="review-field-heading">
              <div>
                <strong>How was your experience?<span aria-hidden="true" className="required-asterisk">*</span></strong>
                <span>Select a rating from 1 to 5 stars.</span>
              </div>
              <div className="review-rating-result">
                <strong>{reviewRating}.0</strong>
                <span>{ratingLabel(reviewRating)}</span>
              </div>
            </div>
            <div className="review-stars-wrap" role="radiogroup" aria-label="Rental rating">
              {[1, 2, 3, 4, 5].map((star) => {
                const isActive = star <= reviewRating;

                return (
                  <button
                    aria-checked={star === reviewRating}
                    aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                    className={`review-star-button${isActive ? ' active' : ''}`}
                    key={star}
                    onClick={() => setReviewForm((current) => ({ ...current, rating: String(star) }))}
                    role="radio"
                    type="button"
                  >
                    <StarIcon size={22} />
                    <span>{star}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="review-notes-section">
            <div className="review-field-heading">
              <div>
                <strong>Tell others about the rental</strong>
                <span>Condition, owner communication, pickup, or overall experience.</span>
              </div>
              <small>{reviewForm.review_text.length}/500</small>
            </div>
            <Textarea
              maxLength={500}
              name="review_text"
              onChange={(event) => setReviewForm((current) => ({ ...current, review_text: event.target.value }))}
              placeholder="What went well? Add details that would help another borrower..."
              rows={5}
              value={reviewForm.review_text}
            />
          </div>
          <p className="review-privacy-note">Your review will be visible to other Borrow Ko 'To users.</p>
        </form>
      </Modal>

      <Modal
        actions={
          <Button onClick={closeImageViewer} variant="ghost">
            Close
          </Button>
        }
        onClose={closeImageViewer}
        open={Boolean(imageViewer.activeUrl)}
        title={imageViewer.itemTitle ? `${imageViewer.itemTitle} images` : 'Listing images'}
      >
        {imageViewer.activeUrl ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div
              style={{
                background: alpha(theme.colors.panel, 0.92),
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                display: 'grid',
                minHeight: 320,
                overflow: 'hidden',
                placeItems: 'center',
              }}
            >
              <img
                alt={imageViewer.itemTitle || 'Listing image'}
                src={imageViewer.activeUrl}
                style={{
                  display: 'block',
                  maxHeight: '68vh',
                  objectFit: 'contain',
                  width: '100%',
                }}
              />
            </div>

            {imageViewer.images.length > 1 ? (
              <div
                style={{
                  display: 'grid',
                  gap: 10,
                  gridAutoColumns: '140px',
                  gridAutoFlow: 'column',
                  overflowX: 'auto',
                  paddingBottom: 4,
                }}
              >
                {imageViewer.images.map((image, index) => {
                  const isActive = image.image_url === imageViewer.activeUrl;

                  return (
                    <button
                      key={image.id || `${image.image_url}-${index}`}
                      onClick={() =>
                        setImageViewer((current) => ({
                          ...current,
                          activeUrl: image.image_url,
                        }))
                      }
                      style={{
                        background: alpha(theme.colors.panel, isActive ? 0.98 : 0.88),
                        border: `1px solid ${alpha(isActive ? theme.colors.ink : theme.colors.ink, isActive ? 0.24 : 0.08)}`,
                        cursor: 'pointer',
                        display: 'grid',
                        gap: 8,
                        padding: 8,
                        textAlign: 'left',
                      }}
                      type="button"
                    >
                      <img
                        alt={`${imageViewer.itemTitle || 'Listing image'} ${index + 1}`}
                        src={image.image_url}
                        style={{
                          aspectRatio: '1 / 1',
                          display: 'block',
                          objectFit: 'cover',
                          width: '100%',
                        }}
                      />
                      <span style={{ color: theme.colors.slate, fontSize: 12, fontWeight: 600 }}>
                        {image.is_primary ? 'Primary image' : `Image ${index + 1}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </UserShell>
  );
}
