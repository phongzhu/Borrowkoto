import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { supabase } from '../../api/supabaseClient';
import { createTestCheckoutSession } from '../../services/transaction';
import { BookmarkIcon, CalendarIcon, MessageIcon, ShieldIcon, StarIcon } from '../../ui/icons';
import { Button, Modal, StarRating, StatusMessage, Textarea } from '../../ui/primitives';
import { buildMapEmbedUrl } from '../../ui/profileFormUtils';
import { alpha } from '../../ui/theme';
import { RENTABLE_ITEM_STATUSES } from '../../utils/bookingEnums';
import { useUISettings } from '../../context/UISettingsContext';
import UserShell from './UserShell';
import './rent-item-datepicker.css';
import './view-item-list.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const itemSelectFields =
  'id, owner_id, category_id, title, description, item_condition, rental_price_per_day, security_deposit, estimated_value, is_for_sale, sale_price, sale_inclusions, min_rental_days, max_rental_days, quantity, pickup_street, pickup_region, pickup_barangay, pickup_city, pickup_province, pickup_country, pickup_latitude, pickup_longitude, meetup_notes, status, is_active, created_at, updated_at';
const SLOT_INTERVAL_MINUTES = 30;
const BLOCKING_BOOKING_STATUSES = new Set(['pending', 'accepted', 'for_pickup', 'active', 'return_pending', 'overdue', 'disputed']);
const TAGS_META_PREFIX = '[TAGS]::';
const BALIUAG_BARANGAYS = ['Adias', 'Bagong Nayon', 'Balon', 'Banag', 'Barihan', 'Calantipay', 'Catulinan', 'Concepcion', 'Hinukay', 'Makinabang', 'Matangtubig', 'Pagala', 'Paitan', 'Piel', 'Pinagbarilan', 'Poblacion', 'Sabang', 'San Jose', 'San Roque', 'Santa Barbara', 'Santo Cristo', 'Santo Nino', 'Subic', 'Sulivan', 'Tangos', 'Tarcan', 'Tiaong', 'Tibag', 'Tilapayong', 'Virgen delas Flores'];

function buildPersonName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function buildPersonInitials(profile) {
  const parts = [profile?.first_name, profile?.last_name].filter(Boolean);

  if (!parts.length) {
    return 'CM';
  }

  return parts
    .map((part) => String(part).trim().charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

function buildItemLocation(item) {
  return [item?.pickup_street, item?.pickup_barangay, item?.pickup_city, item?.pickup_province, item?.pickup_region, item?.pickup_country]
    .filter(Boolean)
    .join(', ');
}

function buildProfileLocation(profile) {
  return [profile?.street, profile?.barangay, profile?.city, profile?.province, profile?.region, profile?.country].filter(Boolean).join(', ');
}

function PublicBrandMark({ brandName, logoUrl }) {
  return logoUrl ? <img alt={brandName} src={logoUrl} /> : <span>{brandName.slice(0, 2).toUpperCase()}</span>;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function formatDateTimeLocalValue(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseLocalDateTimeValue(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildBookedRange(booking) {
  const start = parseLocalDateTimeValue(booking.approved_start || booking.requested_start);
  const endCandidate = parseLocalDateTimeValue(booking.approved_end || booking.requested_end || booking.approved_start || booking.requested_start);

  if (!start || !endCandidate) {
    return null;
  }

  const end = endCandidate > start ? endCandidate : addDays(start, 1);
  return { end, start };
}

function hasOverlap(start, end, ranges) {
  if (!start || !end || end <= start) {
    return false;
  }

  return ranges.some((range) => start < range.end && end > range.start);
}

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

function clampDesiredQuantity(value, availableQuantity) {
  const parsed = Number(value);
  const safeAvailable = Math.max(1, Number(availableQuantity) || 1);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return Math.min(safeAvailable, Math.round(parsed));
}

function parseColorForContrast(color) {
  if (!color) {
    return null;
  }

  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const normalizedHex =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => char + char)
            .join('')
        : hex;

    return {
      blue: Number.parseInt(normalizedHex.slice(4, 6), 16),
      green: Number.parseInt(normalizedHex.slice(2, 4), 16),
      red: Number.parseInt(normalizedHex.slice(0, 2), 16),
    };
  }

  if (color.startsWith('rgb')) {
    const channels = color.match(/\d+/g);

    if (!channels || channels.length < 3) {
      return null;
    }

    return {
      blue: Number.parseInt(channels[2], 10),
      green: Number.parseInt(channels[1], 10),
      red: Number.parseInt(channels[0], 10),
    };
  }

  return null;
}

function getContrastTextForButton(color, light = '#ffffff', dark = '#0f172a') {
  const rgb = parseColorForContrast(color);

  if (!rgb) {
    return light;
  }

  const luminance = (0.299 * rgb.red + 0.587 * rgb.green + 0.114 * rgb.blue) / 255;
  return luminance > 0.62 ? dark : light;
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

function canRentItem(item, currentUserId) {
  const reasons = [];

  if (!item) {
    reasons.push('Item details are still loading.');
    return { allowed: false, reasons };
  }

  if (!currentUserId) {
    reasons.push('Sign in to rent this item.');
  }

  if (currentUserId && item.owner_id === currentUserId) {
    reasons.push('You cannot rent your own listing.');
  }

  if (!item.is_active) {
    reasons.push('This listing is currently inactive.');
  }

  const normalizedStatus = String(item.status || '').toLowerCase();

  if (!RENTABLE_ITEM_STATUSES.has(normalizedStatus)) {
    reasons.push('This listing is not currently open for rental.');
  }

  if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 1) {
    reasons.push('Listing quantity is not available for booking.');
  }

  if (!Number.isFinite(Number(item.rental_price_per_day)) || Number(item.rental_price_per_day) < 0) {
    reasons.push('Listing rental price is invalid.');
  }

  if (!Number.isFinite(Number(item.security_deposit)) || Number(item.security_deposit) < 0) {
    reasons.push('Listing security deposit is invalid.');
  }

  const minDays = Number(item.min_rental_days || 1);
  const maxDays = item.max_rental_days === null || item.max_rental_days === undefined ? null : Number(item.max_rental_days);

  if (!Number.isInteger(minDays) || minDays < 1) {
    reasons.push('Listing minimum rental days is invalid.');
  }

  if (maxDays !== null && (!Number.isInteger(maxDays) || maxDays < minDays)) {
    reasons.push('Listing maximum rental days is invalid.');
  }

  return {
    allowed: reasons.length === 0,
    reasons,
  };
}

function formatAddonPricingLabel(value) {
  const normalized = String(value || '').toLowerCase();

  if (!normalized) {
    return 'Per rental';
  }

  return normalized
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatReviewDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function DetailIcon({ type, size = 18 }) {
  const common = {
    'aria-hidden': 'true',
    fill: 'none',
    height: size,
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
    width: size,
  };

  if (type === 'heart') {
    return (
      <svg {...common}>
        <path d="M20.8 5.8a5 5 0 0 0-7.1 0L12 7.5l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21l8.8-8.1a5 5 0 0 0 0-7.1Z" />
      </svg>
    );
  }

  if (type === 'share') {
    return (
      <svg {...common}>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.6 6.8-4.2M8.6 13.4l6.8 4.2" />
      </svg>
    );
  }

  if (type === 'pin') {
    return (
      <svg {...common}>
        <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    );
  }

  if (type === 'category') {
    return (
      <svg {...common}>
        <path d="M4 12h6v8H4zM14 4h6v6h-6zM14 14h6v6h-6zM4 4h6v4H4z" />
      </svg>
    );
  }

  if (type === 'material') {
    return (
      <svg {...common}>
        <path d="M4 18 18 4M9 20l11-11M4 13l9-9" />
      </svg>
    );
  }

  if (type === 'dimensions') {
    return (
      <svg {...common}>
        <path d="M4 7h16v10H4z" />
        <path d="M8 7v4M12 7v2M16 7v4" />
      </svg>
    );
  }

  if (type === 'shipping') {
    return (
      <svg {...common}>
        <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" />
        <circle cx="7" cy="18" r="1.5" />
        <circle cx="17" cy="18" r="1.5" />
      </svg>
    );
  }

  if (type === 'bell') {
    return (
      <svg {...common}>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 6h16v10H8l-4 4V6Z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}

function BorrowKoToItemLoader() {
  return (
    <section aria-live="polite" aria-label="Loading item details" className="borrow-item-loader" role="status">
      <div className="borrow-item-loader-scene" aria-hidden="true">
        <span className="borrow-item-loader-orbit orbit-one" />
        <span className="borrow-item-loader-orbit orbit-two" />
        <svg className="borrow-item-loader-hand hand-left" viewBox="0 0 170 105">
          <path d="M9 59h28l22-18c7-6 17-7 25-2l13 8h38c14 0 23 14 16 26-3 6-10 9-17 9H82l-21 15H22Z" />
          <path d="m42 59 20 22M82 62h48" />
        </svg>
        <div className="borrow-item-loader-box">
          <svg viewBox="0 0 92 92">
            <path d="M12 28 46 10l34 18-34 18Z" />
            <path d="M12 28v39l34 17V46M80 28v39L46 84" />
            <path d="m29 19 34 18v18" />
          </svg>
        </div>
        <svg className="borrow-item-loader-hand hand-right" viewBox="0 0 170 105">
          <path d="M9 59h28l22-18c7-6 17-7 25-2l13 8h38c14 0 23 14 16 26-3 6-10 9-17 9H82l-21 15H22Z" />
          <path d="m42 59 20 22M82 62h48" />
        </svg>
      </div>
    </section>
  );
}

export default function ViewItemList({ publicMode = false }) {
  const navigate = useNavigate();
  const { itemId } = useParams();
  const { settings } = useUISettings();
  const [item, setItem] = useState(null);
  const [itemAddons, setItemAddons] = useState([]);
  const [ownerOtherItems, setOwnerOtherItems] = useState([]);
  const [sameCategoryItems, setSameCategoryItems] = useState([]);
  const [ownerReviews, setOwnerReviews] = useState([]);
  const [bookedRanges, setBookedRanges] = useState([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imageQuickView, setImageQuickView] = useState({ active: false, xPercent: 50, yPercent: 50 });
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [viewerZoom, setViewerZoom] = useState({ active: false, xPercent: 50, yPercent: 50 });
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatFeedback, setChatFeedback] = useState('');
  const [chatFeedbackTone, setChatFeedbackTone] = useState('info');
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [ownerProfileOpen, setOwnerProfileOpen] = useState(false);
  const [selectedStart, setSelectedStart] = useState('');
  const [selectedEnd, setSelectedEnd] = useState('');
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [buyRequestSaving, setBuyRequestSaving] = useState(false);
  const [buyRequestFeedback, setBuyRequestFeedback] = useState('');
  const [savedRentItem, setSavedRentItem] = useState(null);
  const [desiredQuantity, setDesiredQuantity] = useState(1);
  const [saveRentLoading, setSaveRentLoading] = useState(false);
  const [saveRentFeedback, setSaveRentFeedback] = useState('');
  const [saveRentFeedbackTone, setSaveRentFeedbackTone] = useState('info');
  const [headerSearch, setHeaderSearch] = useState('');
  const [headerBarangay, setHeaderBarangay] = useState('all');
  const [mobileInfoTab, setMobileInfoTab] = useState('details');
  const [buyRequestForm, setBuyRequestForm] = useState({
    buyer_message: '',
    buyer_preferred_pickup_at: '',
    quantity: '1',
  });
  const heroImageRef = useRef(null);
  const viewerImageCount = item?.images?.length || 0;

  function updateViewerZoom(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const xPercent = ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 100;
    const yPercent = ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 100;
    setViewerZoom({
      active: true,
      xPercent: Math.min(100, Math.max(0, xPercent)),
      yPercent: Math.min(100, Math.max(0, yPercent)),
    });
  }

  function resetViewerZoom() {
    setViewerZoom({ active: false, xPercent: 50, yPercent: 50 });
  }

  useEffect(() => {
    setViewerZoom({ active: false, xPercent: 50, yPercent: 50 });
  }, [activeImageIndex, imageViewerOpen]);

  useEffect(() => {
    if (!imageViewerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setImageViewerOpen(false);
      if (event.key === 'ArrowLeft') setActiveImageIndex((current) => (current - 1 + Math.max(viewerImageCount, 1)) % Math.max(viewerImageCount, 1));
      if (event.key === 'ArrowRight') setActiveImageIndex((current) => (current + 1) % Math.max(viewerImageCount, 1));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [imageViewerOpen, viewerImageCount]);

  useEffect(() => {
    let mounted = true;

    async function loadItem() {
      setLoading(true);
      setError('');
      setChatFeedback('');

      const [{ data: authData }, itemResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from('items')
          .select(itemSelectFields)
          .eq('id', itemId)
          .maybeSingle(),
      ]);

      if (!mounted) {
        return;
      }

      setCurrentUserId(authData?.user?.id || null);

      if (itemResult.error) {
        setError(`Unable to load this item: ${itemResult.error.message}`);
        setLoading(false);
        return;
      }

      const itemRow = itemResult.data;

      if (!itemRow) {
        setError('This item could not be found.');
        setLoading(false);
        return;
      }

      const currentUserId = authData?.user?.id || null;
      if (currentUserId) {
        const { data: viewerProfile } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, username, profile_photo_url')
          .eq('id', currentUserId)
          .maybeSingle();
        if (mounted) setCurrentUserProfile(viewerProfile || null);
      } else {
        setCurrentUserProfile(null);
      }
      if (currentUserId) {
        const { error: recordViewError } = await supabase.rpc('record_item_view', {
          p_item_id: itemRow.id,
        });

        if (recordViewError) {
          console.warn('record_item_view failed:', recordViewError.message);
        }
      }

      const [categoryResult, ownerResult, imagesResult, addonsResult, reviewsResult, ownerOtherItemsResult, sameCategoryItemsResult, bookingsResult, savedRentItemResult] =
        await Promise.all([
        supabase.from('categories').select('id, name').eq('id', itemRow.category_id).maybeSingle(),
        supabase
          .from('profiles')
          .select(
            'id, first_name, middle_name, last_name, suffix, username, phone_number, profile_photo_url, street, region, barangay, city, province, country, average_rating, total_reviews, is_verified, verification_status, created_at'
          )
          .eq('id', itemRow.owner_id)
          .maybeSingle(),
        supabase
          .from('item_images')
          .select('id, item_id, image_url, is_primary, sort_order')
          .eq('item_id', itemRow.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('item_addons')
          .select('id, addon_name, description, price, pricing_type, is_required, image_url, is_active, sort_order')
          .eq('item_id', itemRow.id)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('reviews')
          .select('id, booking_id, reviewer_id, reviewer_role, rating, review_text, created_at')
          .eq('reviewee_id', itemRow.owner_id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('items')
          .select(itemSelectFields)
          .eq('owner_id', itemRow.owner_id)
          .eq('is_active', true)
          .neq('id', itemRow.id)
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('items')
          .select(itemSelectFields)
          .eq('category_id', itemRow.category_id)
          .eq('is_active', true)
          .neq('owner_id', itemRow.owner_id)
          .neq('id', itemRow.id)
          .order('created_at', { ascending: false })
          .limit(12),
        supabase
          .from('bookings')
          .select('id, requested_start, requested_end, approved_start, approved_end, status')
          .eq('item_id', itemRow.id)
          .in('status', Array.from(BLOCKING_BOOKING_STATUSES)),
        currentUserId
          ? supabase
              .from('saved_rent_items')
              .select('id, desired_quantity, note, created_at, updated_at')
              .eq('user_id', currentUserId)
              .eq('item_id', itemRow.id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (!mounted) {
        return;
      }

      const reviewerIds = Array.from(new Set((reviewsResult.data || []).map((review) => review.reviewer_id).filter(Boolean)));
      const reviewerProfilesResult = reviewerIds.length
        ? await supabase
            .from('profiles')
            .select('id, first_name, middle_name, last_name, suffix, username, profile_photo_url')
            .in('id', reviewerIds)
        : { data: [], error: null };

      if (!mounted) {
        return;
      }

      const nextErrors = [];

      if (categoryResult.error) {
        nextErrors.push(`category: ${categoryResult.error.message}`);
      }

      if (ownerResult.error) {
        nextErrors.push(`owner: ${ownerResult.error.message}`);
      }

      if (imagesResult.error) {
        nextErrors.push(`images: ${imagesResult.error.message}`);
      }

      if (addonsResult.error) {
        nextErrors.push(`add-ons: ${addonsResult.error.message}`);
      }

      if (reviewsResult.error) {
        nextErrors.push(`reviews: ${reviewsResult.error.message}`);
      }

      if (ownerOtherItemsResult.error) {
        nextErrors.push(`owner listings: ${ownerOtherItemsResult.error.message}`);
      }

      if (sameCategoryItemsResult.error) {
        nextErrors.push(`same-category listings: ${sameCategoryItemsResult.error.message}`);
      }

      if (bookingsResult.error) {
        nextErrors.push(`bookings: ${bookingsResult.error.message}`);
      }

      const savedRentMissingTable = savedRentItemResult.error && /does not exist|relation/i.test(String(savedRentItemResult.error.message || ''));
      if (savedRentItemResult.error && !savedRentMissingTable) {
        nextErrors.push(`saved listing: ${savedRentItemResult.error.message}`);
      }

      if (reviewerProfilesResult.error) {
        nextErrors.push(`reviewers: ${reviewerProfilesResult.error.message}`);
      }

      const images = (imagesResult.data || [])
        .slice()
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);
      const reviewerMap = new Map((reviewerProfilesResult.data || []).map((profile) => [profile.id, profile]));
      const rawOwnerOtherItems = ownerOtherItemsResult.data || [];
      const rawSameCategoryItems = sameCategoryItemsResult.data || [];
      const relatedRawItems = [...rawOwnerOtherItems, ...rawSameCategoryItems];
      const relatedOwnerIds = Array.from(new Set(relatedRawItems.map((relatedItem) => relatedItem.owner_id).filter(Boolean)));
      const relatedItemIds = relatedRawItems.map((relatedItem) => relatedItem.id);

      const [relatedOwnersResult, relatedImagesResult] = await Promise.all([
        relatedOwnerIds.length
          ? supabase
              .from('profiles')
              .select(
                'id, first_name, middle_name, last_name, suffix, username, phone_number, profile_photo_url, street, region, barangay, city, province, country, average_rating, total_reviews, is_verified, verification_status, created_at'
              )
              .in('id', relatedOwnerIds)
          : Promise.resolve({ data: [], error: null }),
        relatedItemIds.length
          ? supabase
              .from('item_images')
              .select('id, item_id, image_url, is_primary, sort_order')
              .in('item_id', relatedItemIds)
              .order('sort_order', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!mounted) {
        return;
      }

      if (relatedOwnersResult.error) {
        nextErrors.push(`related owners: ${relatedOwnersResult.error.message}`);
      }

      if (relatedImagesResult.error) {
        nextErrors.push(`related images: ${relatedImagesResult.error.message}`);
      }

      const relatedOwnerMap = new Map((relatedOwnersResult.data || []).map((profile) => [profile.id, profile]));
      const relatedImagesByItemId = new Map();

      (relatedImagesResult.data || []).forEach((image) => {
        const current = relatedImagesByItemId.get(image.item_id) || [];
        current.push(image);
        relatedImagesByItemId.set(image.item_id, current);
      });

      const parsedMeetupMeta = parseEmbeddedTags(itemRow.meetup_notes);
      const nextItem = {
        ...itemRow,
        category: categoryResult.data || null,
        meetup_notes: parsedMeetupMeta.notes,
        search_tags: parsedMeetupMeta.tags,
        owner: ownerResult.data || null,
        images,
        primaryImage: images[0] || null,
      };

      const nextReviews = (reviewsResult.data || []).map((review) => ({
        ...review,
        reviewer: reviewerMap.get(review.reviewer_id) || null,
      }));
      const nextBookedRanges = (bookingsResult.data || [])
        .map((booking) => buildBookedRange(booking))
        .filter(Boolean)
        .sort((left, right) => left.start.getTime() - right.start.getTime());

      const mapRelatedItem = (relatedItem) => {
        const relatedImages = (relatedImagesByItemId.get(relatedItem.id) || [])
          .slice()
          .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);

        return {
          ...relatedItem,
          category: categoryResult.data || null,
          images: relatedImages,
          owner: relatedOwnerMap.get(relatedItem.owner_id) || (relatedItem.owner_id === itemRow.owner_id ? ownerResult.data || null : null),
          primaryImage: relatedImages[0] || null,
        };
      };

      setItem(nextItem);
      setItemAddons(addonsResult.data || []);
      setOwnerOtherItems(rawOwnerOtherItems.map(mapRelatedItem));
      setSameCategoryItems(rawSameCategoryItems.map(mapRelatedItem));
      setOwnerReviews(nextReviews);
      setBookedRanges(nextBookedRanges);
      setSavedRentItem(savedRentItemResult.data || null);
      setDesiredQuantity(clampDesiredQuantity(savedRentItemResult.data?.desired_quantity || 1, Number(itemRow.quantity) || 1));
      setSaveRentFeedback('');
      setActiveImageIndex(0);
      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadItem();

    return () => {
      mounted = false;
    };
  }, [itemId]);

  useEffect(() => {
    if (!item?.images?.length || item.images.length < 2) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setActiveImageIndex((current) => (current + 1) % item.images.length);
    }, 4200);

    return () => window.clearInterval(intervalId);
  }, [item?.images]);

  const ownerName = useMemo(() => buildPersonName(item?.owner) || 'Community member', [item]);
  const brandName = settings.system_name?.trim() || "Borrow Ko 'To";
  const logoUrl = settings.logo_url?.trim() || '';
  const primaryThemeColor = settings.primary_color?.trim() || '#185a72';
  const primaryThemeTextColor = getContrastTextForButton(primaryThemeColor);
  const secondaryThemeColor = settings.secondary_color?.trim() || '#f3a84f';
  const ownerInitials = useMemo(() => buildPersonInitials(item?.owner), [item]);
  const pickupLocation = useMemo(() => buildItemLocation(item), [item]);
  const ownerProfileLocation = useMemo(() => buildProfileLocation(item?.owner), [item]);
  const pickupMapUrl = useMemo(() => buildMapEmbedUrl(item?.pickup_latitude, item?.pickup_longitude), [item]);
  const canChat = Boolean(item && currentUserId && currentUserId !== item.owner_id);
  const rentEligibility = useMemo(() => canRentItem(item, currentUserId), [currentUserId, item]);
  const canBuyItem = useMemo(() => {
    if (!item) return false;
    if (!currentUserId) return false;
    if (item.owner_id === currentUserId) return false;
    if (!item.is_active) return false;
    if (!item.is_for_sale) return false;
    return Number.isFinite(Number(item.sale_price)) && Number(item.sale_price) >= 0;
  }, [currentUserId, item]);
  const minimumStartValue = useMemo(() => formatDateTimeLocalValue(new Date()), []);
  const now = useMemo(() => new Date(), []);
  const selectedStartDate = useMemo(() => parseLocalDateTimeValue(selectedStart), [selectedStart]);
  const hasSelectedSchedule = Boolean(selectedStartDate && parseLocalDateTimeValue(selectedEnd));
  const canProceedToRent = rentEligibility.allowed && hasSelectedSchedule;
  const minRentalDays = useMemo(() => Math.max(1, Number(item?.min_rental_days) || 1), [item?.min_rental_days]);
  const maxRentalDays = useMemo(() => {
    const rawMax = Number(item?.max_rental_days);
    if (Number.isFinite(rawMax) && rawMax >= minRentalDays) {
      return rawMax;
    }
    return minRentalDays;
  }, [item?.max_rental_days, minRentalDays]);
  const maximumEndValue = useMemo(() => {
    return selectedStartDate ? formatDateTimeLocalValue(addDays(selectedStartDate, maxRentalDays)) : '';
  }, [maxRentalDays, selectedStartDate]);
  const blockedDateIntervals = useMemo(
    () => bookedRanges.map((range) => ({ end: range.end, start: range.start })),
    [bookedRanges]
  );
  const startDatePickerMinDate = useMemo(() => new Date(minimumStartValue), [minimumStartValue]);
  const endDatePickerMinDate = useMemo(() => (selectedStartDate ? selectedStartDate : startDatePickerMinDate), [selectedStartDate, startDatePickerMinDate]);
  const endDatePickerMaxDate = useMemo(() => (maximumEndValue ? new Date(maximumEndValue) : null), [maximumEndValue]);
  const bookedDayClassName = useMemo(
    () => (day) => {
      const dayStart = startOfDay(day);
      const dayEnd = endOfDay(day);
      return bookedRanges.some((range) => dayStart < range.end && dayEnd > range.start) ? 'rent-datepicker-day-blocked' : undefined;
    },
    [bookedRanges]
  );

  const isStartDateTimeSelectable = useMemo(
    () => (candidateDate) => {
      if (!candidateDate || candidateDate < now) {
        return false;
      }
      return !hasOverlap(candidateDate, addDays(candidateDate, minRentalDays), bookedRanges);
    },
    [bookedRanges, minRentalDays, now]
  );

  const isEndDateTimeSelectable = useMemo(
    () => (candidateDate) => {
      if (!selectedStartDate || !candidateDate) {
        return false;
      }

      const minimumEnd = addDays(selectedStartDate, minRentalDays);
      const maximumEnd = addDays(selectedStartDate, maxRentalDays);

      if (candidateDate < minimumEnd || candidateDate > maximumEnd) {
        return false;
      }

      return !hasOverlap(selectedStartDate, candidateDate, bookedRanges);
    },
    [bookedRanges, maxRentalDays, minRentalDays, selectedStartDate]
  );

  useEffect(() => {
    if (!selectedStartDate || !selectedEnd) {
      return;
    }

    const currentEnd = parseLocalDateTimeValue(selectedEnd);
    if (!currentEnd) {
      return;
    }

    const minimumEnd = addDays(selectedStartDate, minRentalDays);
    const maximumEnd = addDays(selectedStartDate, maxRentalDays);

    if (currentEnd < minimumEnd || currentEnd > maximumEnd || hasOverlap(selectedStartDate, currentEnd, bookedRanges)) {
      setSelectedEnd(formatDateTimeLocalValue(minimumEnd));
    }
  }, [bookedRanges, maxRentalDays, minRentalDays, selectedEnd, selectedStartDate]);

  function openItemDetails(nextItem) {
    navigate(`/user/view-item-list/${nextItem.id}`);
  }

  function updateQuickViewFromMouse(event) {
    const container = heroImageRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const nextX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const nextY = Math.min(Math.max(event.clientY - rect.top, 0), rect.height);
    const xPercent = (nextX / rect.width) * 100;
    const yPercent = (nextY / rect.height) * 100;

    setImageQuickView({ active: true, xPercent, yPercent });
  }

  function handleQuickViewMouseEnter(event) {
    updateQuickViewFromMouse(event);
  }

  function handleQuickViewMouseMove(event) {
    updateQuickViewFromMouse(event);
  }

  function handleQuickViewMouseLeave() {
    setImageQuickView((current) => ({ ...current, active: false }));
  }

  function handleSelectedStartChange(nextStart) {
    const nextValue = formatDateTimeLocalValue(nextStart);
    setSelectedStart(nextValue);

    if (!nextStart) {
      setSelectedEnd('');
      return;
    }

    const nextMinimumEnd = addDays(nextStart, minRentalDays);
    const nextMaximumEnd = addDays(nextStart, maxRentalDays);
    const currentEnd = parseLocalDateTimeValue(selectedEnd);

    if (!currentEnd || currentEnd <= nextStart || currentEnd < nextMinimumEnd || currentEnd > nextMaximumEnd || hasOverlap(nextStart, currentEnd, bookedRanges)) {
      setSelectedEnd(formatDateTimeLocalValue(nextMinimumEnd));
    }
  }

  function handleSelectedEndChange(nextEnd) {
    const nextValue = formatDateTimeLocalValue(nextEnd);

    if (!selectedStartDate || !nextEnd) {
      setSelectedEnd(nextValue);
      return;
    }

    const minimumEnd = addDays(selectedStartDate, minRentalDays);
    const maximumEnd = addDays(selectedStartDate, maxRentalDays);

    if (nextEnd < minimumEnd || nextEnd > maximumEnd) {
      return;
    }

    if (hasOverlap(selectedStartDate, nextEnd, bookedRanges)) {
      return;
    }

    setSelectedEnd(nextValue);
  }

  function handleOpenRentItem() {
    if (!item) {
      return;
    }

    if (!currentUserId) {
      navigate('/login');
      return;
    }

    if (!rentEligibility.allowed) {
      setChatFeedback(rentEligibility.reasons[0] || 'This item cannot be rented right now.');
      setChatFeedbackTone('warning');
      return;
    }

    if (!selectedStartDate || !parseLocalDateTimeValue(selectedEnd)) {
      setChatFeedback('Please select both check-in and check-out date/time before renting.');
      setChatFeedbackTone('warning');
      return;
    }

    if (selectedStart) {
      sessionStorage.setItem('rentalCheckIn', selectedStart);
    } else {
      sessionStorage.removeItem('rentalCheckIn');
    }

    if (selectedEnd) {
      sessionStorage.setItem('rentalCheckOut', selectedEnd);
    } else {
      sessionStorage.removeItem('rentalCheckOut');
    }

    sessionStorage.setItem('rentalItemId', item.id);
    const rentQuery = new URLSearchParams({
      check_in: selectedStart,
      check_out: selectedEnd,
    });
    navigate(`/user/rent-item/${item.id}?${rentQuery.toString()}`);
  }

  function handleOpenBuyModal() {
    if (!item) return;
    if (!currentUserId) {
      navigate('/login');
      return;
    }
    if (!canBuyItem) {
      setChatFeedback('This listing is currently not available for purchase.');
      setChatFeedbackTone('warning');
      return;
    }
    setBuyRequestFeedback('');
    setBuyRequestForm({ buyer_message: '', buyer_preferred_pickup_at: '', quantity: '1' });
    setBuyModalOpen(true);
  }

  async function handleSubmitBuyRequest(event) {
    event.preventDefault();
    if (!item || !currentUserId) return;

    const preferredPickupText = String(buyRequestForm.buyer_preferred_pickup_at || '').trim();
    const requestedQuantity = Number(buyRequestForm.quantity || 1);
    const availableQuantity = Number(item.quantity || 0);
    const salePrice = Number(item.sale_price || 0);

    if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
      setBuyRequestFeedback('Quantity must be at least 1.');
      return;
    }

    if (requestedQuantity > availableQuantity) {
      setBuyRequestFeedback('Requested quantity cannot exceed available quantity.');
      return;
    }

    if (!preferredPickupText) {
      setBuyRequestFeedback('Preferred pickup date and time is required.');
      return;
    }

    const preferredPickup = new Date(preferredPickupText);
    if (Number.isNaN(preferredPickup.getTime())) {
      setBuyRequestFeedback('Preferred pickup date and time is invalid.');
      return;
    }

    setBuyRequestSaving(true);
    setBuyRequestFeedback('');
    try {
      const { data: existingRequest, error: existingRequestError } = await supabase
        .from('item_purchase_requests')
        .select('id, status')
        .eq('item_id', item.id)
        .eq('buyer_id', currentUserId)
        .in('status', ['pending', 'approved', 'awaiting_payment', 'paid', 'ready_for_pickup'])
        .limit(1)
        .maybeSingle();

      if (existingRequestError) {
        throw new Error(existingRequestError.message);
      }

      if (existingRequest?.id) {
        throw new Error('You already have an active purchase request for this item.');
      }

      const totalAmount = salePrice * requestedQuantity;
      const { data: createdRequest, error: createRequestError } = await supabase
        .from('item_purchase_requests')
        .insert({
          buyer_id: currentUserId,
          buyer_message: String(buyRequestForm.buyer_message || '').trim() || null,
          buyer_preferred_pickup_at: preferredPickup.toISOString(),
          buyer_requested_quantity: requestedQuantity,
          agreed_pickup_at: preferredPickup.toISOString(),
          item_id: item.id,
          sale_inclusions_snapshot: item.sale_inclusions || null,
          sale_price_snapshot: salePrice,
          seller_approved_quantity: requestedQuantity,
          sale_total_amount_snapshot: totalAmount,
          seller_id: item.owner_id,
          status: 'awaiting_payment',
        })
        .select('id')
        .single();

      if (createRequestError) {
        throw new Error(createRequestError.message);
      }

      const successUrl = `${window.location.origin}/user/manage-booking?payment_status=success&purchase_paid=true&purchase_request_id=${encodeURIComponent(
        createdRequest.id
      )}`;
      const cancelUrl = `${window.location.href}`;
      const checkoutSession = await createTestCheckoutSession({
        amount: totalAmount,
        cancelUrl,
        currency: 'PHP',
        description: `Purchase payment for ${item.title || 'sale item'}`,
        lineItems: [
          {
            amount: salePrice,
            name: `${item.title || 'Sale item'} purchase`,
            quantity: requestedQuantity,
          },
        ],
        metadata: {
          item_id: item.id,
          purchase_request_id: createdRequest.id,
          source: 'purchase_request_payment',
        },
        successUrl,
      });

      if (!checkoutSession?.attributes?.checkout_url) {
        throw new Error('Failed to get checkout URL from PayMongo.');
      }

      window.location.href = checkoutSession.attributes.checkout_url;
    } catch (buyError) {
      setBuyRequestFeedback(`Unable to submit purchase request: ${buyError.message}`);
    } finally {
      setBuyRequestSaving(false);
    }
  }

  async function handleOpenChat() {
    if (!item) {
      return;
    }

    if (!currentUserId) {
      navigate('/login');
      return;
    }

    setChatBusy(true);
    setChatFeedback('');

    try {
      const membersResult = await supabase
        .from('conversation_members')
        .select('conversation_id, user_id')
        .in('user_id', [currentUserId, item.owner_id]);

      if (membersResult.error) {
        throw new Error(membersResult.error.message);
      }

      const candidateConversationIds = Array.from(
        (membersResult.data || []).reduce((matches, member) => {
          const current = matches.get(member.conversation_id) || new Set();
          current.add(member.user_id);
          matches.set(member.conversation_id, current);
          return matches;
        }, new Map())
      )
        .filter(([, memberIds]) => memberIds.has(currentUserId) && memberIds.has(item.owner_id))
        .map(([conversationId]) => conversationId);

      let conversation = null;

      if (candidateConversationIds.length) {
        const conversationsResult = await supabase
          .from('conversations')
          .select('id, booking_id, item_id, created_at')
          .in('id', candidateConversationIds)
          .order('created_at', { ascending: false });

        if (conversationsResult.error) {
          throw new Error(conversationsResult.error.message);
        }

        const candidateConversations = conversationsResult.data || [];
        conversation = candidateConversations.find((candidate) => candidate.item_id === item.id) || null;
      }

      if (!conversation) {
        const bookingResult = await supabase
          .from('bookings')
          .select('id, borrower_id, owner_id, created_at')
          .eq('item_id', item.id)
          .eq('borrower_id', currentUserId)
          .eq('owner_id', item.owner_id)
          .order('created_at', { ascending: false })
          .limit(1);

        if (bookingResult.error) {
          throw new Error(bookingResult.error.message);
        }

        const booking = bookingResult.data?.[0] || null;
        const createConversationPayload = {
          item_id: item.id,
        };

        if (booking) {
          createConversationPayload.booking_id = booking.id;
        }

        const createConversationResult = await supabase
          .from('conversations')
          .insert(createConversationPayload)
          .select('id, booking_id, item_id')
          .single();

        if (createConversationResult.error) {
          throw new Error(createConversationResult.error.message);
        }

        conversation = createConversationResult.data;
      }

      const { error: membersError } = await supabase.from('conversation_members').upsert(
        [
          { conversation_id: conversation.id, user_id: currentUserId },
          { conversation_id: conversation.id, user_id: item.owner_id },
        ],
        { ignoreDuplicates: true, onConflict: 'conversation_id,user_id' }
      );

      if (membersError) {
        throw new Error(membersError.message);
      }

      navigate(`/user/messages?conversation=${conversation.id}&item=${item.id}`);
    } catch (chatError) {
      setChatFeedback(`Unable to open chat: ${chatError.message}`);
      setChatFeedbackTone('warning');
    } finally {
      setChatBusy(false);
    }
  }

  function handleDecreaseDesiredQuantity() {
    const available = Number(item?.quantity) || 1;
    setDesiredQuantity((current) => clampDesiredQuantity(current - 1, available));
  }

  function handleIncreaseDesiredQuantity() {
    const available = Number(item?.quantity) || 1;
    setDesiredQuantity((current) => clampDesiredQuantity(current + 1, available));
  }

  async function handleSaveRentItem() {
    if (!item) {
      return;
    }

    if (!currentUserId) {
      navigate('/login');
      return;
    }

    if (currentUserId === item.owner_id) {
      setSaveRentFeedback('You cannot save your own listing.');
      setSaveRentFeedbackTone('warning');
      return;
    }

    const available = Number(item.quantity || 0);
    if (!Number.isFinite(available) || available < 1) {
      setSaveRentFeedback('This listing has no available quantity.');
      setSaveRentFeedbackTone('warning');
      return;
    }

    const nextQuantity = clampDesiredQuantity(desiredQuantity, available);
    setSaveRentLoading(true);
    setSaveRentFeedback('');

    try {
      const { data, error } = await supabase
        .from('saved_rent_items')
        .upsert(
          {
            desired_quantity: nextQuantity,
            item_id: item.id,
            note: null,
            user_id: currentUserId,
          },
          { onConflict: 'user_id,item_id' }
        )
        .select('id, desired_quantity, note, created_at, updated_at')
        .single();

      if (error) {
        throw new Error(error.message);
      }

      setSavedRentItem(data || null);
      setDesiredQuantity(nextQuantity);
      setSaveRentFeedback('Listing saved.');
      setSaveRentFeedbackTone('success');
    } catch (saveError) {
      setSaveRentFeedback(`Unable to save listing: ${saveError.message}`);
      setSaveRentFeedbackTone('warning');
    } finally {
      setSaveRentLoading(false);
    }
  }

  async function handleRemoveSavedRentItem() {
    if (!item || !currentUserId || !savedRentItem) {
      return;
    }

    setSaveRentLoading(true);
    setSaveRentFeedback('');

    try {
      const { error } = await supabase
        .from('saved_rent_items')
        .delete()
        .eq('user_id', currentUserId)
        .eq('item_id', item.id);

      if (error) {
        throw new Error(error.message);
      }

      setSavedRentItem(null);
      setDesiredQuantity(1);
      setSaveRentFeedback('Saved listing removed.');
      setSaveRentFeedbackTone('info');
    } catch (removeError) {
      setSaveRentFeedback(`Unable to remove saved listing: ${removeError.message}`);
      setSaveRentFeedbackTone('warning');
    } finally {
      setSaveRentLoading(false);
    }
  }

  const galleryImages = item?.images || [];
  const activeImage = galleryImages[activeImageIndex] || item?.primaryImage || null;
  const pricePerDay = Number(item?.rental_price_per_day) || 0;
  const availableQuantity = Math.max(0, Number(item?.quantity) || 0);
  const securityDeposit = Number(item?.security_deposit) || 0;
  const rentalSubtotal = pricePerDay * minRentalDays;
  const bookingTotal = rentalSubtotal + securityDeposit;
  const memberYear = item?.owner?.created_at ? new Date(item.owner.created_at).getFullYear() : null;
  const backTarget = publicMode ? '/' : '/user/dashboard';
  const ownerAverageRating = Number(item?.owner?.average_rating || 0);
  const ownerReviewCount = Number(item?.owner?.total_reviews || ownerReviews.length || 0);
  const descriptionText = String(item?.description || '').trim();
  const descriptionParagraphs = descriptionText
    ? descriptionText.split(/\n+/).map((part) => part.trim()).filter(Boolean)
    : ['No product description available.'];
  const mobileReviewPreview = ownerReviews.slice(0, 2);
  const productHighlights = [
    `Security deposit: ${currencyFormatter.format(securityDeposit)}`,
    `Minimum rental duration: ${minRentalDays} day${minRentalDays === 1 ? '' : 's'}`,
    `Maximum rental duration: ${maxRentalDays} day${maxRentalDays === 1 ? '' : 's'}`,
    `Pickup area: ${item?.pickup_city || item?.pickup_province || 'Not specified'}`,
  ];

  function handlePublicSearchSubmit(event) {
    event.preventDefault();
    const normalized = headerSearch.trim();
    if (!normalized) {
      navigate(headerBarangay === 'all' ? '/items' : `/items?barangay=${encodeURIComponent(headerBarangay)}`);
      return;
    }
    const params = new URLSearchParams({ q: normalized });
    if (headerBarangay !== 'all') params.set('barangay', headerBarangay);
    navigate(`/items?${params.toString()}`);
  }

  const detailContent = (
    <div className="item-detail-page">
      <main className="item-detail-main">
      <div className="item-detail-backrow">
        <Button onClick={() => navigate(backTarget)} variant="ghost">Return</Button>
        {!loading && item ? (
          <div className="item-detail-breadcrumb">
            Home <span>/</span> {item.category?.name || 'General'} <span>/</span> <strong>{item.title}</strong>
          </div>
        ) : null}
      </div>

      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
      {loading ? <BorrowKoToItemLoader /> : null}

        {!loading && item ? (
          <>
            <section className="item-detail-layout">
              <div className="item-detail-content">
                <div className="item-detail-gallery-shell">
                  {galleryImages.length ? (
                    <div className="item-detail-thumbs item-detail-thumbs-rail">
                      {galleryImages.slice(0, 4).map((image, index) => (
                        <button className={index === activeImageIndex ? 'is-active' : ''} key={image.id || image.image_url + '-' + index} onClick={() => setActiveImageIndex(index)} type="button">
                          <img alt={item.title + ' ' + (index + 1)} src={image.image_url} />
                          {index === 3 && galleryImages.length > 4 ? <span>+{galleryImages.length - 4}</span> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="item-detail-hero-quickview">
                    <div
                      className="item-detail-hero-image"
                      onClick={() => activeImage?.image_url && setImageViewerOpen(true)}
                      onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && activeImage?.image_url) setImageViewerOpen(true); }}
                      onMouseEnter={handleQuickViewMouseEnter}
                      onMouseLeave={handleQuickViewMouseLeave}
                      onMouseMove={handleQuickViewMouseMove}
                      ref={heroImageRef}
                      role={activeImage?.image_url ? 'button' : undefined}
                      tabIndex={activeImage?.image_url ? 0 : undefined}
                    >
                      {activeImage?.image_url ? (
                        <>
                          <img
                            alt={item.title}
                            className={imageQuickView.active ? 'is-zoomed' : ''}
                            src={activeImage.image_url}
                            style={{ transformOrigin: `${imageQuickView.xPercent}% ${imageQuickView.yPercent}%` }}
                          />
                          {imageQuickView.active ? (
                            <div
                              className="item-detail-hero-lens"
                              style={{
                                left: `${imageQuickView.xPercent}%`,
                                top: `${imageQuickView.yPercent}%`,
                              }}
                            />
                          ) : null}
                        </>
                      ) : (
                        <div className="item-detail-image-empty">No image available</div>
                      )}
                    </div>
                  </div>
                </div>

                <section className="item-detail-mobile-summary">
                  <h1>{item.title}</h1>
                  <div className="item-detail-mobile-summary-price">
                    <strong>{currencyFormatter.format(pricePerDay)}</strong>
                  </div>
                </section>

                <div className="item-detail-specs">
                  {[
                    ['Condition', item.item_condition ? formatListingStatusLabel(item.item_condition) : 'Not set'],
                    ['Security Deposit', currencyFormatter.format(securityDeposit)],
                    ['Min Rental', minRentalDays + ' Day' + (minRentalDays === 1 ? '' : 's')],
                    ['Max Rental', maxRentalDays + ' Day' + (maxRentalDays === 1 ? '' : 's')],
                    ['Purchase', item.is_for_sale ? `For sale at ${currencyFormatter.format(Number(item.sale_price) || 0)}` : 'Not for sale'],
                  ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                </div>

                <section className="item-detail-product-details">
                  <div className="item-detail-product-details-head">
                    <h2>Product Details</h2>
                    <div className="item-detail-design-rating-line">
                      <span className="item-detail-rating-star"><StarIcon size={15} /></span>
                      <span>{ownerAverageRating > 0 ? ownerAverageRating.toFixed(1) : '0.0'} ({ownerReviewCount} reviews)</span>
                    </div>
                  </div>
                  <div className="item-detail-product-meta-grid item-detail-product-meta-grid-desktop">
                    <article>
                      <DetailIcon size={18} type="category" />
                      <div>
                        <span>Category</span>
                        <strong>{item.category?.name || 'General'}</strong>
                      </div>
                    </article>
                    <article>
                      <DetailIcon size={18} type="material" />
                      <div>
                        <span>Condition</span>
                        <strong>{item.item_condition ? formatListingStatusLabel(item.item_condition) : 'Not specified'}</strong>
                      </div>
                    </article>
                    <article>
                      <DetailIcon size={18} type="shipping" />
                      <div>
                        <span>Picked up on</span>
                        <strong>{item.pickup_city || item.pickup_province || 'Location not set'}</strong>
                      </div>
                    </article>
                  </div>
                  <div aria-label="Product content tabs" className="item-detail-mobile-info-tabs" role="tablist">
                    <button
                      aria-selected={mobileInfoTab === 'details'}
                      className={mobileInfoTab === 'details' ? 'is-active' : ''}
                      onClick={() => setMobileInfoTab('details')}
                      role="tab"
                      type="button"
                    >
                      Details
                    </button>
                    <button
                      aria-selected={mobileInfoTab === 'shipping'}
                      className={mobileInfoTab === 'shipping' ? 'is-active' : ''}
                      onClick={() => setMobileInfoTab('shipping')}
                      role="tab"
                      type="button"
                    >
                      Shipping
                    </button>
                    <button
                      aria-selected={mobileInfoTab === 'reviews'}
                      className={mobileInfoTab === 'reviews' ? 'is-active' : ''}
                      onClick={() => setMobileInfoTab('reviews')}
                      role="tab"
                      type="button"
                    >
                      Reviews
                    </button>
                  </div>
                  <div className="item-detail-mobile-info-panel">
                    {mobileInfoTab === 'details' ? (
                      <>
                        <div className="item-detail-product-meta-grid item-detail-product-meta-grid-mobile">
                          <article>
                            <DetailIcon size={18} type="category" />
                            <div>
                              <span>Category</span>
                              <strong>{item.category?.name || 'General'}</strong>
                            </div>
                          </article>
                          <article>
                            <DetailIcon size={18} type="material" />
                            <div>
                              <span>Condition</span>
                              <strong>{item.item_condition ? formatListingStatusLabel(item.item_condition) : 'Not specified'}</strong>
                            </div>
                          </article>
                          <article>
                            <DetailIcon size={18} type="shipping" />
                            <div>
                              <span>Picked up on</span>
                              <strong>{item.pickup_city || item.pickup_province || 'Location not set'}</strong>
                            </div>
                          </article>
                        </div>
                        <div className="item-detail-mobile-copy">
                          {descriptionParagraphs.map((paragraph, index) => (
                            <p key={`mobile-desc-${index}`}>{paragraph}</p>
                          ))}
                        </div>
                        <ul className="item-detail-mobile-highlights">
                          {productHighlights.map((highlight) => (
                            <li key={`mobile-highlight-${highlight}`}>{highlight}</li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                    {mobileInfoTab === 'shipping' ? (
                      <div className="item-detail-mobile-shipping">
                        <div>
                          <span>Picked up on</span>
                          <strong>{item.pickup_city || item.pickup_province || 'Location not set'}</strong>
                        </div>
                        <div>
                          <span>Address visibility</span>
                          <strong>{pickupLocation ? 'Exact address revealed after booking' : 'Owner has not saved a pickup address yet'}</strong>
                        </div>
                        {item.meetup_notes ? (
                          <div>
                            <span>Pickup notes</span>
                            <strong>{item.meetup_notes}</strong>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {mobileInfoTab === 'reviews' ? (
                      <div className="item-detail-mobile-reviews">
                        <section className="item-detail-owner-card item-detail-mobile-owner-card">
                          <div className="item-detail-owner-head">
                            <div className="item-detail-avatar">
                              {item.owner?.profile_photo_url ? <img alt={ownerName} src={item.owner.profile_photo_url} /> : <span>{ownerInitials}</span>}
                            </div>
                            <div>
                              <strong>{ownerName}</strong>
                              <StarRating rating={item.owner?.average_rating} reviewCount={item.owner?.total_reviews} size={11} textStyle={{ fontSize: 11 }} />
                            </div>
                          </div>
                          <div className="item-detail-owner-meta">
                            <span>
                              <ShieldIcon size={14} /> {item.owner?.is_verified ? 'Identity Verified' : 'Identity pending'}
                            </span>
                            <span>
                              <CalendarIcon size={14} /> {memberYear ? 'Member since ' + memberYear : 'Member since unavailable'}
                            </span>
                          </div>
                          {chatFeedback ? <StatusMessage tone={chatFeedbackTone}>{chatFeedback}</StatusMessage> : null}
                          <button disabled={!canChat || chatBusy} onClick={handleOpenChat} type="button">
                            <MessageIcon size={15} /> {chatBusy ? 'Opening...' : 'Message Owner'}
                          </button>
                        </section>
                        {mobileReviewPreview.length ? (
                          <div className="item-detail-mobile-review-list">
                            {mobileReviewPreview.map((review) => (
                              <article key={`mobile-review-${review.id}`}>
                                <strong>{buildPersonName(review.reviewer) || 'Community member'}</strong>
                                {review.created_at ? <small>{formatReviewDate(review.created_at)}</small> : null}
                                <p>{review.review_text || 'No written review was shared for this booking.'}</p>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="item-detail-mobile-empty">No reviews yet.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <h3 className="item-detail-product-subtitle">Description</h3>
                  <div className="item-detail-product-copy">
                    {descriptionParagraphs.slice(0, 2).map((paragraph, index) => (
                      <p key={`desc-paragraph-${index}`}>{paragraph}</p>
                    ))}
                  </div>
                  <h3 className="item-detail-product-subtitle">Highlights</h3>
                  <ul className="item-detail-product-highlights">
                    {productHighlights.map((highlight) => (
                      <li key={highlight}>{highlight}</li>
                    ))}
                  </ul>
                </section>

                {itemAddons.length ? (
                  <section className="item-detail-section">
                    <div className="item-detail-section-head"><h2>Available add-ons</h2><span>{itemAddons.length} available</span></div>
                    <div className="item-detail-addon-grid">
                      {itemAddons.slice(0, 3).map((addon) => (
                        <article key={addon.id}>{addon.image_url ? <img alt={addon.addon_name} src={addon.image_url} /> : <div>Add-on</div>}<strong>{addon.addon_name}</strong><span>{currencyFormatter.format(Number(addon.price) || 0)} / {formatAddonPricingLabel(addon.pricing_type)}</span></article>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="item-detail-section item-detail-pickup-section">
                  <h2>Pickup Location</h2>
                  <div className="item-detail-location-card"><DetailIcon type="pin" /><div><strong>{item.pickup_city || item.pickup_province || 'Pickup location not set'}</strong><span>{pickupLocation ? 'Exact address revealed after booking' : 'Owner has not saved a pickup address yet'}</span></div></div>
                  {pickupMapUrl ? <iframe className="item-detail-map" src={pickupMapUrl} title="Pickup location map" /> : <div className="item-detail-map item-detail-map-empty">Map preview appears when pickup coordinates are saved.</div>}
                  {item.meetup_notes ? <p className="item-detail-notes">{item.meetup_notes}</p> : null}
                </section>
              </div>

              <aside className="item-detail-sidebar">
                <section className="item-detail-owner-card item-detail-owner-card-shell">
                  <div className="item-detail-owner-head"><div className="item-detail-avatar">{item.owner?.profile_photo_url ? <img alt={ownerName} src={item.owner.profile_photo_url} /> : <span>{ownerInitials}</span>}</div><div><strong>{ownerName}</strong><StarRating rating={item.owner?.average_rating} reviewCount={item.owner?.total_reviews} size={11} textStyle={{ fontSize: 11 }} /></div></div>
                  <div className="item-detail-owner-meta"><span><ShieldIcon size={14} /> {item.owner?.is_verified ? 'Identity Verified' : 'Identity pending'}</span><span><CalendarIcon size={14} /> {memberYear ? 'Member since ' + memberYear : 'Member since unavailable'}</span></div>
                  {chatFeedback ? <StatusMessage tone={chatFeedbackTone}>{chatFeedback}</StatusMessage> : null}
                  {!rentEligibility.allowed ? <StatusMessage tone="info">{rentEligibility.reasons[0]}</StatusMessage> : null}
                  <button disabled={!canChat || chatBusy} onClick={handleOpenChat} type="button"><MessageIcon size={15} /> {chatBusy ? 'Opening...' : 'Message Owner'}</button>
                </section>

                <section className="item-detail-booking-card">
                  <div className="item-detail-product-summary item-detail-design-summary">
                    <div className="item-detail-design-topline">
                      <span>Rental Item:</span>
                      <button
                        aria-label={savedRentItem ? 'Remove saved listing' : 'Save listing'}
                        className={`item-detail-save-star${savedRentItem ? ' is-saved' : ''}`}
                        disabled={saveRentLoading || availableQuantity < 1}
                        onClick={savedRentItem ? handleRemoveSavedRentItem : handleSaveRentItem}
                        style={{
                          background: savedRentItem ? alpha(secondaryThemeColor, 0.16) : alpha(primaryThemeColor, 0.08),
                          borderColor: savedRentItem ? secondaryThemeColor : alpha(primaryThemeColor, 0.42),
                          color: savedRentItem ? secondaryThemeColor : primaryThemeColor,
                        }}
                        type="button"
                      >
                        {saveRentLoading ? '...' : <BookmarkIcon filled={Boolean(savedRentItem)} size={18} />}
                      </button>
                    </div>
                    <h1>{item.title}</h1>
                    <strong className="item-detail-design-price">{currencyFormatter.format(pricePerDay)}</strong>
                  </div>
                  <div className="item-detail-design-options">
                    <div className="item-detail-design-group">
                      <div className="item-detail-quantity-head">
                        <span>Quantity</span>
                        <small className="item-detail-stock-text">Only {availableQuantity} item{availableQuantity === 1 ? '' : 's'} left in stock</small>
                      </div>
                      <div className="item-detail-quantity-stepper">
                        <button
                          aria-label="Decrease quantity"
                          disabled={saveRentLoading || desiredQuantity <= 1}
                          onClick={handleDecreaseDesiredQuantity}
                          type="button"
                        >
                          -
                        </button>
                        <strong>{desiredQuantity}</strong>
                        <button
                          aria-label="Increase quantity"
                          disabled={saveRentLoading || desiredQuantity >= Math.max(1, availableQuantity)}
                          onClick={handleIncreaseDesiredQuantity}
                          type="button"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {saveRentFeedback ? <StatusMessage tone={saveRentFeedbackTone}>{saveRentFeedback}</StatusMessage> : null}
                  </div>

                  <span className="item-detail-booking-section-title">Set rental schedule</span>
                  <div className="item-detail-date-grid">
                    <label>
                      <span>Check-in</span>
                      <DatePicker
                        aria-label="Check-in date and time"
                        calendarClassName="rent-datepicker-calendar"
                        className="item-detail-datepicker-input"
                        dateFormat="dd/MM/yyyy hh:mm aa"
                        dayClassName={bookedDayClassName}
                        excludeDateIntervals={blockedDateIntervals}
                        filterTime={isStartDateTimeSelectable}
                        minDate={startDatePickerMinDate}
                        onChange={handleSelectedStartChange}
                        placeholderText="Select date and time"
                        selected={selectedStartDate}
                        showTimeSelect
                        timeCaption="Time"
                        timeIntervals={SLOT_INTERVAL_MINUTES}
                      />
                    </label>
                    <label>
                      <span>Check-out</span>
                      <DatePicker
                        aria-label="Check-out date and time"
                        calendarClassName="rent-datepicker-calendar"
                        className="item-detail-datepicker-input"
                        dateFormat="dd/MM/yyyy hh:mm aa"
                        dayClassName={bookedDayClassName}
                        disabled={!selectedStart}
                        excludeDateIntervals={blockedDateIntervals}
                        filterTime={isEndDateTimeSelectable}
                        maxDate={endDatePickerMaxDate || undefined}
                        minDate={endDatePickerMinDate}
                        onChange={handleSelectedEndChange}
                        placeholderText="Select date and time"
                        selected={parseLocalDateTimeValue(selectedEnd)}
                        showTimeSelect
                        timeCaption="Time"
                        timeIntervals={SLOT_INTERVAL_MINUTES}
                      />
                    </label>
                  </div>
                  <div className="item-detail-booked-calendar">
                    <div className="item-detail-booked-calendar-head">
                      <strong>Booked dates</strong>
                      {!hasSelectedSchedule ? (
                        <span className="item-detail-rent-warning item-detail-booked-warning" role="note" tabIndex={0}>
                          !
                          <span className="item-detail-rent-warning-tooltip">Set both start and end date first.</span>
                        </span>
                      ) : null}
                    </div>
                    <DatePicker
                      calendarClassName="rent-datepicker-calendar"
                      dayClassName={bookedDayClassName}
                      excludeDateIntervals={blockedDateIntervals}
                      filterDate={(date) => !bookedDayClassName(date)}
                      inline
                      minDate={startDatePickerMinDate}
                      onChange={() => {}}
                      selected={null}
                    />
                  </div>
                  <div className="item-detail-price-lines"><div><span>{currencyFormatter.format(pricePerDay)} x {minRentalDays} day</span><strong>{currencyFormatter.format(rentalSubtotal)}</strong></div><div><span>Security Deposit</span><strong>{currencyFormatter.format(securityDeposit)}</strong></div><div><span>Total</span><strong>{currencyFormatter.format(bookingTotal)}</strong></div></div>
                  {itemAddons.length ? (
                    <div className="item-detail-booking-addons">
                      <strong>Available add-ons</strong>
                      <div>
                        {itemAddons.slice(0, 4).map((addon) => (
                          <span key={addon.id}>
                            {addon.addon_name} - {currencyFormatter.format(Number(addon.price) || 0)} / {formatAddonPricingLabel(addon.pricing_type)}
                            {addon.is_required ? ' (required)' : ''}
                          </span>
                        ))}
                        {itemAddons.length > 4 ? <span>+{itemAddons.length - 4} more add-ons on next step</span> : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="item-detail-action-row">
                    <button
                      aria-label="Message owner"
                      className="item-detail-rent-btn item-detail-chat-cta"
                      disabled={!canChat || chatBusy}
                      onClick={handleOpenChat}
                      type="button"
                    >
                      <MessageIcon size={20} />
                    </button>
                    <button
                      className="item-detail-rent-btn"
                      disabled={!canProceedToRent}
                      onClick={handleOpenRentItem}
                      style={{ background: primaryThemeColor, color: primaryThemeTextColor }}
                      type="button"
                    >
                      Rent now
                    </button>
                    <button
                      className="item-detail-rent-btn item-detail-buy-btn"
                      disabled={!canBuyItem}
                      onClick={handleOpenBuyModal}
                      style={{ background: primaryThemeColor, color: primaryThemeTextColor }}
                      type="button"
                    >
                      <span>Buy now</span>
                      <small>{item.is_for_sale ? currencyFormatter.format(Number(item.sale_price) || 0) : 'Not for sale'}</small>
                    </button>
                  </div>
                  <p>You won't be charged yet</p>
                </section>

              </aside>
            </section>

            <section className="item-detail-wide-section item-detail-wide-reviews-section">
              <div className="item-detail-section-head"><h2>Reviews</h2><button onClick={() => setReviewsOpen(true)} type="button">View All</button></div>
              <div className="item-detail-review-grid">
                {ownerReviews.length
                  ? ownerReviews.slice(0, 2).map((review) => (
                      <article key={review.id}>
                        <div className="item-detail-review-avatar">
                          {review.reviewer?.profile_photo_url ? <img alt={buildPersonName(review.reviewer) || 'Reviewer'} src={review.reviewer.profile_photo_url} /> : null}
                        </div>
                        <div className="item-detail-review-content">
                          <div className="item-detail-review-head">
                            <strong>{buildPersonName(review.reviewer) || 'Community member'}</strong>
                            {review.created_at ? <span>{formatReviewDate(review.created_at)}</span> : null}
                          </div>
                          <StarRating rating={review.rating} reviewCount={1} size={15} textStyle={{ display: 'none' }} />
                          <p>{review.review_text || 'No written review was shared for this booking.'}</p>
                        </div>
                      </article>
                    ))
                  : (
                    <article>
                      <div className="item-detail-review-avatar" />
                      <div>
                        <strong>No reviews yet</strong>
                        <p>This owner has not received written reviews yet.</p>
                      </div>
                    </article>
                  )}
              </div>
            </section>

            <section className="item-detail-wide-section">
              <div className="item-detail-section-head item-detail-owner-more-head"><h2>More from this owner</h2><button onClick={() => setOwnerProfileOpen(true)} type="button">View Profile</button></div>
              <div className="item-detail-related-grid">
                {ownerOtherItems.length ? ownerOtherItems.slice(0, 4).map((relatedItem) => <article key={relatedItem.id} onClick={() => openItemDetails(relatedItem)} role="button" tabIndex={0}><div className="item-detail-related-image">{relatedItem.primaryImage?.image_url ? <img alt={relatedItem.title} src={relatedItem.primaryImage.image_url} /> : <span>{relatedItem.title?.charAt(0) || 'I'}</span>}</div><div className="item-detail-related-body"><strong>{relatedItem.title}</strong><span>{relatedItem.category?.name || formatListingStatusLabel(relatedItem.item_condition)}</span><p>{currencyFormatter.format(Number(relatedItem.rental_price_per_day) || 0)} <small>/ day</small></p></div></article>) : <div className="item-detail-related-empty"><StatusMessage tone="info">This owner does not have other active product listings right now.</StatusMessage></div>}
              </div>
            </section>

            <section className="item-detail-wide-section">
              <div className="item-detail-section-head"><h2>Similar items</h2><span>{item.category?.name || 'Same category'}</span></div>
              <div className="item-detail-related-grid">
                {sameCategoryItems.length ? sameCategoryItems.slice(0, 4).map((relatedItem) => <article key={relatedItem.id} onClick={() => openItemDetails(relatedItem)} role="button" tabIndex={0}><div className="item-detail-related-image">{relatedItem.primaryImage?.image_url ? <img alt={relatedItem.title} src={relatedItem.primaryImage.image_url} /> : <span>{relatedItem.title?.charAt(0) || 'I'}</span>}</div><div className="item-detail-related-body"><strong>{relatedItem.title}</strong><span>{relatedItem.category?.name || formatListingStatusLabel(relatedItem.item_condition)}</span><p>{currencyFormatter.format(Number(relatedItem.rental_price_per_day) || 0)} <small>/ day</small></p></div></article>) : <div className="item-detail-related-empty"><StatusMessage tone="info">No similar active listings are available in this category right now.</StatusMessage></div>}
              </div>
            </section>

            {imageViewerOpen && activeImage?.image_url ? (
              <div aria-label={`${item.title} image gallery`} aria-modal="true" className="item-detail-image-viewer" role="dialog">
                <button aria-label="Close image gallery" className="item-detail-image-viewer-close" onClick={() => setImageViewerOpen(false)} type="button">×</button>
                {galleryImages.length > 1 ? <button aria-label="Previous image" className="item-detail-image-viewer-arrow previous" onClick={() => setActiveImageIndex((current) => (current - 1 + galleryImages.length) % galleryImages.length)} type="button">←</button> : null}
                <div className="item-detail-image-viewer-stage">
                  <img
                    alt={item.title}
                    className={`item-detail-image-viewer-main${viewerZoom.active ? ' is-zoomed' : ''}`}
                    onMouseEnter={updateViewerZoom}
                    onMouseLeave={resetViewerZoom}
                    onMouseMove={updateViewerZoom}
                    src={activeImage.image_url}
                    style={{ transformOrigin: `${viewerZoom.xPercent}% ${viewerZoom.yPercent}%` }}
                  />
                  <span className="item-detail-image-viewer-zoom-hint" aria-hidden="true">
                    {viewerZoom.active ? '−' : '+'}
                  </span>
                </div>
                {galleryImages.length > 1 ? <button aria-label="Next image" className="item-detail-image-viewer-arrow next" onClick={() => setActiveImageIndex((current) => (current + 1) % galleryImages.length)} type="button">→</button> : null}
                {galleryImages.length ? <div className="item-detail-image-viewer-thumbs">{galleryImages.map((image, index) => <button aria-label={`View image ${index + 1}`} className={index === activeImageIndex ? 'active' : ''} key={image.id || image.image_url} onClick={() => setActiveImageIndex(index)} type="button"><img alt="" src={image.image_url} /></button>)}</div> : null}
              </div>
            ) : null}
          </>
        ) : null}
        </main>

        <Modal contentClassName="item-detail-compact-modal" onClose={() => setReviewsOpen(false)} open={reviewsOpen} title="Owner reviews">
          <div className="item-detail-modal-list">
            {ownerReviews.length
              ? ownerReviews.map((review) => (
                  <article key={review.id}>
                    <div className="item-detail-review-avatar">
                      {review.reviewer?.profile_photo_url ? <img alt={buildPersonName(review.reviewer) || 'Reviewer'} src={review.reviewer.profile_photo_url} /> : null}
                    </div>
                    <div className="item-detail-review-content">
                      <div className="item-detail-review-head">
                        <strong>{buildPersonName(review.reviewer) || 'Community member'}</strong>
                        {review.created_at ? <span>{formatReviewDate(review.created_at)}</span> : null}
                      </div>
                      <StarRating rating={review.rating} reviewCount={1} size={15} textStyle={{ display: 'none' }} />
                      <p>{review.review_text || 'No written review was shared for this booking.'}</p>
                    </div>
                  </article>
                ))
              : <StatusMessage tone="info">This owner has not received written reviews yet.</StatusMessage>}
          </div>
        </Modal>

        <Modal
          actions={canChat ? <Button disabled={chatBusy} icon={<MessageIcon size={16} />} onClick={handleOpenChat}>{chatBusy ? 'Opening...' : 'Message owner'}</Button> : null}
          contentClassName="item-detail-compact-modal item-detail-profile-modal"
          onClose={() => setOwnerProfileOpen(false)}
          open={ownerProfileOpen}
          title={ownerName}
        >
          <div className="item-detail-owner-profile">
            <div className="item-detail-owner-head"><div className="item-detail-avatar">{item?.owner?.profile_photo_url ? <img alt={ownerName} src={item.owner.profile_photo_url} /> : <span>{ownerInitials}</span>}</div><div><strong>{ownerName}</strong><StarRating rating={item?.owner?.average_rating} reviewCount={item?.owner?.total_reviews} /></div></div>
            <div className="item-detail-profile-grid">
              <div><span>Verification</span><strong>{item?.owner?.is_verified ? 'Identity verified' : 'Identity pending'}</strong></div>
              <div><span>Member since</span><strong>{memberYear || 'Unavailable'}</strong></div>
              <div><span>Username</span><strong>{item?.owner?.username ? `@${item.owner.username}` : 'No username saved'}</strong></div>
              <div><span>Phone</span><strong>{item?.owner?.phone_number || 'No saved phone number'}</strong></div>
              <div className="item-detail-profile-wide"><span>Address</span><strong>{ownerProfileLocation || 'No saved address'}</strong></div>
            </div>
          </div>
        </Modal>

        <Modal
          actions={
            <>
              <Button className="buy-request-cancel" onClick={() => setBuyModalOpen(false)} variant="ghost">
                Cancel
              </Button>
              <Button className="buy-request-confirm" disabled={buyRequestSaving} form="buy-request-form" type="submit">
                {buyRequestSaving ? 'Submitting...' : 'Confirm purchase request'}
              </Button>
            </>
          }
          contentClassName="buy-request-modal"
          contentStyle={{ maxWidth: 940, width: 'min(940px, 100%)' }}
          onClose={() => setBuyModalOpen(false)}
          open={buyModalOpen}
          size="compact"
          title="Purchase request"
        >
          <form className="buy-request-form" id="buy-request-form" onSubmit={handleSubmitBuyRequest}>
            <div className="buy-request-product">
              <div className="buy-request-product-image">
                {activeImage?.image_url ? <img alt={item?.title || 'Item for sale'} src={activeImage.image_url} /> : <span>{item?.title?.charAt(0) || 'I'}</span>}
              </div>
              <div>
                <small>Buying from the community</small>
                <h4>{item?.title || 'Item for sale'}</h4>
                <strong>{currencyFormatter.format(Number(item?.sale_price || 0))}</strong>
                <p>The seller will review your requested pickup schedule before confirming the sale.</p>
              </div>
            </div>

            <div className="buy-request-fields">
            <label>
              <span>Quantity to buy</span>
              <input
                className="buy-request-input"
                max={Number(item?.quantity || 1)}
                min="1"
                onChange={(event) => setBuyRequestForm((current) => ({ ...current, quantity: event.target.value }))}
                step="1"
                type="number"
                value={buyRequestForm.quantity}
              />
              <small>
                Available quantity: {Number(item?.quantity || 0)}
              </small>
            </label>
            <label>
              <span>Preferred pickup date and time</span>
              <input
                className="buy-request-input"
                min={formatDateTimeLocalValue(new Date())}
                onChange={(event) => setBuyRequestForm((current) => ({ ...current, buyer_preferred_pickup_at: event.target.value }))}
                type="datetime-local"
                value={buyRequestForm.buyer_preferred_pickup_at}
              />
            </label>
            <label className="buy-request-message">
              <span>Message to seller</span>
              <Textarea
                onChange={(event) => setBuyRequestForm((current) => ({ ...current, buyer_message: event.target.value }))}
                placeholder="Share pickup preferences or purchase notes."
                style={{ minHeight: 112 }}
                value={buyRequestForm.buyer_message}
              />
            </label>
            </div>

            <div className="buy-request-summary">
            {item?.sale_inclusions ? (
              <div>
                <span>Sale inclusions</span>
                <p>{item.sale_inclusions}</p>
              </div>
            ) : null}
            <div className="buy-request-total">
              <span>Total purchase amount</span>
              <strong>{currencyFormatter.format((Number(item?.sale_price || 0) * Number(buyRequestForm.quantity || 1)) || 0)}</strong>
            </div>
            </div>
            {buyRequestFeedback ? <StatusMessage tone="warning">{buyRequestFeedback}</StatusMessage> : null}
          </form>
        </Modal>
    </div>
  );

  if (publicMode) {
    return (
      <div className="item-detail-public-shell">
        <header className="item-detail-public-topbar">
          <div className="item-detail-public-topbar-inner">
            <button className="item-detail-public-brand" onClick={() => navigate('/')} type="button">
              <span className="item-detail-public-brand-mark">
                <PublicBrandMark brandName={brandName} logoUrl={logoUrl} />
              </span>
              <strong>{brandName}</strong>
            </button>

            <div className="item-detail-public-barangay">
              <select aria-label="Filter by Baliuag barangay" id="detail-barangay-filter" onChange={(event) => setHeaderBarangay(event.target.value)} value={headerBarangay}>
                <option value="all">All barangays</option>
                {BALIUAG_BARANGAYS.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
              </select>
            </div>

            <form className="item-detail-public-search" onSubmit={handlePublicSearchSubmit}>
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.4-3.4" /></svg>
              <input aria-label="Search rentals" onChange={(event) => setHeaderSearch(event.target.value)} placeholder="Search for items to borrow..." value={headerSearch} />
              <button type="submit">Search</button>
            </form>

            <nav aria-label="Public navigation" className="item-detail-public-nav">
              <button className="item-detail-filter-link" onClick={() => navigate('/?filters=open')} type="button">
                <svg viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
                <span>Filters</span>
              </button>
              <button aria-label={currentUserId ? 'Open member dashboard' : 'Sign in'} className={`item-detail-public-icon-btn ${currentUserId ? 'signed-in' : ''}`} onClick={() => navigate(currentUserId ? '/user/dashboard' : '/login')} title={currentUserProfile?.first_name || currentUserProfile?.username || ''} type="button">
                {currentUserProfile?.profile_photo_url ? (
                  <img alt="" src={currentUserProfile.profile_photo_url} />
                ) : (
                  <svg viewBox="0 0 24 24">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20a8 8 0 0 1 16 0" />
                  </svg>
                )}
              </button>
            </nav>
          </div>
        </header>
        {detailContent}
      </div>
    );
  }

  return <UserShell>{detailContent}</UserShell>;
}

