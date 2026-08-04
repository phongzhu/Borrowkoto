import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { createDamageClaim, createDamageReport, getDamageClaimWithEvidence, uploadDamageEvidence, userHasActiveDamageHold } from '../../services/damageClaimsService';
import { approveItemPurchaseRequest } from '../../services/purchaseRequestsService';
import { createTestCheckoutSession } from '../../services/transaction';
import { CalendarIcon, CatalogIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, FilterIcon, StarIcon, UploadIcon } from '../../ui/icons';
import { SectionGrid } from '../../ui/layouts';
import PhilippineAddressFields from '../../ui/PhilippineAddressFields';
import { Badge, Button, FormField, Input, MetricCard, Modal, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { sanitizeText, validateBaliwagLocation, validateCoordinates } from '../../ui/profileFormUtils';
import { alpha, theme } from '../../ui/theme';
import { BOOKING_STATUS } from '../../utils/bookingEnums';
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

function isAcceptedVerificationStatus(status) {
  return ['approved', 'verified'].includes(String(status || '').toLowerCase());
}

function getVerificationStatusLabel(status) {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'verified') {
    return 'approved';
  }

  return status || 'pending';
}

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
    pickup_province: profile?.province || '',
    pickup_region: profile?.region || '',
    pickup_street: profile?.street || '',
    quantity: '1',
    rental_price_per_day: '',
    sale_inclusions: '',
    sale_price: '',
    search_tags: '',
    security_deposit: '',
    subcategory_ids: [],
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
    pickup_province: item?.pickup_province || '',
    pickup_region: item?.pickup_region || '',
    pickup_street: item?.pickup_street || '',
    quantity: item?.quantity === null || item?.quantity === undefined ? '1' : String(item.quantity),
    rental_price_per_day: item?.rental_price_per_day === null || item?.rental_price_per_day === undefined ? '' : String(item.rental_price_per_day),
    sale_inclusions: item?.sale_inclusions || '',
    sale_price: item?.sale_price === null || item?.sale_price === undefined ? '' : String(item.sale_price),
    search_tags: parsedMeta.tags.join(', '),
    security_deposit: item?.security_deposit === null || item?.security_deposit === undefined ? '' : String(item.security_deposit),
    subcategory_ids: Array.isArray(item?.subcategory_ids) ? item.subcategory_ids : [],
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

function normalizeEntityId(value) {
  return String(value || '').trim().toLowerCase();
}

function isSameEntityId(leftValue, rightValue) {
  const left = normalizeEntityId(leftValue);
  const right = normalizeEntityId(rightValue);
  return Boolean(left) && Boolean(right) && left === right;
}

const APPROVAL_STATUS_CANDIDATES = [BOOKING_STATUS.ACCEPTED];
const BORROWER_CANCELLABLE_STATUS_CANDIDATES = [BOOKING_STATUS.PENDING, BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.FOR_PICKUP, BOOKING_STATUS.ACTIVE];
const RETURN_STATUS_CANDIDATES = ['done', 'completed', 'returned', 'closed'];
const OWNER_RETURNABLE_STATUSES = [BOOKING_STATUS.ACCEPTED, BOOKING_STATUS.FOR_PICKUP, BOOKING_STATUS.ACTIVE, BOOKING_STATUS.OVERDUE];
const LATE_FEE_OWNER_SHARE = 0.7;
const LATE_FEE_ADMIN_SHARE = 0.3;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DAMAGE_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAYMONGO_PAYMENT_METHOD = 'paymongo';
const DEFAULT_PAYMENT_STATUS = 'recorded';
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
  const returnedAt = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
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
  const { itemId: editItemId } = useParams();
  const isEditPage = Boolean(editItemId);
  const isAddPage = listingMode === 'add';
  const isListingFormPage = isEditPage || isAddPage;
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState(null);
  const [verification, setVerification] = useState(null);
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [purchaseRequests, setPurchaseRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [search, setSearch] = useState('');
  const [listingStatusFilter, setListingStatusFilter] = useState('all');
  const [listingCategoryFilter, setListingCategoryFilter] = useState('all');
  const [listingPage, setListingPage] = useState(1);
  const [showAddListing, setShowAddListing] = useState(false);
  const [savingListing, setSavingListing] = useState(false);
  const [loadingListingDetails, setLoadingListingDetails] = useState(false);
  const [listingForm, setListingForm] = useState(buildListingForm(null));
  const [listingImageFiles, setListingImageFiles] = useState([]);
  const [listingImagePreviews, setListingImagePreviews] = useState([]);
  const [savedListingImages, setSavedListingImages] = useState([]);
  const [listingAddons, setListingAddons] = useState([]);
  const [editingItem, setEditingItem] = useState(null);
  const [deleteTargetItem, setDeleteTargetItem] = useState(null);
  const [imageViewer, setImageViewer] = useState({ activeUrl: '', images: [], itemTitle: '' });
  const [savingStatusId, setSavingStatusId] = useState('');
  const [deletingItemId, setDeletingItemId] = useState('');
  const [bookingActionBusyId, setBookingActionBusyId] = useState('');
  const [bookingDetailId, setBookingDetailId] = useState('');
  const [activeBookingFilter, setActiveBookingFilter] = useState(() => {
    const queryTab = new URLSearchParams(window.location.search).get('tab');
    return queryTab === 'schedule' ? 'approval' : 'approval';
  });
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
      let user = null;

      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        user = authUser || null;
      } catch (authError) {
        const authMessage = String(authError?.message || '').toLowerCase();

        if (
          authMessage.includes('navigatorlock') ||
          authMessage.includes('lock broken') ||
          authMessage.includes('released because another request stole it')
        ) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          user = session?.user || null;
        } else {
          throw authError;
        }
      }

      if (!user) {
        setUserId('');
        setProfile(null);
        setVerification(null);
        setCategories([]);
        setItems([]);
        setPurchaseRequests([]);
        setError('User not authenticated.');
        setLoading(false);
        return;
      }

      setUserId(user.id);

      const [profileResult, verificationResult, categoriesResult, itemsResult, bookingsResult, purchaseRequestsAsSellerResult, purchaseRequestsAsBuyerResult, damageHoldResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase
          .from('identity_verifications')
          .select('*')
          .eq('user_id', user.id)
          .order('submitted_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('categories').select('id, name, parent_category_id, is_active').order('name', { ascending: true }),
        supabase
          .from('items')
          .select(
            'id, owner_id, category_id, title, description, item_condition, rental_price_per_day, security_deposit, estimated_value, is_for_sale, sale_price, sale_inclusions, min_rental_days, max_rental_days, quantity, pickup_barangay, pickup_city, pickup_country, pickup_latitude, pickup_longitude, pickup_province, pickup_region, pickup_street, meetup_notes, status, is_active, created_at, updated_at'
          )
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('bookings')
          .select(
            'id, item_id, borrower_id, owner_id, requested_start, requested_end, approved_start, approved_end, rental_days, rental_price_per_day, rental_fee_total, security_deposit, total_due, borrower_message, status, cancelled_by, cancellation_reason, created_at, updated_at'
          )
          .or(`borrower_id.eq.${user.id},owner_id.eq.${user.id}`)
          .order('created_at', { ascending: false }),
        supabase
          .from('item_purchase_requests')
          .select('id, item_id, buyer_id, seller_id, buyer_requested_quantity, seller_approved_quantity, sale_price_snapshot, sale_total_amount_snapshot, sale_inclusions_snapshot, buyer_preferred_pickup_at, agreed_pickup_at, pickup_location_text, pickup_notes, buyer_message, seller_notes, status, requested_at, reviewed_at, paid_at, completed_at, created_at, updated_at')
          .eq('seller_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('item_purchase_requests')
          .select('id, item_id, buyer_id, seller_id, buyer_requested_quantity, seller_approved_quantity, sale_price_snapshot, sale_total_amount_snapshot, sale_inclusions_snapshot, buyer_preferred_pickup_at, agreed_pickup_at, pickup_location_text, pickup_notes, buyer_message, seller_notes, status, requested_at, reviewed_at, paid_at, completed_at, created_at, updated_at')
          .eq('buyer_id', user.id)
          .order('created_at', { ascending: false }),
        userHasActiveDamageHold(user.id),
      ]);

      const nextErrors = [];
      const profileData = profileResult.data || null;
      const verificationData = verificationResult.error ? null : verificationResult.data || null;
      const nextCategories = categoriesResult.data || [];
      const rawItems = itemsResult.data || [];
      setActiveDamageHold(Boolean(damageHoldResult));

    if (profileResult.error) {
      nextErrors.push(`profiles: ${profileResult.error.message}`);
    }

    if (verificationResult.error) {
      nextErrors.push(`identity_verifications: ${verificationResult.error.message}`);
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
          .filter((id) => id && id !== user.id)
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
    const manilaToday = getManilaTodayDate();
    const currentWeekStart = getWeekStartMonday(manilaToday);
    const itemDailyViewsResult = itemIds.length
      ? await supabase
          .from('item_daily_view_counts')
          .select('item_id, viewed_date, total_views, unique_viewers')
          .in('item_id', itemIds)
          .eq('owner_id', user.id)
          .eq('viewed_date', manilaToday)
      : { data: [], error: null };
    const itemWeeklyViewsResult = itemIds.length
      ? await supabase
          .from('item_weekly_view_counts')
          .select('item_id, week_start, total_views, unique_viewers')
          .in('item_id', itemIds)
          .eq('owner_id', user.id)
          .eq('week_start', currentWeekStart)
      : { data: [], error: null };
    const bookingItemsResult = bookingItemIds.length
      ? await supabase
          .from('items')
          .select(
            'id, owner_id, category_id, title, description, item_condition, rental_price_per_day, security_deposit, estimated_value, is_for_sale, sale_price, sale_inclusions, min_rental_days, max_rental_days, quantity, pickup_barangay, pickup_city, pickup_country, pickup_latitude, pickup_longitude, pickup_province, pickup_region, pickup_street, meetup_notes, status, is_active, created_at, updated_at'
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
      ? await supabase.from('reviews').select('id, booking_id, reviewer_id').eq('reviewer_id', user.id).in('booking_id', bookingIds)
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
            'id, report_id, booking_id, item_id, owner_id, borrower_id, damage_description, claimed_amount, admin_approved_amount, amount_due, status, created_at, updated_at'
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

    if (imagesResult.error) {
      nextErrors.push(`item_images: ${imagesResult.error.message}`);
    }
    if (itemSubcategoriesResult.error) {
      nextErrors.push(`item_subcategories: ${itemSubcategoriesResult.error.message}`);
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

    const imagesByItemId = new Map();
    const subcategoriesByItemId = new Map();
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
        today_views_total: dailyViewsByItemId.get(item.id)?.total_views || 0,
        today_unique_viewers: dailyViewsByItemId.get(item.id)?.unique_viewers || 0,
        week_views_total: weeklyViewsByItemId.get(item.id)?.total_views || 0,
        week_unique_viewers: weeklyViewsByItemId.get(item.id)?.unique_viewers || 0,
      };
    });

    const bookingItemsById = new Map((bookingItemsResult.data || []).map((bookingItem) => [bookingItem.id, bookingItem]));
    const purchaseItemsById = new Map((purchaseRequestItemsResult.data || []).map((item) => [item.id, item]));
    const purchaseProfilesById = new Map((purchaseRequestProfilesResult.data || []).map((person) => [person.id, person]));
    const nextBookings = rawBookings.map((booking) => {
      const bookingItem = bookingItemsById.get(booking.item_id) || null;
      const bookingItemImages = (bookingImagesByItemId.get(booking.item_id) || [])
        .slice()
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);
      const counterPartyId = booking.owner_id === user.id ? booking.borrower_id : booking.owner_id;

      return {
        ...booking,
        counterpart: bookingProfilesById.get(counterPartyId) || null,
        hasMyReview: reviewedBookingIds.has(booking.id),
        isBorrowerBooking: booking.borrower_id === user.id,
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
      item: purchaseItemsById.get(request.item_id) || null,
      seller: purchaseProfilesById.get(request.seller_id) || null,
    }));

      setProfile(profileData);
      setVerification(verificationData);
      setCategories(nextCategories);
      setItems(nextItems);
      setBookings(nextBookings);
      setPurchaseRequests(nextPurchaseRequests);
      setListingForm(buildListingForm(profileData));
      setError(nextErrors.join(' '));
      setLoading(false);
    } catch (loadError) {
      setError(loadError?.message || 'Unable to load bookings.');
      setLoading(false);
    } finally {
      loadListingsInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

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

  useEffect(() => () => revokeAddonPreviews(listingAddons), [listingAddons]);

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

    if (!verification) {
      issues.push('Submit your identity verification.');
    } else if (!isAcceptedVerificationStatus(verification.status)) {
      issues.push(`Wait for identity verification approval. Current status: ${getVerificationStatusLabel(verification.status)}.`);
    }

    return issues;
  }, [profile, verification]);

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
      setListingForm((current) => ({
        ...current,
        category_id: value,
        subcategory_ids: current.subcategory_ids.filter((subcategoryId) => {
          const subcategory = activeCategories.find((category) => category.id === subcategoryId);
          return Boolean(subcategory) && subcategory.parent_category_id === value;
        }),
      }));
      return;
    }

    setListingForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubcategoryToggle(subcategoryId, checked) {
    setListingForm((current) => {
      const currentIds = new Set(current.subcategory_ids || []);
      if (checked) {
        currentIds.add(subcategoryId);
      } else {
        currentIds.delete(subcategoryId);
      }
      return {
        ...current,
        subcategory_ids: Array.from(currentIds),
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
    setListingForm(buildListingForm(profile));
    setListingImageFiles([]);
    setSavedListingImages([]);
    setListingAddons([]);
    setEditingItem(null);
    setShowAddListing(true);
  }

  async function openEditListing(item) {
    setMessage('');
    setLoadingListingDetails(true);
    setShowAddListing(true);
    setEditingItem(item);
    setListingForm(buildListingFormFromItem(item));
    setListingImageFiles([]);
    setSavedListingImages(item.images || []);
    revokeAddonPreviews(listingAddons);
    setListingAddons([]);

    const { data: addonRows, error: addonError } = await supabase
      .from('item_addons')
      .select('addon_name, description, image_url, is_required, price, pricing_type, sort_order')
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
      return;
    }

    const targetItem = items.find((item) => item.id === editItemId);
    if (!targetItem) {
      setMessage('The selected product was not found.');
      setMessageTone('warning');
      navigate('/user/rental-items');
      return;
    }

    openEditListing(targetItem);
    // This route effect intentionally runs only when its route/item inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editItemId, isEditPage, items, navigate]);

  useEffect(() => {
    if (!isAddPage) {
      return;
    }

    openAddListing();
    // Opening the add route is controlled by the route flag, not form-state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAddPage]);

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
    setEditingItem(null);
  }, [isListingFormPage, listingAddons]);

  function closeAddListing() {
    revokeAddonPreviews(listingAddons);
    setShowAddListing(false);
    setSavingListing(false);
    setLoadingListingDetails(false);
    setListingImageFiles([]);
    setSavedListingImages([]);
    setListingAddons([]);
    setDeleteTargetItem(null);
    setEditingItem(null);
    setListingForm(buildListingForm(profile));
    if (isListingFormPage) {
      navigate('/user/rental-items');
    }
  }

  function addAddonRow() {
    setListingAddons((current) => [...current, createEmptyAddon()]);
  }

  function removeAddonRow(index) {
    setListingAddons((current) => {
      const next = current.filter((_, currentIndex) => currentIndex !== index);
      revokeAddonPreview(current[index]?.imagePreview);
      return next;
    });
  }

  function handleAddonChange(index, field, value) {
    setListingAddons((current) =>
      current.map((addon, currentIndex) =>
        currentIndex === index
          ? {
              ...addon,
              [field]: field === 'is_required' ? Boolean(value) : value,
            }
          : addon
      )
    );
  }

  function handleAddonImageChange(index, file) {
    setListingAddons((current) =>
      current.map((addon, currentIndex) => {
        if (currentIndex !== index) {
          return addon;
        }

        revokeAddonPreview(addon.imagePreview);

        if (!file) {
          return {
            ...addon,
            imageFile: null,
            imagePreview: '',
            image_url: '',
          };
        }

        return {
          ...addon,
          imageFile: file,
          imagePreview: URL.createObjectURL(file),
        };
      })
    );
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
            : 'Complete your profile details and secure approved identity verification before creating a listing.'
        );
      }

      if (await userHasActiveDamageHold(userId)) {
        setActiveDamageHold(true);
        throw new Error('You cannot list items while an admin-approved damage hold is active. Settle the damage claim first.');
      }

      const title = sanitizeText(listingForm.title);
      const description = sanitizeText(listingForm.description);
      const categoryId = sanitizeText(listingForm.category_id);
      const itemCondition = normalizeItemCondition(sanitizeText(listingForm.item_condition));
      const pickupBarangay = sanitizeText(listingForm.pickup_barangay);
      const pickupCity = sanitizeText(listingForm.pickup_city);
      const pickupProvince = sanitizeText(listingForm.pickup_province);

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

      if (!itemCondition) {
        throw new Error('Item condition is required.');
      }

      if (!itemConditionOptions.includes(itemCondition)) {
        throw new Error(`Item condition must be one of: ${itemConditionOptions.map((value) => formatListingStatusLabel(value)).join(', ')}.`);
      }

      if (!pickupBarangay || !pickupCity || !pickupProvince) {
        throw new Error('Pickup barangay, city, and province are required.');
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
      validateBaliwagLocation({
        city: listingForm.pickup_city,
        province: listingForm.pickup_province,
        region: listingForm.pickup_region,
      });

      if (maxRentalDays !== null && maxRentalDays < minRentalDays) {
        throw new Error('Maximum rental days must be greater than or equal to minimum rental days.');
      }

      if (isForSale && !saleInclusions) {
        throw new Error('Sale inclusions are required when the item is available for purchase.');
      }
      const selectedSubcategoryIds = Array.from(new Set((listingForm.subcategory_ids || []).filter(Boolean)));
      const allowedSubcategoryIds = new Set((activeSubcategoriesByParentId.get(categoryId) || []).map((subcategory) => subcategory.id));

      if (selectedSubcategoryIds.some((subcategoryId) => !allowedSubcategoryIds.has(subcategoryId))) {
        throw new Error('Selected subcategories must belong to the selected main category.');
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
          sort_order: index,
        });

        return accumulator;
      }, []);

      const insertPayload = {
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
        quantity,
        rental_price_per_day: rentalPricePerDay,
        sale_inclusions: saleInclusions,
        sale_price: salePrice,
        security_deposit: securityDeposit,
        status: 'draft',
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

      if (selectedSubcategoryIds.length) {
        const subcategoryRows = selectedSubcategoryIds.map((subcategoryId) => ({
          item_id: currentItemId,
          subcategory_id: subcategoryId,
        }));
        const { error: insertSubcategoriesError } = await supabase.from('item_subcategories').insert(subcategoryRows);
        if (insertSubcategoriesError) {
          throw new Error(`Product saved, but subcategories failed to save: ${insertSubcategoriesError.message}`);
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
    () => completedOwnerBookings.filter((booking) => getDamageReportWindowStatus(booking).canReport && !booking.damageClaim),
    [completedOwnerBookings]
  );
  const payableDamageBookings = useMemo(
    () =>
      borrowerBookings.filter((booking) => {
        const claim = booking.damageClaim;
        if (!claim) {
          return false;
        }
        const normalizedStatus = String(claim.status || '').toLowerCase();
        if (!['awaiting_payment', 'approved', 'pending_admin_review'].includes(normalizedStatus)) {
          return false;
        }
        const amountDue = Number(claim.amount_due) || Number(claim.admin_approved_amount) || Number(claim.claimed_amount) || 0;
        return amountDue > 0;
      }),
    [borrowerBookings]
  );
  const bookingDetail = useMemo(() => bookings.find((booking) => booking.id === bookingDetailId) || null, [bookings, bookingDetailId]);
  const bookingDetailLateFee = useMemo(() => calculateLateFee(bookingDetail), [bookingDetail]);
  const reviewRating = Number(reviewForm.rating) || 0;
  const showManageBooking = viewMode === 'all' || viewMode === 'manage-booking';
  const showRentalItems = viewMode === 'all' || viewMode === 'rental-items';
  const pageTitle = '';
  const pageSubtitle = '';
  const bookingFilters = [
    { count: pendingApprovals.length + pendingPurchaseApprovals.length, key: 'approval', label: 'Needs approval' },
    { count: borrowerBookings.length, key: 'borrowed', label: 'Borrowed' },
    { count: ownerBookings.length, key: 'returns', label: 'Return completion' },
    { count: reportableCompletedBookings.length + payableDamageBookings.length, key: 'damage-reports', label: 'Damage reports' },
    { count: sellerPurchaseRequests.length + buyerPurchaseRequests.length, key: 'purchase-requests', label: 'Purchase requests' },
  ];
  const mobileSellingTotal = useMemo(() => {
    const rentalsTotal = ownerBookings.reduce((sum, booking) => sum + (Number(booking.rental_fee_total ?? booking.total_due) || 0), 0);
    const salesTotal = sellerPurchaseRequests.reduce((sum, request) => {
      const qty = Number(request.seller_approved_quantity || request.buyer_requested_quantity) || 1;
      const amount = Number(request.sale_total_amount_snapshot) || (Number(request.sale_price_snapshot) || 0) * qty;
      return sum + amount;
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
    if (queryTab === 'schedule') {
      setActiveBookingFilter('approval');
    }
  }, [location.search]);

  function openBookingDetail(booking) {
    if (!booking?.id) {
      return;
    }

    setBookingDetailId(booking.id);
  }

  function closeBookingDetail() {
    setBookingDetailId('');
  }

  const autoApprovePaidBookings = useCallback(async (bookingIds) => {
    const normalizedBookingIds = Array.from(new Set((bookingIds || []).filter(Boolean)));

    if (!normalizedBookingIds.length) {
      return { failedIds: [], updatedCount: 0 };
    }

    const bookingIdSet = new Set(normalizedBookingIds);
    const loadedBookingsById = new Map(bookings.filter((booking) => bookingIdSet.has(booking.id)).map((booking) => [booking.id, booking]));
    const missingBookingIds = normalizedBookingIds.filter((bookingId) => !loadedBookingsById.has(bookingId));

    if (missingBookingIds.length) {
      const { data: fetchedBookings, error: fetchError } = await supabase
        .from('bookings')
        .select('id, item_id, borrower_id, owner_id, requested_start, requested_end, approved_start, approved_end, rental_days, rental_price_per_day, rental_fee_total, security_deposit, total_due, borrower_message, status, cancelled_by, cancellation_reason, created_at, updated_at')
        .in('id', missingBookingIds)
        .eq('borrower_id', userId);

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      (fetchedBookings || []).forEach((booking) => {
        loadedBookingsById.set(booking.id, booking);
      });
    }

    const borrowerBookingsFromPayment = Array.from(loadedBookingsById.values()).filter((booking) => booking.borrower_id === userId);
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
  }, [bookings, recordRentalCheckoutTransactions, userId]);

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
          const firstFailure = String(transactionRecordFailures[0] || '');
          const failureReason = firstFailure.includes(':') ? firstFailure.split(':').slice(1).join(':').trim() : firstFailure;
          setMessage(
            `Payment succeeded. ${updatedCount} booking(s) were automatically approved, but ${transactionRecordFailures.length} payment record(s) failed to save.${
              failureReason ? ` Reason: ${failureReason}` : ''
            }`
          );
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
          setBookingActionBusyId('');
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
          .select('id, transaction_type, amount, status')
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
              notes: `Late fee: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Owner share 70%.`,
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
              notes: `Late fee: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Admin share 30%.`,
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
            .select('id, transaction_type, amount, status')
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

        // Reload bookings to reflect updated state
        await loadListings(false);

        if (!ignore) {
          const totalAmount = lateFeeTxns.reduce((sum, txn) => sum + Number(txn.amount), 0);
          setMessage(`Late fee payment of â‚±${totalAmount.toFixed(2)} completed successfully.`);
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
        const { data: purchaseRequest, error: purchaseFetchError } = await supabase
          .from('item_purchase_requests')
          .select(
            'id, item_id, buyer_id, seller_id, buyer_requested_quantity, seller_approved_quantity, sale_price_snapshot, sale_total_amount_snapshot, status, payment_transaction_id'
          )
          .eq('id', purchaseRequestId)
          .eq('buyer_id', userId)
          .limit(1)
          .maybeSingle();

        if (purchaseFetchError) {
          throw new Error(purchaseFetchError.message);
        }

        if (!purchaseRequest?.id) {
          throw new Error('Purchase request was not found for this account.');
        }

        const purchaseQuantity = Number(purchaseRequest.seller_approved_quantity || purchaseRequest.buyer_requested_quantity || 1);
        const purchaseAmount = toMoneyAmount(
          purchaseRequest.sale_total_amount_snapshot || (Number(purchaseRequest.sale_price_snapshot) || 0) * (purchaseQuantity > 0 ? purchaseQuantity : 1)
        );
        let purchasePaymentRecordError = '';
        let purchasePaymentTransactionId = purchaseRequest.payment_transaction_id || null;

        if (purchaseAmount > 0 && !purchasePaymentTransactionId) {
          try {
            const { transaction } = await insertPaymentTransactionWithTypeFallback(
              {
                amount: purchaseAmount,
                booking_id: null,
                notes: `Purchase payment for item request ${purchaseRequest.id}.`,
                payee_id: purchaseRequest.seller_id || null,
                payer_id: purchaseRequest.buyer_id || userId,
                payment_method: PAYMONGO_PAYMENT_METHOD,
                reference_number: `paymongo:purchase:${purchaseRequest.id}`,
                status: DEFAULT_PAYMENT_STATUS,
                transaction_at: new Date().toISOString(),
              },
              PAYMENT_TYPE_CANDIDATES.purchase
            );

            purchasePaymentTransactionId = transaction?.id || null;
          } catch (recordError) {
            const normalizedRecordError = String(recordError?.message || '').toLowerCase();

            if (normalizedRecordError.includes('booking_id') && normalizedRecordError.includes('null')) {
              const { data: fallbackBooking, error: fallbackBookingError } = await supabase
                .from('bookings')
                .select('id')
                .eq('borrower_id', userId)
                .eq('item_id', purchaseRequest.item_id)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (fallbackBookingError) {
                purchasePaymentRecordError = fallbackBookingError.message || 'Unable to load fallback booking reference for purchase payment.';
              } else if (fallbackBooking?.id) {
                try {
                  const { transaction } = await insertPaymentTransactionWithTypeFallback(
                    {
                      amount: purchaseAmount,
                      booking_id: fallbackBooking.id,
                      notes: `Purchase payment for item request ${purchaseRequest.id}.`,
                      payee_id: purchaseRequest.seller_id || null,
                      payer_id: purchaseRequest.buyer_id || userId,
                      payment_method: PAYMONGO_PAYMENT_METHOD,
                      reference_number: `paymongo:purchase:${purchaseRequest.id}`,
                      status: DEFAULT_PAYMENT_STATUS,
                      transaction_at: new Date().toISOString(),
                    },
                    PAYMENT_TYPE_CANDIDATES.purchase
                  );
                  purchasePaymentTransactionId = transaction?.id || null;
                } catch (fallbackInsertError) {
                  purchasePaymentRecordError = fallbackInsertError.message || 'Unable to create purchase payment transaction.';
                }
              } else {
                purchasePaymentRecordError = recordError.message || 'Unable to create purchase payment transaction.';
              }
            } else {
              purchasePaymentRecordError = recordError.message || 'Unable to create purchase payment transaction.';
            }
          }
        }

        const purchaseUpdatePayload = {
          paid_at: new Date().toISOString(),
          status: 'paid',
          updated_at: new Date().toISOString(),
        };

        if (purchasePaymentTransactionId) {
          purchaseUpdatePayload.payment_transaction_id = purchasePaymentTransactionId;
        }

        const { error: purchaseUpdateError } = await supabase
          .from('item_purchase_requests')
          .update(purchaseUpdatePayload)
          .eq('id', purchaseRequestId)
          .eq('buyer_id', userId)
          .in('status', ['awaiting_payment', 'approved', 'pending']);

        if (purchaseUpdateError) {
          throw new Error(purchaseUpdateError.message);
        }

        await loadListings(false);

        if (!ignore) {
          setActiveBookingFilter('purchase-requests');
          if (purchasePaymentRecordError) {
            setMessage(`Purchase payment completed, but transaction recording failed: ${purchasePaymentRecordError}`);
            setMessageTone('warning');
          } else {
            setMessage('Purchase payment completed. You can now mark the item as claimed after pickup.');
            setMessageTone('success');
          }
          setBookingActionBusyId('');
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch (paymentError) {
        if (!ignore) {
          setMessage(`Purchase payment succeeded, but status update failed: ${paymentError.message}`);
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

    window.history.replaceState({}, '', window.location.pathname);
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
        ],
        metadata: {
          item_id: request.item_id,
          purchase_request_id: request.id,
          source: 'purchase_request_payment',
        },
        successUrl,
      });

      if (checkoutSession?.attributes?.checkout_url) {
        window.location.href = checkoutSession.attributes.checkout_url;
      } else {
        throw new Error('Failed to get checkout URL from PayMongo.');
      }
    } catch (paymentError) {
      setMessage(`Unable to process purchase payment: ${paymentError.message}`);
      setMessageTone('warning');
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
      const { error: updateError } = await supabase
        .from('item_purchase_requests')
        .update({
          completed_at: new Date().toISOString(),
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.id)
        .eq('buyer_id', userId)
        .in('status', ['paid', 'ready_for_pickup']);

      if (updateError) {
        throw new Error(updateError.message);
      }

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

    try {
      const returnedAt = new Date();
      const lateFee = calculateLateFee(booking, returnedAt);
      const adminPayeeId = await resolveAdminPayeeId();
      const nextStatus = await updateBookingStatusWithFallback(booking, RETURN_STATUS_CANDIDATES);
      let lateFeeRecorded = true;
      let depositReturnRecordError = '';
      let depositReturnSkippedReason = '';
      let depositReturnedAmount = 0;
      const securityDepositAmount = toMoneyAmount(Number(booking.security_deposit || 0));
      const lateFeeCoveredByDeposit = toMoneyAmount(Math.min(securityDepositAmount, Number(lateFee.total || 0)));
      const lateFeeRemainingToPay = toMoneyAmount(Math.max(0, Number(lateFee.total || 0) - lateFeeCoveredByDeposit));

      function splitLateFeeShares(amount) {
        const normalizedAmount = toMoneyAmount(amount);
        if (normalizedAmount <= 0) {
          return { admin: 0, owner: 0 };
        }
        const owner = toMoneyAmount(normalizedAmount * LATE_FEE_OWNER_SHARE);
        const admin = toMoneyAmount(Math.max(0, normalizedAmount - owner));
        return { admin, owner };
      }

      if (lateFee.total > 0) {
        const coveredShares = splitLateFeeShares(lateFeeCoveredByDeposit);
        const remainingShares = splitLateFeeShares(lateFeeRemainingToPay);
        const lateFeeTransactions = [
          {
            amount: coveredShares.owner,
            booking_id: booking.id,
            notes: `Late fee covered by security deposit: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Owner share 70%.`,
            payee_id: booking.owner_id,
            payer_id: booking.borrower_id,
            payment_method: PAYMONGO_PAYMENT_METHOD,
            reference_number: `paymongo:late_fee:owner:deposit:${booking.id}`,
            status: DEFAULT_PAYMENT_STATUS,
            transaction_at: returnedAt.toISOString(),
            transaction_type: 'late_fee_owner_share',
          },
          {
            amount: coveredShares.admin,
            booking_id: booking.id,
            notes: `Late fee covered by security deposit: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Admin share 30%.`,
            payee_id: adminPayeeId,
            payer_id: booking.borrower_id,
            payment_method: PAYMONGO_PAYMENT_METHOD,
            reference_number: `paymongo:late_fee:admin:deposit:${booking.id}`,
            status: DEFAULT_PAYMENT_STATUS,
            transaction_at: returnedAt.toISOString(),
            transaction_type: 'late_fee_admin_share',
          },
          {
            amount: remainingShares.owner,
            booking_id: booking.id,
            notes: `Remaining late fee due after deposit deduction: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Owner share 70%.`,
            payee_id: booking.owner_id,
            payer_id: booking.borrower_id,
            payment_method: PAYMONGO_PAYMENT_METHOD,
            reference_number: `paymongo:late_fee:owner:${booking.id}`,
            status: 'pending',
            transaction_at: returnedAt.toISOString(),
            transaction_type: 'late_fee_owner_share',
          },
          {
            amount: remainingShares.admin,
            booking_id: booking.id,
            notes: `Remaining late fee due after deposit deduction: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Admin share 30%.`,
            payee_id: adminPayeeId,
            payer_id: booking.borrower_id,
            payment_method: PAYMONGO_PAYMENT_METHOD,
            reference_number: `paymongo:late_fee:admin:${booking.id}`,
            status: 'pending',
            transaction_at: returnedAt.toISOString(),
            transaction_type: 'late_fee_admin_share',
          },
        ].filter((transaction) => Number(transaction.amount) > 0);

        const { error: lateFeeInsertError } = await supabase.from('payment_transactions').insert(lateFeeTransactions);
        lateFeeRecorded = !lateFeeInsertError;
      }

      const refundableDepositAmount = toMoneyAmount(Math.max(0, securityDepositAmount - lateFeeCoveredByDeposit));

      if (booking?.damageClaim?.id) {
        depositReturnSkippedReason = 'deposit is held because this booking has a damage claim';
      } else if (refundableDepositAmount <= 0 && Number(booking.security_deposit || 0) > 0) {
        depositReturnSkippedReason = 'no deposit to return after deductions';
      } else if (refundableDepositAmount > 0) {
        try {
          await insertPaymentTransactionWithTypeFallback(
            {
              amount: refundableDepositAmount,
              booking_id: booking.id,
              notes: `Security deposit return for ${booking.item?.title || 'rental item'} after return confirmation.`,
              payee_id: booking.borrower_id,
              payer_id: booking.owner_id,
              payment_method: PAYMONGO_PAYMENT_METHOD,
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

      if (lateFee.total > 0) {
        const lateFeeMessage = lateFeeRecorded
          ? `Booking marked as done/returned. Late fee: ${currencyFormatter.format(lateFee.total)} (${lateFee.daysLate} day(s)). Deducted from deposit: ${currencyFormatter.format(lateFeeCoveredByDeposit)}.${lateFeeRemainingToPay > 0 ? ` Remaining to pay: ${currencyFormatter.format(lateFeeRemainingToPay)}.` : ' No additional late-fee payment is needed.'}`
          : `Booking marked as done/returned. Late fee is ${currencyFormatter.format(lateFee.total)}, but it could not be recorded in payment transactions.`;
        const depositMessage =
          depositReturnedAmount > 0
            ? ` Security deposit returned: ${currencyFormatter.format(depositReturnedAmount)}.`
            : depositReturnSkippedReason
              ? ` Security deposit not returned now: ${depositReturnSkippedReason}.`
              : '';
        if (depositReturnRecordError) {
          setMessage(`${lateFeeMessage}${depositMessage} Deposit return record also failed: ${depositReturnRecordError}`);
          setMessageTone('warning');
        } else {
          setMessage(`${lateFeeMessage}${depositMessage}`);
          setMessageTone(lateFeeRecorded ? 'success' : 'warning');
        }
      } else {
        const depositMessage =
          depositReturnedAmount > 0
            ? ` Security deposit returned: ${currencyFormatter.format(depositReturnedAmount)}.`
            : depositReturnSkippedReason
              ? ` Security deposit not returned now: ${depositReturnSkippedReason}.`
              : '';
        if (depositReturnRecordError) {
          setMessage(`Booking marked as done/returned. No late fee was applied.${depositMessage} Deposit return recording failed: ${depositReturnRecordError}`);
          setMessageTone('warning');
        } else {
          setMessage(`Booking marked as done/returned. No late fee was applied.${depositMessage}`);
          setMessageTone('success');
        }
      }
    } catch (doneError) {
      setMessage(`Unable to mark booking as done: ${doneError.message}`);
      setMessageTone('warning');
    } finally {
      setBookingActionBusyId('');
    }
  }

  function openDamageReport(booking) {
    if (booking?.damageClaim) {
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

    if (damageReportBooking?.damageClaim) {
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
        .select('id')
        .eq('booking_id', damageReportBooking.id)
        .maybeSingle();

      if (existingDamageClaimError) {
        throw new Error(existingDamageClaimError.message);
      }

      if (existingDamageClaim?.id) {
        throw new Error('A damage report already exists for this booking.');
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
      const adminPayeeId = await resolveAdminPayeeId();

      if (lateFee.total <= 0) {
        setMessage('No late fee to pay for this booking.');
        setMessageTone('info');
        setBookingActionBusyId('');
        return;
      }

      const { data: existingLateFeeTxns, error: existingLateFeeTxnsError } = await supabase
        .from('payment_transactions')
        .select('id, transaction_type, amount, status')
        .eq('booking_id', booking.id)
        .in('transaction_type', ['late_fee_owner_share', 'late_fee_admin_share']);

      if (existingLateFeeTxnsError) {
        throw new Error(existingLateFeeTxnsError.message);
      }

      if (!existingLateFeeTxns || existingLateFeeTxns.length === 0) {
        const lateFeeTransactions = [
          {
            amount: lateFee.ownerShare,
            booking_id: booking.id,
            notes: `Late fee: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Owner share 70%.`,
            payee_id: booking.owner_id,
            payer_id: booking.borrower_id,
            payment_method: PAYMONGO_PAYMENT_METHOD,
            reference_number: `paymongo:late_fee:owner:${booking.id}`,
            status: 'pending',
            transaction_at: new Date().toISOString(),
            transaction_type: 'late_fee_owner_share',
          },
          {
            amount: lateFee.adminShare,
            booking_id: booking.id,
            notes: `Late fee: ${lateFee.daysLate} day(s) overdue at ${currencyFormatter.format(lateFee.feePerDay)} per day. Admin share 30%.`,
            payee_id: adminPayeeId,
            payer_id: booking.borrower_id,
            payment_method: PAYMONGO_PAYMENT_METHOD,
            reference_number: `paymongo:late_fee:admin:${booking.id}`,
            status: 'pending',
            transaction_at: new Date().toISOString(),
            transaction_type: 'late_fee_admin_share',
          },
        ].filter((transaction) => Number(transaction.amount) > 0);

        if (lateFeeTransactions.length) {
          const { error: lateFeeInsertError } = await supabase.from('payment_transactions').insert(lateFeeTransactions);
          if (lateFeeInsertError) {
            throw new Error(lateFeeInsertError.message);
          }
        }
      }

      const successUrl = `${window.location.origin}/user/manage-booking?payment_status=success&booking_id=${booking.id}&late_fee_paid=true`;
      const cancelUrl = `${window.location.origin}/user/manage-booking?payment_status=cancelled&booking_id=${booking.id}`;

      const checkoutSession = await createTestCheckoutSession({
        amount: lateFee.total,
        cancelUrl,
        currency: 'PHP',
        description: `Late fee payment for "${booking.item?.title || 'rental'}" - ${lateFee.daysLate} day(s) overdue`,
        metadata: {
          booking_id: booking.id,
          late_fee_total: lateFee.total,
          owner_share: lateFee.ownerShare,
          admin_share: lateFee.adminShare,
          days_late: lateFee.daysLate,
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

  return (
    <UserShell subtitle={pageSubtitle} title={pageTitle}>
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

      <div className="my-bookings-page" style={{ alignContent: 'start', alignItems: 'start', display: 'grid', gap: 10 }}>
        {showManageBooking ? (
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
              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Incoming requests requiring your approval</strong>
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
                      {pendingApprovals.map((booking, index) => (
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
                          <td style={bodyCellStyle}>
                            {booking.addons?.length ? (
                              <Badge tone="info">{booking.addons.length} selected</Badge>
                            ) : (
                              <span style={{ color: theme.colors.slate }}>None</span>
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
              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Pending purchase requests for your sale listings</strong>
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
                      {pendingPurchaseApprovals.map((request, index) => {
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

            {activeBookingFilter === 'borrowed' ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>My borrowed bookings</strong>
              {!borrowerBookings.length ? (
                <StatusMessage tone="info">You do not have borrowed bookings yet.</StatusMessage>
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
                      {borrowerBookings.map((booking, index) => {
                        const isReturned = isReturnedBookingStatus(booking.status);
                        const canCancel = isBorrowerCancellableStatus(booking.status);
                        const lateFee = calculateLateFee(booking);

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
                                      height: 52,
                                      objectFit: 'cover',
                                      width: 52,
                                    }}
                                  />
                                ) : null}
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
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{buildPersonName(booking.counterpart) || booking.counterpart?.username || 'Owner'}</span>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>{booking.counterpart?.username ? `@${booking.counterpart.username}` : ''}</span>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              {booking.addons?.length ? <Badge tone="info">{booking.addons.length} selected</Badge> : <span style={{ color: theme.colors.slate }}>None</span>}
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
                                {lateFee.total > 0 && APPROVAL_STATUS_CANDIDATES.includes(String(booking.status || '').toLowerCase()) ? (
                                  <span style={{ color: theme.colors.danger, fontSize: 12, fontWeight: 700 }}>
                                    + {currencyFormatter.format(lateFee.total)} late fee ({lateFee.daysLate} day{lateFee.daysLate === 1 ? '' : 's'})
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
                              ) : lateFee.total > 0 && APPROVAL_STATUS_CANDIDATES.includes(String(booking.status || '').toLowerCase()) ? (
                                <Button
                                  className="booking-action-button"
                                  disabled={bookingActionBusyId === booking.id}
                                  onClick={() => handlePayLateFee(booking)}
                                  type="button"
                                  variant="secondary"
                                >
                                  {bookingActionBusyId === booking.id ? 'Processing...' : `Pay ${currencyFormatter.format(lateFee.total)} late fee`}
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
            <div style={{ display: 'grid', gap: 10 }}>
              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Owner return completion</strong>
              {!ownerBookings.length ? (
                <StatusMessage tone="info">No incoming bookings are assigned to your listings.</StatusMessage>
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
                        <th style={headerCellStyle}>Approved schedule</th>
                        <th style={headerCellStyle}>Late fee</th>
                        <th style={headerCellStyle}>Status</th>
                        <th style={headerCellStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ownerBookings.map((booking, index) => {
                        const canMarkDone = OWNER_RETURNABLE_STATUSES.includes(String(booking.status || '').toLowerCase());
                        const lateFee = calculateLateFee(booking);

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
                              <div style={{ display: 'grid', gap: 4 }}>
                                <span style={{ color: theme.colors.ink }}>{formatDateTime(booking.approved_start || booking.requested_start)}</span>
                                <span style={{ color: theme.colors.slate }}>to {formatDateTime(booking.approved_end || booking.requested_end)}</span>
                              </div>
                            </td>
                            <td style={bodyCellStyle}>
                              {lateFee.total > 0 && OWNER_RETURNABLE_STATUSES.includes(String(booking.status || '').toLowerCase()) ? (
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <strong style={{ color: theme.colors.danger }}>{currencyFormatter.format(lateFee.total)}</strong>
                                  <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                                    {lateFee.daysLate} day{lateFee.daysLate === 1 ? '' : 's'} late
                                  </span>
                                  <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                                    Owner {currencyFormatter.format(lateFee.ownerShare)} / Admin {currencyFormatter.format(lateFee.adminShare)}
                                  </span>
                                </div>
                              ) : (
                                <span style={{ color: theme.colors.slate }}>None</span>
                              )}
                            </td>
                            <td style={bodyCellStyle}>
                              <Badge tone={bookingStatusTone(booking.status)}>{formatListingStatusLabel(booking.status)}</Badge>
                            </td>
                            <td style={bodyCellStyle}>
                              {canMarkDone ? (
                                <Button
                                  className="booking-action-button"
                                  disabled={bookingActionBusyId === booking.id}
                                  onClick={() => handleMarkReturned(booking)}
                                  type="button"
                                  variant="secondary"
                                >
                                  {bookingActionBusyId === booking.id ? 'Saving...' : 'Mark done'}
                                </Button>
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
              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Damage balances to settle</strong>
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
                      {payableDamageBookings.map((booking, index) => {
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

              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Completed transactions eligible for damage report</strong>
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
                        {completedOwnerBookings.map((booking, index) => {
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
                                {booking.damageClaim ? (
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
              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Purchase requests for your sale listings</strong>
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
                      {sellerPurchaseRequests.map((request, index) => (
                        <tr className="booking-row" key={`seller-purchase-${request.id}`} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                          <td style={bodyCellStyle}>{request.item?.title || 'Unknown item'}</td>
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

              <strong className="booking-section-title" style={{ color: theme.colors.ink, fontSize: 16 }}>Your purchase requests to other sellers</strong>
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
                      {buyerPurchaseRequests.map((request, index) => {
                        const busyKey = `purchase:${request.id}`;
                        const normalizedStatus = String(request.status || '').toLowerCase();
                        const canPay = ['awaiting_payment', 'approved'].includes(normalizedStatus);
                        const canMarkClaimed = ['paid', 'ready_for_pickup'].includes(normalizedStatus);

                        return (
                          <tr className="booking-row" key={`buyer-purchase-${request.id}`} style={{ background: index % 2 === 0 ? alpha(theme.colors.panel, 0.56) : 'transparent' }}>
                            <td style={bodyCellStyle}>{request.item?.title || 'Unknown item'}</td>
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
            {!canCreateListing ? (
              <StatusMessage tone="warning">
                {readinessIssues.map((issue) => issue).join(' ')}
              </StatusMessage>
            ) : null}

            <section className="inventory-layout">
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

            {loading ? <StatusMessage tone="info">Loading your product listings.</StatusMessage> : null}
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
            padding: 16,
            pointerEvents: 'none',
            position: 'fixed',
            zIndex: 70,
          }}
        >
          <div
            className="glass-panel"
            onClick={(event) => event.stopPropagation()}
            style={{
              borderRadius: 16,
              boxSizing: 'border-box',
              display: 'grid',
              gap: 10,
              maxWidth: 420,
              minWidth: 280,
              padding: 14,
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
                  fontSize: 22,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                }}
              >
                Notice
              </strong>
              <Button onClick={() => setMessage('')} type="button" variant="ghost">
                Close
              </Button>
            </div>
            <StatusMessage tone={messageTone}>{message}</StatusMessage>
          </div>
        </div>
      ) : null}

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
          {loadingListingDetails ? <StatusMessage tone="info">Loading the selected product details.</StatusMessage> : null}

          <div className="listing-form-section" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Product Info</div>
            <div className="listing-product-info-layout">
              <div className="listing-product-info-left">
                <FormField label="Product title">
                  <Input name="title" onChange={handleFormChange} value={listingForm.title} />
                </FormField>

                <FormField label="Category / classification">
                  <select name="category_id" onChange={handleFormChange} style={selectStyle} value={listingForm.category_id}>
                    <option value="">Select a main category</option>
                    {activeMainCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </FormField>

                <FormField
                  hint={listingForm.category_id ? 'Choose one or more subcategories under the selected main category.' : 'Select a main category first.'}
                  label="Subcategories (optional)"
                >
                  {availableSubcategories.length ? (
                    <div className="listing-choice-box" style={{ border: `1px solid ${alpha(theme.colors.ink, 0.1)}`, borderRadius: 16, display: 'grid', gap: 8, maxHeight: 180, overflowY: 'auto', padding: 12 }}>
                      {availableSubcategories.map((subcategory) => {
                        const isChecked = (listingForm.subcategory_ids || []).includes(subcategory.id);
                        return (
                          <label key={subcategory.id} style={{ alignItems: 'center', color: theme.colors.ink, display: 'flex', gap: 8 }}>
                            <input
                              checked={isChecked}
                              onChange={(event) => handleSubcategoryToggle(subcategory.id, event.target.checked)}
                              type="checkbox"
                            />
                            <span>{subcategory.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="listing-choice-box" style={{ border: `1px solid ${alpha(theme.colors.ink, 0.1)}`, borderRadius: 16, color: theme.colors.slate, fontSize: 14, minHeight: 52, padding: '14px 16px' }}>
                      {listingForm.category_id ? 'No active subcategories under this main category.' : 'No main category selected yet.'}
                    </div>
                  )}
                </FormField>

                <FormField hint="Choose one of the valid item conditions from your database enum." label="Item condition">
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

              <div className="listing-product-info-right">
                <FormField label="Product details">
                  <Textarea name="description" onChange={handleFormChange} value={listingForm.description} />
                </FormField>
              </div>
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
            <FormField label="Rental price per day">
              <Input min="0" name="rental_price_per_day" onChange={handleFormChange} step="0.01" type="number" value={listingForm.rental_price_per_day} />
            </FormField>

            <FormField label="Security deposit">
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
                <FormField label="Sale price">
                  <Input min="0" name="sale_price" onChange={handleFormChange} step="0.01" type="number" value={listingForm.sale_price} />
                </FormField>

                <div style={{ gridColumn: '1 / -1' }}>
                  <FormField label="Sale inclusions">
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
            <FormField label="Quantity">
              <Input min="1" name="quantity" onChange={handleFormChange} step="1" type="number" value={listingForm.quantity} />
            </FormField>

            <FormField label="Minimum rental days">
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
            />
          </div>

          <div className="listing-form-section" style={{ gridColumn: '1 / -1' }}>
            <div className="listing-form-section-title">Additional Details</div>
            <FormField label="Meetup notes">
              <Textarea name="meetup_notes" onChange={handleFormChange} value={listingForm.meetup_notes} />
            </FormField>
            <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 14 }}>
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <strong style={{ color: theme.colors.ink, fontSize: 15 }}>Optional add-ons</strong>
                <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.55 }}>
                  Add extra services or accessories such as equipment sets, delivery, cleaning, or consumables with their own rental pricing.
                </span>
              </div>
              <Button onClick={addAddonRow} type="button" variant="secondary">
                Add add-on
              </Button>
            </div>

            {listingAddons.length ? (
              <div style={{ display: 'grid', gap: 14 }}>
                {listingAddons.map((addon, index) => (
                  <div
                    key={`addon-${index}`}
                    style={{
                      border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                      display: 'grid',
                      gap: 14,
                      padding: 16,
                    }}
                  >
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <strong style={{ color: theme.colors.ink, fontSize: 15 }}>Add-on {index + 1}</strong>
                      <Button onClick={() => removeAddonRow(index)} type="button" variant="ghost">
                        Remove
                      </Button>
                    </div>

                    <div className="form-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                      <FormField label="Add-on name">
                        <Input onChange={(event) => handleAddonChange(index, 'addon_name', event.target.value)} value={addon.addon_name} />
                      </FormField>

                      <FormField label="Pricing type">
                        <select
                          onChange={(event) => handleAddonChange(index, 'pricing_type', event.target.value)}
                          style={selectStyle}
                          value={addon.pricing_type}
                        >
                          {addonPricingOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>

                    <div className="form-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                      <FormField label="Add-on price">
                        <Input min="0" onChange={(event) => handleAddonChange(index, 'price', event.target.value)} step="0.01" type="number" value={addon.price} />
                      </FormField>

                      <label
                        style={{
                          alignItems: 'center',
                          color: theme.colors.ink,
                          display: 'inline-flex',
                          fontSize: 14,
                          fontWeight: 600,
                          gap: 10,
                          marginTop: 34,
                        }}
                      >
                        <input
                          checked={addon.is_required}
                          onChange={(event) => handleAddonChange(index, 'is_required', event.target.checked)}
                          type="checkbox"
                        />
                        Required add-on
                      </label>
                    </div>

                    <FormField label="Add-on description">
                      <Textarea onChange={(event) => handleAddonChange(index, 'description', event.target.value)} value={addon.description} />
                    </FormField>

                    <div style={{ display: 'grid', gap: 10 }}>
                      <FormField label="Add-on image">
                        <input
                          accept="image/*"
                          onChange={(event) => handleAddonImageChange(index, event.target.files?.[0] || null)}
                          type="file"
                        />
                      </FormField>

                      {addon.imagePreview || addon.image_url ? (
                        <div
                          style={{
                            alignItems: 'start',
                            display: 'grid',
                            gap: 10,
                            gridTemplateColumns: '132px minmax(0, 1fr)',
                          }}
                        >
                          <div
                            style={{
                              background: alpha(theme.colors.panel, 0.92),
                              border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                              height: 132,
                              overflow: 'hidden',
                              width: 132,
                            }}
                          >
                            <img
                              alt={addon.addon_name || `Add-on ${index + 1}`}
                              src={addon.imagePreview || addon.image_url}
                              style={{
                                display: 'block',
                                height: '100%',
                                objectFit: 'cover',
                                width: '100%',
                              }}
                            />
                          </div>

                          <div style={{ display: 'grid', gap: 8 }}>
                            <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.55 }}>
                              {addon.imagePreview ? 'Selected add-on image preview.' : 'Current saved add-on image.'}
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {addon.image_url && !addon.imagePreview ? <Badge tone="info">Saved image</Badge> : null}
                              {addon.imagePreview ? <Badge tone="success">New image</Badge> : null}
                              <Button onClick={() => handleAddonImageChange(index, null)} type="button" variant="ghost">
                                Remove image
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
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
            <Button onClick={closeBookingDetail} variant="ghost">
              Close
            </Button>
            {bookingDetail &&
            bookingDetail.borrower_id === userId &&
            bookingDetail.damageClaim &&
            ['pending_admin_review', 'approved', 'awaiting_payment'].includes(String(bookingDetail.damageClaim.status || '').toLowerCase()) ? (
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
        title={bookingDetail?.item?.title ? `Booking details: ${bookingDetail.item.title}` : 'Booking details'}
      >
        {bookingDetail ? (
          <div className="booking-detail-modal-layout">
            <StatusMessage tone="info">
              {bookingDetail.owner_id === userId && String(bookingDetail.status || '').toLowerCase() === 'pending'
                ? 'Review booking details and selected add-ons before approval.'
                : 'Review the rented item, schedule, fees, and selected add-ons for this booking.'}
            </StatusMessage>

                {bookingDetail.damageClaim &&
            ['pending_admin_review', 'approved', 'awaiting_payment'].includes(String(bookingDetail.damageClaim.status || '').toLowerCase()) ? (
              <StatusMessage tone="warning">
                This booking has a pending damage balance of{' '}
                {currencyFormatter.format(
                  Number(bookingDetail.damageClaim.amount_due) || Number(bookingDetail.damageClaim.claimed_amount) || 0
                )}
                . Current claim status: {formatListingStatusLabel(bookingDetail.damageClaim.status)}.
              </StatusMessage>
            ) : null}

            {bookingDetail.damageClaim ? (
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
                  <StatusMessage tone="info">Loading damage evidence.</StatusMessage>
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
              {bookingDetailLateFee.total > 0 && APPROVAL_STATUS_CANDIDATES.includes(String(bookingDetail.status || '').toLowerCase()) ? (
                <div
                  style={{
                    background: alpha(theme.colors.danger, 0.08),
                    border: `1px solid ${alpha(theme.colors.danger, 0.18)}`,
                    display: 'grid',
                    gap: 4,
                    padding: 10,
                  }}
                >
                  <strong style={{ color: theme.colors.danger }}>
                    Late fee: {currencyFormatter.format(bookingDetailLateFee.total)} ({bookingDetailLateFee.daysLate} day
                    {bookingDetailLateFee.daysLate === 1 ? '' : 's'} overdue)
                  </strong>
                  <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                    Owner share 70%: {currencyFormatter.format(bookingDetailLateFee.ownerShare)}
                  </span>
                  <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                    Admin share 30%: {currencyFormatter.format(bookingDetailLateFee.adminShare)}
                  </span>
                </div>
              ) : null}
              <div className="booking-detail-total-row">
                <span>Total due</span>
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
          <Button onClick={closeDamageClaimDetail} variant="ghost">
            Close
          </Button>
        }
        size="compact"
        onClose={closeDamageClaimDetail}
        open={Boolean(damageClaimDetailBooking)}
        title={damageClaimDetailBooking?.item?.title ? `Damage report: ${damageClaimDetailBooking.item.title}` : 'Damage report'}
      >
        {damageClaimDetailLoading ? (
          <StatusMessage tone="info">Loading damage report details.</StatusMessage>
        ) : damageClaimDetailBooking?.damageClaim ? (
          <div className="booking-detail-modal-layout">
            <StatusMessage tone="info">A damage report has already been submitted for this booking.</StatusMessage>
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
              Cancel
            </Button>
            <Button className="booking-action-button" disabled={savingDamageReport} form="damage-report-form" type="submit" variant="danger">
              {savingDamageReport ? 'Submitting...' : 'Submit damage report'}
            </Button>
          </>
        }
        onClose={closeDamageReport}
        open={Boolean(damageReportBooking)}
        title={damageReportBooking?.item?.title ? `Report damage: ${damageReportBooking.item.title}` : 'Report damage'}
      >
        {damageReportBooking ? (
          <form id="damage-report-form" onSubmit={handleSubmitDamageReport} style={{ display: 'grid', gap: 14 }}>
            <StatusMessage tone="info">
              Upload photo evidence first. The borrower can still log in and is only restricted after an admin approves the damage claim.
            </StatusMessage>

            <FormField label="Estimated damage/replacement amount">
              <Input
                min="0"
                readOnly
                step="0.01"
                type="number"
                value={Number(damageReportBooking?.item?.estimated_value || 0)}
              />
              <p style={{ color: theme.colors.slate, fontSize: 13, margin: '8px 0 0' }}>
                This amount is based on the item's estimated value and will still be reviewed by the admin.
              </p>
            </FormField>

            <FormField label="Damage description">
              <Textarea
                onChange={(event) => setDamageReportForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Describe the visible damage, affected parts, and any return condition details."
                style={{ minHeight: 120 }}
                value={damageReportForm.description}
              />
            </FormField>

            <FormField label="Photo evidence">
              <input
                accept="image/*"
                multiple
                onChange={(event) => setDamageReportForm((current) => ({ ...current, files: Array.from(event.target.files || []) }))}
                type="file"
              />
              <p style={{ color: theme.colors.slate, fontSize: 13, margin: '8px 0 0' }}>
                Files are only uploaded after you click Submit damage report.
              </p>
            </FormField>

            {damageReportForm.files.length ? (
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                {damageReportForm.files.map((file) => (
                  <div
                    key={`${file.name}-${file.lastModified}`}
                    style={{
                      border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                      color: theme.colors.slate,
                      fontSize: 12,
                      overflowWrap: 'break-word',
                      padding: 10,
                    }}
                  >
                    {file.name}
                  </div>
                ))}
              </div>
            ) : null}
          </form>
        ) : null}
      </Modal>

      <Modal
        actions={
          <>
            <Button onClick={closeReviewModal} variant="ghost">
              Cancel
            </Button>
            <Button className="booking-action-button" disabled={savingReview} form="booking-review-form" type="submit">
              {savingReview ? 'Submitting...' : 'Submit review'}
            </Button>
          </>
        }
        onClose={closeReviewModal}
        open={showReviewModal}
        title={reviewBooking?.item?.title ? `Review ${reviewBooking.item.title}` : 'Submit review'}
      >
        <form id="booking-review-form" onSubmit={handleSubmitReview} style={{ display: 'grid', gap: 14 }}>
          <StatusMessage tone="info">
            Once the item is returned, please submit your review so other borrowers can see your rental experience.
          </StatusMessage>

          <FormField label="Rating">
            <div
              className="review-stars-wrap"
              style={{
                alignItems: 'center',
                background: alpha(theme.colors.panel, 0.92),
                border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                borderRadius: 16,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                minHeight: 64,
                padding: '10px 12px',
              }}
            >
              {[1, 2, 3, 4, 5].map((star) => {
                const isActive = star <= reviewRating;

                return (
                  <button
                    aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                    className="review-star-button"
                    key={star}
                    onClick={() => setReviewForm((current) => ({ ...current, rating: String(star) }))}
                    style={{
                      alignItems: 'center',
                      background: 'transparent',
                      border: `1px solid ${alpha(isActive ? theme.colors.coral : theme.colors.ink, isActive ? 0.24 : 0.08)}`,
                      borderRadius: 12,
                      color: isActive ? theme.colors.coral : theme.colors.slate,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      justifyContent: 'center',
                      minHeight: 42,
                      minWidth: 42,
                      transition: 'all 0.2s ease',
                    }}
                    type="button"
                  >
                    <StarIcon size={18} />
                  </button>
                );
              })}
              <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600, marginLeft: 6 }}>
                {reviewRating}/5 - {ratingLabel(reviewRating)}
              </span>
            </div>
          </FormField>

          <FormField label="Review notes (optional)">
            <Textarea
              name="review_text"
              onChange={(event) => setReviewForm((current) => ({ ...current, review_text: event.target.value }))}
              value={reviewForm.review_text}
            />
          </FormField>
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
