import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import 'react-datepicker/dist/react-datepicker.css';
import { supabase } from '../../api/supabaseClient';
import { userHasActiveDamageHold } from '../../services/damageClaimsService';
import { Badge, Button, FormField, Input, Modal, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { sanitizeText } from '../../ui/profileFormUtils';
import { createTestCheckoutSession } from '../../services/transaction';
import { alpha, theme } from '../../ui/theme';
import { BOOKING_STATUS, RENTABLE_ITEM_STATUSES, TERMINAL_BOOKING_STATUSES } from '../../utils/bookingEnums';
import { useUISettings } from '../../context/UISettingsContext';
import '../../App.css';
import './rent-item-datepicker.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const itemSelectFields =
  'id, owner_id, category_id, title, rental_price_per_day, security_deposit, min_rental_days, max_rental_days, quantity, pickup_street, pickup_region, pickup_barangay, pickup_city, pickup_province, pickup_country, meetup_notes, status, is_active';
const SLOT_INTERVAL_MINUTES = 30;
const COMMISSION_RATE = 0.15;

function buildItemLocation(item) {
  return [item?.pickup_street, item?.pickup_barangay, item?.pickup_city, item?.pickup_province, item?.pickup_region, item?.pickup_country]
    .filter(Boolean)
    .join(', ');
}

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function formatCheckoutDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('en-PH', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function joinCheckoutReceiptLines(lines) {
  return lines.filter(Boolean).join(' ');
}

function calculateRentalDays(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  const millis = end.getTime() - start.getTime();

  if (millis <= 0) {
    return 0;
  }

  return Math.ceil(millis / (1000 * 60 * 60 * 24));
}

function isRentableStatus(status) {
  return RENTABLE_ITEM_STATUSES.has(String(status || '').toLowerCase());
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
  const text = sanitizeText(value);

  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function dateOverlapsBlock(startDate, endDate, blocks) {
  if (!startDate || Number.isNaN(startDate.getTime())) {
    return null;
  }

  const effectiveEnd = endDate && !Number.isNaN(endDate.getTime()) ? endDate : startDate;

  return (
    blocks.find((block) => {
      const blockStart = new Date(block.start_datetime);
      const blockEnd = new Date(block.end_datetime);

      if (Number.isNaN(blockStart.getTime()) || Number.isNaN(blockEnd.getTime())) {
        return false;
      }

      return startDate < blockEnd && effectiveEnd > blockStart;
    }) || null
  );
}

function formatBlockDateRange(block) {
  const start = new Date(block.start_datetime);
  const end = new Date(block.end_datetime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Invalid blocked range';
  }

  return `${start.toLocaleString()} to ${end.toLocaleString()}`;
}

function buildRentalDayLimitNote(value) {
  const minDays = Number(value?.min_rental_days || 1);
  const maxDays = value?.max_rental_days === null || value?.max_rental_days === undefined ? null : Number(value.max_rental_days);

  if (maxDays !== null && Number.isInteger(maxDays) && maxDays >= minDays) {
    return `Can be rented for ${minDays} to ${maxDays} day(s).`;
  }

  return `Can be rented for at least ${minDays} day(s).`;
}

function isRentalDayCountAllowed(value, rentalDays) {
  if (!rentalDays || rentalDays < 1) {
    return true;
  }

  const minDays = Number(value?.min_rental_days || 1);
  const maxDays = value?.max_rental_days === null || value?.max_rental_days === undefined ? null : Number(value.max_rental_days);

  if (rentalDays < minDays) {
    return false;
  }

  if (maxDays !== null && Number.isInteger(maxDays) && rentalDays > maxDays) {
    return false;
  }

  return true;
}

function buildAddonState(addons) {
  return addons.reduce((result, addon) => {
    result[addon.id] = {
      selected: Boolean(addon.is_required),
      quantity: 1,
    };

    return result;
  }, {});
}

function parseLocalDateTime(value, label) {
  const text = sanitizeText(value);

  if (!text) {
    throw new Error(`${label} is required.`);
  }

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} is invalid.`);
  }

  return date;
}

function parseWholeNumber(value, label, min = 1) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${label} must be at least ${min}.`);
  }

  return parsed;
}

function clampRequestedQuantity(value, maxAvailable) {
  const safeMax = Math.max(1, Number(maxAvailable) || 1);
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.min(safeMax, Math.max(1, Math.floor(parsed)));
}

export default function RentItem() {
  const navigate = useNavigate();
  const { itemId } = useParams();
  const { settings } = useUISettings();
  const [userId, setUserId] = useState('');
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [headerBarangay, setHeaderBarangay] = useState('all');
  const [headerSearch, setHeaderSearch] = useState('');
  const [item, setItem] = useState(null);
  const [itemImages, setItemImages] = useState([]);
  const [primaryRequestedQuantity, setPrimaryRequestedQuantity] = useState(1);
  const [ownerOtherItems, setOwnerOtherItems] = useState([]);
  const [selectedBundleItemIds, setSelectedBundleItemIds] = useState({});
  const [bundleRequestedQuantities, setBundleRequestedQuantities] = useState({});
  const [addons, setAddons] = useState([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState([]);
  const [addonSelection, setAddonSelection] = useState({});
  const [availableVouchers, setAvailableVouchers] = useState([]);
  const [selectedVoucherId, setSelectedVoucherId] = useState('');
  const [form, setForm] = useState({
    borrower_message: '',
    requested_end: '',
    requested_start: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [activeDamageHold, setActiveDamageHold] = useState(false);
  const [mobileNoteModal, setMobileNoteModal] = useState({ content: '', open: false, title: '' });
  const [bundleQuantityModal, setBundleQuantityModal] = useState({ itemId: '', open: false, quantity: 1 });

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);
      setMessage('');

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      if (!user?.id) {
        navigate('/login');
        return;
      }

      setUserId(user.id);

      const [itemResult, addonsResult, blocksResult, imagesResult, damageHoldResult, profileResult, vouchersResult] = await Promise.all([
        supabase.from('items').select(itemSelectFields).eq('id', itemId).maybeSingle(),
        supabase
          .from('item_addons')
          .select('id, item_id, addon_name, description, price, pricing_type, is_required, is_active, sort_order')
          .eq('item_id', itemId)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('item_availability_blocks')
          .select('id, start_datetime, end_datetime, reason, block_type')
          .eq('item_id', itemId)
          .gt('end_datetime', new Date().toISOString())
          .order('start_datetime', { ascending: true }),
        supabase
          .from('item_images')
          .select('id, item_id, image_url, is_primary, sort_order')
          .eq('item_id', itemId)
          .order('sort_order', { ascending: true }),
        userHasActiveDamageHold(user.id),
        supabase
          .from('profiles')
          .select('id, first_name, last_name, username, profile_photo_url')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('borrower_vouchers')
          .select('id, code, discount_type, discount_value, minimum_rental_amount, expires_at, reward_voucher_catalog(name)')
          .eq('borrower_id', user.id)
          .eq('status', 'available')
          .gt('expires_at', new Date().toISOString())
          .order('expires_at', { ascending: true }),
      ]);

      if (!mounted) {
        return;
      }

      if (itemResult.error) {
        setMessage(`Unable to load item: ${itemResult.error.message}`);
        setMessageTone('warning');
        setLoading(false);
        return;
      }

      if (!itemResult.data) {
        setMessage('This item could not be found.');
        setMessageTone('warning');
        setLoading(false);
        return;
      }

      if (addonsResult.error) {
        setMessage(`Unable to load item add-ons: ${addonsResult.error.message}`);
        setMessageTone('warning');
      }

      if (blocksResult.error) {
        setMessage(`Unable to load availability blocks: ${blocksResult.error.message}`);
        setMessageTone('warning');
      }

      if (imagesResult.error) {
        setMessage(`Unable to load item images: ${imagesResult.error.message}`);
        setMessageTone('warning');
      }

      const addonRows = addonsResult.data || [];
      const nextItem = itemResult.data;
      setCurrentUserProfile(profileResult.data || null);
      setAvailableVouchers(vouchersResult.data || []);
      setActiveDamageHold(Boolean(damageHoldResult));
      const nextImages = (imagesResult.data || [])
        .slice()
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || Number(left.sort_order) - Number(right.sort_order));

      const ownerItemsResult = await supabase
        .from('items')
        .select(itemSelectFields)
        .eq('owner_id', nextItem.owner_id)
        .eq('is_active', true)
        .neq('id', nextItem.id)
        .order('created_at', { ascending: false })
        .limit(12);

      if (ownerItemsResult.error) {
        setMessage(`Unable to load owner's other items: ${ownerItemsResult.error.message}`);
        setMessageTone('warning');
      }

      const bundleItems = ownerItemsResult.data || [];
      const bundleItemIds = bundleItems.map((ownerItem) => ownerItem.id);
      const ownerItemImagesResult = bundleItemIds.length
        ? await supabase
            .from('item_images')
            .select('id, item_id, image_url, is_primary, sort_order')
            .in('item_id', bundleItemIds)
            .order('sort_order', { ascending: true })
        : { data: [], error: null };

      if (ownerItemImagesResult.error) {
        setMessage(`Unable to load owner item images: ${ownerItemImagesResult.error.message}`);
        setMessageTone('warning');
      }

      const ownerItemImagesMap = new Map();

      (ownerItemImagesResult.data || []).forEach((image) => {
        const current = ownerItemImagesMap.get(image.item_id) || [];
        current.push(image);
        ownerItemImagesMap.set(image.item_id, current);
      });

      const bundleItemsWithImages = bundleItems.map((ownerItem) => {
        const images = (ownerItemImagesMap.get(ownerItem.id) || [])
          .slice()
          .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || Number(left.sort_order) - Number(right.sort_order));

        return {
          ...ownerItem,
          images,
          primaryImage: images[0] || null,
        };
      });

      setItem(nextItem);
      setItemImages(nextImages);
      setPrimaryRequestedQuantity(1);
      setOwnerOtherItems(bundleItemsWithImages);
      setSelectedBundleItemIds({});
      setBundleRequestedQuantities(
        bundleItemsWithImages.reduce((result, bundleItem) => {
          result[bundleItem.id] = 1;
          return result;
        }, {})
      );
      setAddons(addonRows);
      setAvailabilityBlocks(blocksResult.data || []);
      setAddonSelection(buildAddonState(addonRows));
      const storedRentalItemId = sessionStorage.getItem('rentalItemId');
      const storedCheckIn = sessionStorage.getItem('rentalCheckIn');
      const storedCheckOut = sessionStorage.getItem('rentalCheckOut');
      const query = new URLSearchParams(window.location.search);
      const queryCheckIn = query.get('check_in');
      const queryCheckOut = query.get('check_out');
      const queryStartDate = parseLocalDateTimeValue(queryCheckIn);
      const queryEndDate = parseLocalDateTimeValue(queryCheckOut);
      const hasUsableQueryRange = queryStartDate && queryEndDate && queryEndDate > queryStartDate;
      const storedStartDate = storedRentalItemId === itemId ? parseLocalDateTimeValue(storedCheckIn) : null;
      const storedEndDate = storedRentalItemId === itemId ? parseLocalDateTimeValue(storedCheckOut) : null;
      const hasUsableStoredRange =
        storedStartDate &&
        storedEndDate &&
        storedEndDate > storedStartDate &&
        storedStartDate >= addMinutes(new Date(), -SLOT_INTERVAL_MINUTES);

      setForm((current) => ({
        ...current,
        requested_start: hasUsableQueryRange
          ? formatDateTimeLocalValue(queryStartDate)
          : current.requested_start || (hasUsableStoredRange ? formatDateTimeLocalValue(storedStartDate) : ''),
        requested_end: hasUsableQueryRange
          ? formatDateTimeLocalValue(queryEndDate)
          : current.requested_end || (hasUsableStoredRange ? formatDateTimeLocalValue(storedEndDate) : ''),
      }));
      setLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [itemId, navigate]);

  const rentalDays = useMemo(() => {
    if (!form.requested_start || !form.requested_end) {
      return 0;
    }

    const startDate = new Date(form.requested_start);
    const endDate = new Date(form.requested_end);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return 0;
    }

    return calculateRentalDays(startDate.toISOString(), endDate.toISOString());
  }, [form.requested_end, form.requested_start]);

  const selectedBundleItems = useMemo(
    () =>
      ownerOtherItems
        .filter((ownerItem) => Boolean(selectedBundleItemIds[ownerItem.id]))
        .map((ownerItem) => ({
          ...ownerItem,
          requestedQuantity: Number(bundleRequestedQuantities[ownerItem.id]) || 1,
        })),
    [bundleRequestedQuantities, ownerOtherItems, selectedBundleItemIds]
  );

  const pricing = useMemo(() => {
    const rentalPricePerDay = roundMoney(item?.rental_price_per_day || 0);
    const securityDeposit = roundMoney(item?.security_deposit || 0);
    const normalizedPrimaryQuantity = Number(primaryRequestedQuantity) || 1;
    const rentalFeeTotal = roundMoney(rentalPricePerDay * rentalDays * normalizedPrimaryQuantity);
    const securityDepositTotal = roundMoney(securityDeposit * normalizedPrimaryQuantity);

    const bundleRentalFeeTotal = roundMoney(
      selectedBundleItems.reduce(
        (sum, bundleItem) => sum + roundMoney(Number(bundleItem.rental_price_per_day) * rentalDays * (Number(bundleItem.requestedQuantity) || 1)),
        0
      )
    );
    const bundleSecurityDepositTotal = roundMoney(
      selectedBundleItems.reduce(
        (sum, bundleItem) => sum + roundMoney((Number(bundleItem.security_deposit) || 0) * (Number(bundleItem.requestedQuantity) || 1)),
        0
      )
    );

    const addonTotal = roundMoney(
      addons.reduce((sum, addon) => {
        const selection = addonSelection[addon.id];

        if (!selection?.selected) {
          return sum;
        }

        const quantity = Number(selection.quantity) || 1;
        const price = Number(addon.price) || 0;
        const pricingType = String(addon.pricing_type || 'per_rental').toLowerCase();

        if (pricingType === 'per_day') {
          return sum + price * quantity * Math.max(1, rentalDays);
        }

        if (pricingType === 'per_quantity') {
          return sum + price * quantity;
        }

        return sum + price * quantity;
      }, 0)
    );

    const subtotalBeforeCommission = roundMoney(
      rentalFeeTotal + securityDepositTotal + bundleRentalFeeTotal + bundleSecurityDepositTotal + addonTotal
    );
    const commissionFee = roundMoney(subtotalBeforeCommission * COMMISSION_RATE);

    return {
      addonTotal,
      bundleRentalFeeTotal,
      bundleSecurityDepositTotal,
      commissionFee,
      rentalFeeTotal,
      rentalPricePerDay,
      securityDeposit,
      securityDepositTotal,
      subtotalBeforeCommission,
      totalDue: roundMoney(subtotalBeforeCommission + commissionFee),
    };
  }, [addonSelection, addons, item?.rental_price_per_day, item?.security_deposit, primaryRequestedQuantity, rentalDays, selectedBundleItems]);

  const selectedVoucher = useMemo(
    () => availableVouchers.find((voucher) => voucher.id === selectedVoucherId) || null,
    [availableVouchers, selectedVoucherId]
  );
  const voucherEligible = Boolean(
    selectedVoucher && pricing.rentalFeeTotal >= Number(selectedVoucher.minimum_rental_amount || 0)
  );
  const voucherDiscount = useMemo(() => {
    if (!selectedVoucher || !voucherEligible) return 0;
    const calculated = selectedVoucher.discount_type === 'percentage'
      ? pricing.rentalFeeTotal * Number(selectedVoucher.discount_value || 0) / 100
      : Number(selectedVoucher.discount_value || 0);
    return roundMoney(Math.min(calculated, pricing.rentalFeeTotal, pricing.totalDue));
  }, [pricing.rentalFeeTotal, pricing.totalDue, selectedVoucher, voucherEligible]);
  const checkoutTotalDue = roundMoney(pricing.totalDue - voucherDiscount);

  const selectedAddonsSummary = useMemo(() => {
    return addons
      .map((addon) => ({
        addon,
        selection: addonSelection[addon.id] || { quantity: 1, selected: false },
      }))
      .filter(({ addon, selection }) => selection.selected || addon.is_required)
      .map(({ addon, selection }) => {
        const quantity = Number(selection.quantity) || 1;
        const unitPrice = Number(addon.price) || 0;
        const pricingType = String(addon.pricing_type || 'per_rental').toLowerCase();
        const multiplier = pricingType === 'per_day' ? Math.max(1, rentalDays) : 1;
        const lineTotal = roundMoney(unitPrice * quantity * multiplier);

        return {
          id: addon.id,
          isRequired: Boolean(addon.is_required),
          lineTotal,
          name: addon.addon_name,
          pricingType,
          quantity,
          unitPrice: roundMoney(unitPrice),
        };
      });
  }, [addonSelection, addons, rentalDays]);

  const orderRows = useMemo(() => {
    if (!item) {
      return [];
    }

    const mainQuantity = Number(primaryRequestedQuantity) || 1;
    const mainRentalFee = roundMoney((Number(item.rental_price_per_day) || 0) * Math.max(0, rentalDays) * mainQuantity);
    const mainDeposit = roundMoney((Number(item.security_deposit) || 0) * mainQuantity);
    const mainImage = itemImages[0]?.image_url || '';

    const mainRow = {
      id: item.id,
      imageUrl: mainImage,
      isMain: true,
      itemType: 'Main item',
      maxQuantity: Math.max(1, Number(item.quantity) || 1),
      name: item.title,
      quantity: mainQuantity,
      total: roundMoney(mainRentalFee + mainDeposit),
    };

    const bundleRows = selectedBundleItems.map((bundleItem) => {
      const quantity = Number(bundleItem.requestedQuantity) || 1;
      const rentalFee = roundMoney((Number(bundleItem.rental_price_per_day) || 0) * Math.max(0, rentalDays) * quantity);
      const deposit = roundMoney((Number(bundleItem.security_deposit) || 0) * quantity);

      return {
        id: bundleItem.id,
        imageUrl: bundleItem.primaryImage?.image_url || '',
        isMain: false,
        itemType: 'Add-on listing',
        maxQuantity: Math.max(1, Number(bundleItem.quantity) || 1),
        name: bundleItem.title,
        quantity,
        total: roundMoney(rentalFee + deposit),
      };
    });

    return [mainRow, ...bundleRows];
  }, [item, itemImages, primaryRequestedQuantity, rentalDays, selectedBundleItems]);

  const rentIssues = useMemo(() => {
    const issues = [];

    if (!item) {
      return issues;
    }

    if (!userId) {
      issues.push('Sign in first.');
    }

    if (activeDamageHold) {
      issues.push('Your account has an active admin-approved damage hold. Settle the damage claim before renting another item.');
    }

    if (item.owner_id === userId) {
      issues.push('You cannot rent your own listing.');
    }

    if (!item.is_active) {
      issues.push('This listing is inactive.');
    }

    if (!isRentableStatus(item.status)) {
      issues.push('This listing is not available for booking yet.');
    }

    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 1) {
      issues.push('This listing has no quantity available.');
    }

    const normalizedPrimaryQuantity = Number(primaryRequestedQuantity);

    if (!Number.isInteger(normalizedPrimaryQuantity) || normalizedPrimaryQuantity < 1) {
      issues.push('Requested quantity must be at least 1 for the main item.');
    } else if (normalizedPrimaryQuantity > Number(item.quantity)) {
      issues.push(`Main item requested quantity cannot exceed ${Number(item.quantity)}.`);
    }

    if (!Number.isFinite(Number(item.rental_price_per_day)) || Number(item.rental_price_per_day) < 0) {
      issues.push('Rental price for this listing is invalid.');
    }

    if (!Number.isFinite(Number(item.security_deposit)) || Number(item.security_deposit) < 0) {
      issues.push('Security deposit for this listing is invalid.');
    }

    if (!Number.isInteger(Number(item.min_rental_days)) || Number(item.min_rental_days) < 1) {
      issues.push('Minimum rental days for this listing is invalid.');
    }

    if (
      item.max_rental_days !== null &&
      item.max_rental_days !== undefined &&
      (!Number.isInteger(Number(item.max_rental_days)) || Number(item.max_rental_days) < Number(item.min_rental_days || 1))
    ) {
      issues.push('Maximum rental days for this listing is invalid.');
    }

    return issues;
  }, [activeDamageHold, item, primaryRequestedQuantity, userId]);

  const canSubmit = !loading && !saving && item && rentIssues.length === 0;
  const requestedStartDate = useMemo(() => parseLocalDateTimeValue(form.requested_start), [form.requested_start]);
  const requestedEndDate = useMemo(() => parseLocalDateTimeValue(form.requested_end), [form.requested_end]);
  const selectedRangeBlocked = useMemo(() => {
    if (!requestedStartDate) {
      return null;
    }

    return dateOverlapsBlock(requestedStartDate, requestedEndDate, availabilityBlocks);
  }, [availabilityBlocks, requestedEndDate, requestedStartDate]);

  const hasValidSchedule = Boolean(requestedStartDate && requestedEndDate && rentalDays >= 1);
  const canSubmitRequest = canSubmit && hasValidSchedule && !selectedRangeBlocked;

  const bundleIssues = useMemo(() => {
    return selectedBundleItems.reduce((issues, bundleItem) => {
      if (!bundleItem.is_active) {
        issues.push(`${bundleItem.title} is inactive.`);
      }

      if (!isRentableStatus(bundleItem.status)) {
        issues.push(`${bundleItem.title} is not available for booking.`);
      }

      if (!Number.isFinite(Number(bundleItem.quantity)) || Number(bundleItem.quantity) < 1) {
        issues.push(`${bundleItem.title} has no available quantity.`);
      }

      const requestedQuantity = Number(bundleItem.requestedQuantity);

      if (!Number.isInteger(requestedQuantity) || requestedQuantity < 1) {
        issues.push(`${bundleItem.title} requested quantity must be at least 1.`);
      } else if (requestedQuantity > Number(bundleItem.quantity)) {
        issues.push(`${bundleItem.title} requested quantity cannot exceed ${Number(bundleItem.quantity)}.`);
      }

      return issues;
    }, []);
  }, [selectedBundleItems]);

  function handleFormChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handlePrimaryQuantityChange(nextQuantity) {
    const maxAvailable = Math.max(1, Number(item?.quantity) || 1);
    setPrimaryRequestedQuantity(clampRequestedQuantity(nextQuantity, maxAvailable));
  }

  function toggleBundleItem(itemToToggleId) {
    setSelectedBundleItemIds((current) => ({
      ...current,
      [itemToToggleId]: !current[itemToToggleId],
    }));
  }

  function handleBundleItemQuantityChange(itemToUpdateId, nextQuantity) {
    const bundleItem = ownerOtherItems.find((ownerItem) => ownerItem.id === itemToUpdateId);
    const maxAvailable = Math.max(1, Number(bundleItem?.quantity) || 1);
    const clamped = clampRequestedQuantity(nextQuantity, maxAvailable);

    setBundleRequestedQuantities((current) => ({
      ...current,
      [itemToUpdateId]: clamped,
    }));
  }

  function toggleAddon(addonId) {
    setAddonSelection((current) => {
      const selection = current[addonId] || { quantity: 1, selected: false };

      return {
        ...current,
        [addonId]: {
          ...selection,
          selected: !selection.selected,
        },
      };
    });
  }

  function setAddonQuantity(addonId, nextQuantity) {
    const quantity = clampRequestedQuantity(nextQuantity, Number.MAX_SAFE_INTEGER);
    setAddonSelection((current) => ({
      ...current,
      [addonId]: {
        ...(current[addonId] || { selected: true, quantity: 1 }),
        quantity,
      },
    }));
  }

  function openMobileNoteModal(title, content) {
    setMobileNoteModal({
      content,
      open: true,
      title,
    });
  }

  function openBundleQuantityModal(ownerItem) {
    const maxAvailable = Math.max(1, Number(ownerItem?.quantity) || 1);
    const existing = clampRequestedQuantity(bundleRequestedQuantities[ownerItem?.id], maxAvailable);
    setBundleQuantityModal({
      itemId: ownerItem?.id || '',
      open: true,
      quantity: existing,
    });
  }

  function closeBundleQuantityModal() {
    setBundleQuantityModal({ itemId: '', open: false, quantity: 1 });
  }

  function confirmBundleQuantityModal() {
    const ownerItem = ownerOtherItems.find((entry) => entry.id === bundleQuantityModal.itemId);
    if (!ownerItem) {
      closeBundleQuantityModal();
      return;
    }

    const maxAvailable = Math.max(1, Number(ownerItem.quantity) || 1);
    const clampedQuantity = clampRequestedQuantity(bundleQuantityModal.quantity, maxAvailable);

    setSelectedBundleItemIds((current) => ({
      ...current,
      [ownerItem.id]: true,
    }));
    setBundleRequestedQuantities((current) => ({
      ...current,
      [ownerItem.id]: clampedQuantity,
    }));
    closeBundleQuantityModal();
  }

  useEffect(() => {
    if (!item) {
      return;
    }

    const mainMax = Math.max(1, Number(item.quantity) || 1);
    setPrimaryRequestedQuantity((current) => clampRequestedQuantity(current, mainMax));

    setBundleRequestedQuantities((current) => {
      let changed = false;
      const next = { ...current };

      ownerOtherItems.forEach((bundleItem) => {
        const maxAvailable = Math.max(1, Number(bundleItem.quantity) || 1);
        const clamped = clampRequestedQuantity(next[bundleItem.id], maxAvailable);

        if (next[bundleItem.id] !== clamped) {
          next[bundleItem.id] = clamped;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [item, ownerOtherItems]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const query = new URLSearchParams(window.location.search);
    const paymentState = query.get('paymongo');

    if (paymentState !== 'cancelled') {
      return;
    }

    const bookingIds = String(query.get('booking_ids') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    let ignore = false;

    async function cancelPendingBookings() {
      if (bookingIds.length) {
        const { error: cancelError } = await supabase
          .from('bookings')
          .update({
            cancellation_reason: 'Payment cancelled in PayMongo checkout.',
            cancelled_by: userId,
            status: BOOKING_STATUS.CANCELLED,
          })
          .in('id', bookingIds)
          .eq('borrower_id', userId)
          .eq('status', BOOKING_STATUS.PENDING);

        if (!ignore) {
          if (cancelError) {
            setMessage(`Payment was cancelled. We could not automatically cancel pending booking(s): ${cancelError.message}`);
            setMessageTone('warning');
          } else {
            setMessage('Payment was cancelled. Pending booking request(s) were cancelled.');
            setMessageTone('warning');
          }
        }
      } else if (!ignore) {
        setMessage('Payment was cancelled.');
        setMessageTone('warning');
      }

      if (!ignore) {
        window.history.replaceState({}, '', `/user/rent-item/${itemId}`);
      }
    }

    cancelPendingBookings();

    return () => {
      ignore = true;
    };
  }, [itemId, userId]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!item || !userId) {
      return;
    }

    // Store rental dates in sessionStorage for next page
    sessionStorage.setItem('rentalCheckIn', form.requested_start);
    sessionStorage.setItem('rentalCheckOut', form.requested_end);
    sessionStorage.setItem('rentalItemId', item.id);
    sessionStorage.setItem('rentalDays', String(rentalDays));

    const createdBookingIds = [];
    const createdBookingSummaries = [];

    setSaving(true);
    setMessage('');

    try {
      if (rentIssues.length) {
        throw new Error(rentIssues[0]);
      }

      if (await userHasActiveDamageHold(userId)) {
        throw new Error('Your account has an active admin-approved damage hold. Settle the damage claim before renting another item.');
      }

      if (bundleIssues.length) {
        throw new Error(bundleIssues[0]);
      }

      if (selectedVoucher && !voucherEligible) {
        throw new Error(`This voucher requires at least ${currencyFormatter.format(Number(selectedVoucher.minimum_rental_amount || 0))} in rental fees.`);
      }

      if (selectedRangeBlocked) {
        throw new Error(`Your selected dates overlap with an owner block: ${formatBlockDateRange(selectedRangeBlocked)}.`);
      }

      const requestedStartDate = parseLocalDateTime(form.requested_start, 'Requested start');
      const requestedEndDate = parseLocalDateTime(form.requested_end, 'Requested end');

      if (requestedEndDate <= requestedStartDate) {
        throw new Error('Requested end must be later than requested start.');
      }

      const requestedStartIso = requestedStartDate.toISOString();
      const requestedEndIso = requestedEndDate.toISOString();
      const nextRentalDays = calculateRentalDays(requestedStartIso, requestedEndIso);

      if (nextRentalDays < 1) {
        throw new Error('Rental duration must be at least 1 day.');
      }

      const minDays = Number(item.min_rental_days || 1);
      const maxDays = item.max_rental_days === null || item.max_rental_days === undefined ? null : Number(item.max_rental_days);

      if (nextRentalDays < minDays) {
        throw new Error(`Minimum rental period is ${minDays} day(s).`);
      }

      if (maxDays !== null && nextRentalDays > maxDays) {
        throw new Error(`Maximum rental period is ${maxDays} day(s).`);
      }

      const allRequestedItems = [item, ...selectedBundleItems];

      const itemChecks = await Promise.all(
        allRequestedItems.map(async (requestedItem) => {
          const [blocksResult, existingBookingsResult] = await Promise.all([
            supabase
              .from('item_availability_blocks')
              .select('id, start_datetime, end_datetime, reason, block_type')
              .eq('item_id', requestedItem.id)
              .lt('start_datetime', requestedEndIso)
              .gt('end_datetime', requestedStartIso),
            supabase
              .from('bookings')
              .select('id, status, requested_start, requested_end')
              .eq('item_id', requestedItem.id)
              .lt('requested_start', requestedEndIso)
              .gt('requested_end', requestedStartIso),
          ]);

          return {
            blocksResult,
            existingBookingsResult,
            requestedItem,
          };
        })
      );

      itemChecks.forEach(({ blocksResult, existingBookingsResult, requestedItem }) => {
        if (blocksResult.error) {
          throw new Error(`Unable to validate availability blocks for ${requestedItem.title}: ${blocksResult.error.message}`);
        }

        if (existingBookingsResult.error) {
          throw new Error(`Unable to validate booking overlap for ${requestedItem.title}: ${existingBookingsResult.error.message}`);
        }

        if ((blocksResult.data || []).length) {
          throw new Error(`${requestedItem.title} overlaps with an availability block.`);
        }

        const conflictingBookings = (existingBookingsResult.data || []).filter((booking) => {
          const status = String(booking.status || '').toLowerCase();
          return !TERMINAL_BOOKING_STATUSES.has(status);
        });

        if (conflictingBookings.length) {
          throw new Error(`${requestedItem.title} overlaps with an existing booking request.`);
        }

        const itemMinDays = Number(requestedItem.min_rental_days || 1);
        const itemMaxDays =
          requestedItem.max_rental_days === null || requestedItem.max_rental_days === undefined
            ? null
            : Number(requestedItem.max_rental_days);

        if (nextRentalDays < itemMinDays) {
          throw new Error(`${requestedItem.title} requires at least ${itemMinDays} rental day(s).`);
        }

        if (itemMaxDays !== null && nextRentalDays > itemMaxDays) {
          throw new Error(`${requestedItem.title} allows up to ${itemMaxDays} rental day(s).`);
        }
      });

      const selectedAddons = addons
        .map((addon) => ({
          addon,
          selection: addonSelection[addon.id] || { quantity: 1, selected: false },
        }))
        .filter(({ addon, selection }) => selection.selected || addon.is_required)
        .map(({ addon, selection }) => {
          const quantity = parseWholeNumber(selection.quantity || 1, `${addon.addon_name} quantity`, 1);
          const pricingType = String(addon.pricing_type || 'per_rental').toLowerCase();
          const unitPrice = roundMoney(addon.price || 0);
          let totalAmount = unitPrice * quantity;

          if (pricingType === 'per_day') {
            totalAmount = unitPrice * quantity * nextRentalDays;
          }

          return {
            addon_name_snapshot: addon.addon_name,
            item_addon_id: addon.id,
            price_snapshot: unitPrice,
            pricing_type_snapshot: pricingType,
            quantity,
            total_amount: roundMoney(totalAmount),
          };
        });

      const mainQuantityNote = `Requested quantity for ${item.title}: ${Number(primaryRequestedQuantity) || 1}`;
      const bundleItemsNote = selectedBundleItems.length
        ? `Additional owner items: ${selectedBundleItems.map((bundleItem) => `${bundleItem.title} x${Number(bundleItem.requestedQuantity) || 1}`).join(', ')}`
        : '';
      const borrowerMessageBase = sanitizeText(form.borrower_message);
      const borrowerMessage = [borrowerMessageBase, mainQuantityNote, bundleItemsNote].filter(Boolean).join('\n');

      for (const requestedItem of allRequestedItems) {
        const requestedQuantity = requestedItem.id === item.id ? Number(primaryRequestedQuantity) || 1 : Number(requestedItem.requestedQuantity) || 1;
        const itemRentalPricePerDay = roundMoney(requestedItem.rental_price_per_day || 0);
        const itemSecurityDeposit = roundMoney((requestedItem.security_deposit || 0) * requestedQuantity);
        const itemRentalFeeTotal = roundMoney(itemRentalPricePerDay * nextRentalDays * requestedQuantity);
        const isPrimaryRequestedItem = requestedItem.id === item.id;
        const itemAddonsTotal = isPrimaryRequestedItem
          ? roundMoney(selectedAddons.reduce((sum, addon) => sum + addon.total_amount, 0))
          : 0;
        const itemSubtotal = roundMoney(itemRentalFeeTotal + itemSecurityDeposit + itemAddonsTotal);
        const itemCommissionFee = roundMoney(itemSubtotal * COMMISSION_RATE);
        const itemTotalDue = roundMoney(itemSubtotal + itemCommissionFee);

        const bookingPayload = {
          borrower_id: userId,
          borrower_message: borrowerMessage || null,
          item_id: requestedItem.id,
          owner_id: requestedItem.owner_id,
          rental_days: nextRentalDays,
          rental_fee_total: itemRentalFeeTotal,
          rental_price_per_day: itemRentalPricePerDay,
          requested_end: requestedEndIso,
          requested_start: requestedStartIso,
          security_deposit: itemSecurityDeposit,
          status: BOOKING_STATUS.PENDING,
          total_due: itemTotalDue,
        };

        const bookingResult = await supabase.from('bookings').insert(bookingPayload).select('id').single();

        if (bookingResult.error) {
          throw new Error(`Unable to create booking for ${requestedItem.title}: ${bookingResult.error.message}`);
        }

        const bookingId = bookingResult.data?.id;

        if (!bookingId) {
          throw new Error(`Unable to resolve booking id for ${requestedItem.title}.`);
        }

        createdBookingIds.push(bookingId);
        createdBookingSummaries.push({
          bookingId,
          commissionFee: itemCommissionFee,
          itemAddonsTotal,
          rentalDays: nextRentalDays,
          rentalFeeTotal: itemRentalFeeTotal,
          requestedEnd: requestedEndIso,
          requestedQuantity,
          requestedStart: requestedStartIso,
          securityDeposit: itemSecurityDeposit,
          title: requestedItem.title,
          totalDue: itemTotalDue,
        });

        const locationText = buildItemLocation(requestedItem) || 'Finalize meetup location with the owner in chat.';
        const meetupRow = {
          barangay: requestedItem.pickup_barangay || null,
          booking_id: bookingId,
          city: requestedItem.pickup_city || null,
          country: requestedItem.pickup_country || 'Philippines',
          location_text: locationText,
          meetup_type: 'pickup',
          province: requestedItem.pickup_province || null,
          region: requestedItem.pickup_region || null,
          scheduled_at: requestedStartIso,
          street: requestedItem.pickup_street || null,
        };

        const meetupsInsertResult = await supabase.from('booking_meetups').insert(meetupRow);

        if (meetupsInsertResult.error) {
          throw new Error(`Booking created for ${requestedItem.title}, but meetup schedule failed: ${meetupsInsertResult.error.message}`);
        }
      }

      if (createdBookingIds[0] && selectedAddons.length) {
        const addonRows = selectedAddons.map((addon) => ({
          ...addon,
          booking_id: createdBookingIds[0],
        }));

        const addonInsertResult = await supabase.from('booking_addons').insert(addonRows);

        if (addonInsertResult.error) {
          throw new Error(`Booking was created, but add-ons failed to save: ${addonInsertResult.error.message}`);
        }
      }

      if (selectedVoucherId && createdBookingIds[0]) {
        const { data: reservedDiscount, error: voucherError } = await supabase.rpc('reserve_reward_voucher_for_booking', {
          requested_booking_id: createdBookingIds[0],
          requested_voucher_id: selectedVoucherId,
        });

        if (voucherError) {
          throw new Error(`Unable to apply voucher: ${voucherError.message}`);
        }

        const appliedDiscount = roundMoney(reservedDiscount || 0);
        createdBookingSummaries[0].voucherDiscount = appliedDiscount;
        createdBookingSummaries[0].totalDue = roundMoney(createdBookingSummaries[0].totalDue - appliedDiscount);
      }

      const bookingIdsCsv = createdBookingIds.join(',');
      const successUrl = `${window.location.origin}/user/manage-booking?paymongo=success&booking_ids=${encodeURIComponent(bookingIdsCsv)}`;
      const cancelUrl = `${window.location.origin}/user/rent-item/${itemId}?paymongo=cancelled&booking_ids=${encodeURIComponent(bookingIdsCsv)}`;
      const checkoutLineItems = [
        {
          amount: roundMoney(createdBookingSummaries.reduce((sum, bookingSummary) => sum + (Number(bookingSummary.totalDue) || 0), 0)),
          description:
            createdBookingSummaries.length === 1
              ? joinCheckoutReceiptLines([
                  'Duration',
                  `${createdBookingSummaries[0].rentalDays} day(s)`,
                  'Quantity',
                  `${createdBookingSummaries[0].requestedQuantity}`,
                  'Schedule',
                  `${formatCheckoutDate(createdBookingSummaries[0].requestedStart)} to ${formatCheckoutDate(createdBookingSummaries[0].requestedEnd)}`,
                  'Rental fee',
                  `${currencyFormatter.format(createdBookingSummaries[0].rentalFeeTotal)}`,
                  'Security deposit',
                  `${currencyFormatter.format(createdBookingSummaries[0].securityDeposit)}`,
                  createdBookingSummaries[0].itemAddonsTotal > 0
                    ? 'Add-ons'
                    : null,
                  createdBookingSummaries[0].itemAddonsTotal > 0
                    ? `${currencyFormatter.format(createdBookingSummaries[0].itemAddonsTotal)}`
                    : null,
                  'Platform fee',
                  `${currencyFormatter.format(createdBookingSummaries[0].commissionFee)}`,
                ])
              : `${createdBookingSummaries.length} rental bookings • ${formatCheckoutDate(createdBookingSummaries[0].requestedStart)} to ${formatCheckoutDate(createdBookingSummaries[0].requestedEnd)}`,
          name: createdBookingSummaries.length === 1 ? createdBookingSummaries[0].title : 'Rental booking receipt',
          quantity: 1,
        },
      ];
      const checkoutDescription =
        createdBookingSummaries.length === 1
          ? `${createdBookingSummaries[0].title} receipt`
          : `${createdBookingSummaries.length} rental bookings receipt`;
      void checkoutLineItems;
      const paymongoContainerLineItems = createdBookingSummaries.flatMap((bookingSummary) => {
        const receiptContext = [
          bookingSummary.title,
          `${bookingSummary.rentalDays} day(s)`,
          `Qty ${bookingSummary.requestedQuantity}`,
          `${formatCheckoutDate(bookingSummary.requestedStart)} to ${formatCheckoutDate(bookingSummary.requestedEnd)}`,
        ].join(' • ');

        const discountedRentalFee = roundMoney(bookingSummary.rentalFeeTotal - (Number(bookingSummary.voucherDiscount) || 0));
        const lineItems = [];

        if (discountedRentalFee > 0) lineItems.push({
            amount: discountedRentalFee,
            description: receiptContext,
            name: `${bookingSummary.title} rental fee`,
            quantity: 1,
          });

        lineItems.push({
            amount: bookingSummary.securityDeposit,
            description: receiptContext,
            name: `${bookingSummary.title} security deposit`,
            quantity: 1,
          });

        if (bookingSummary.itemAddonsTotal > 0) {
          lineItems.push({
            amount: bookingSummary.itemAddonsTotal,
            description: receiptContext,
            name: `${bookingSummary.title} add-ons`,
            quantity: 1,
          });
        }

        lineItems.push({
          amount: bookingSummary.commissionFee,
          description: receiptContext,
          name: `${bookingSummary.title} platform fee`,
          quantity: 1,
        });

        return lineItems;
      });
      const checkoutSession = await createTestCheckoutSession({
        amount: roundMoney(createdBookingSummaries.reduce((sum, bookingSummary) => sum + (Number(bookingSummary.totalDue) || 0), 0)),
        cancelUrl,
        currency: 'PHP',
        description: checkoutDescription,
        lineItems: paymongoContainerLineItems,
        metadata: {
          booking_ids: bookingIdsCsv,
          borrower_id: userId,
          item_id: item.id,
          voucher_id: selectedVoucherId || '',
        },
        paymentMethodTypes: ['card', 'qrph'],
        showLineItems: true,
        successUrl,
      });

      const checkoutUrl = checkoutSession?.attributes?.checkout_url;

      if (!checkoutUrl) {
        throw new Error('PayMongo checkout URL could not be resolved.');
      }

      setMessage('Redirecting to PayMongo test checkout...');
      setMessageTone('info');
      window.location.assign(checkoutUrl);
    } catch (submitError) {
      if (createdBookingIds.length) {
        await supabase
          .from('bookings')
          .update({
            cancellation_reason: 'Automatic cancellation because payment checkout did not start.',
            cancelled_by: userId,
            status: BOOKING_STATUS.CANCELLED,
          })
          .in('id', createdBookingIds)
          .eq('borrower_id', userId)
          .eq('status', BOOKING_STATUS.PENDING);
      }

      setMessage(submitError.message || 'Unable to submit this rental request.');
      setMessageTone('warning');
    } finally {
      setSaving(false);
    }
  }

  const pickupLocation = useMemo(() => buildItemLocation(item), [item]);
  const activeBundleModalItem = useMemo(
    () => ownerOtherItems.find((entry) => entry.id === bundleQuantityModal.itemId) || null,
    [bundleQuantityModal.itemId, ownerOtherItems]
  );

  const marketplaceName = settings?.system_name || "Borrow Ko 'To";
  const profileName =
    [currentUserProfile?.first_name, currentUserProfile?.last_name].filter(Boolean).join(' ') ||
    currentUserProfile?.username ||
    'Your profile';

  function submitHeaderSearch(event) {
    event.preventDefault();
    const query = new URLSearchParams();
    const searchText = sanitizeText(headerSearch);

    if (searchText) query.set('q', searchText);
    if (headerBarangay !== 'all') query.set('barangay', headerBarangay);

    navigate(`/items${query.toString() ? `?${query.toString()}` : ''}`);
  }

  return (
    <div
      className="market-page rent-checkout-market-page"
      style={{
        '--market-primary': settings?.primary_color || '#173b8f',
        '--ui-primary-color': settings?.primary_color || '#173b8f',
        '--ui-primary-text-color': settings?.primary_text_color || '#ffffff',
        '--ui-background-color': settings?.tertiary_color || '#ffffff',
        '--ui-text-color': settings?.tertiary_text_color || '#18212e',
      }}
    >
      <header className="landing-nav rent-checkout-header">
        <button className="landing-brand" onClick={() => navigate('/')} type="button">
          <span className="landing-brand-mark">
            {settings?.logo_url ? <img alt="" src={settings.logo_url} /> : marketplaceName.slice(0, 2).toUpperCase()}
          </span>
          <strong>{marketplaceName}</strong>
        </button>

        <section className="landing-toolbar landing-toolbar-top">
          <div className="landing-search-row">
            <div className="landing-controls inline">
              <select aria-label="Filter by Baliuag barangay" onChange={(event) => setHeaderBarangay(event.target.value)} value={headerBarangay}>
                <option value="all">All barangays</option>
                {['Bagong Nayon', 'Barangca', 'Calantipay', 'Catulinan', 'Concepcion', 'Hinukay', 'Makinabang', 'Matangtubig', 'Pagala', 'Paitan', 'Piel', 'Pinagbarilan', 'Poblacion', 'Sabang', 'San Jose', 'San Roque', 'Santa Barbara', 'Santo Cristo', 'Santo Niño', 'Subic', 'Sulivan', 'Tangós', 'Tarcan', 'Tiaong', 'Tibag', 'Tilapayong', 'Virgen delas Flores'].map((barangay) => (
                  <option key={barangay} value={barangay}>{barangay}</option>
                ))}
              </select>
            </div>
            <form className="landing-search" onSubmit={submitHeaderSearch}>
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.4-3.4" /></svg>
              <input aria-label="Search rentals" onChange={(event) => setHeaderSearch(event.target.value)} placeholder="Search for items to borrow..." value={headerSearch} />
              <button type="submit">Search</button>
            </form>
          </div>
        </section>

        <nav aria-label="Main links" className="landing-nav-links">
          <button className="landing-filter-trigger" onClick={() => navigate('/?filters=open')} type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
            <span>Filters</span>
          </button>
          <button aria-label={profileName} className="landing-icon-btn signed-in" onClick={() => navigate('/user/dashboard')} title={profileName} type="button">
            {currentUserProfile?.profile_photo_url ? <img alt="" src={currentUserProfile.profile_photo_url} /> : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>}
          </button>
        </nav>
      </header>

      <main className="rent-checkout-public-main">
      <div className="rent-order-shell" style={{ display: 'grid', gap: 12 }}>
        {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
        {loading ? <StatusMessage tone="info">Loading rental form.</StatusMessage> : null}

        {!loading && item ? (
          <Panel
            className="rent-order-panel"
          >
            {rentIssues.length ? <StatusMessage tone="warning">{rentIssues[0]}</StatusMessage> : null}

            <form className="rent-checkout-layout" onSubmit={handleSubmit}>
              <div className="rent-mobile-stepper" aria-hidden="true">
                <div className="rent-mobile-step-item is-complete">
                  <span className="rent-mobile-step-dot">1</span>
                  <span>Cart</span>
                </div>
                <div className="rent-mobile-step-line" />
                <div className="rent-mobile-step-item is-active">
                  <span className="rent-mobile-step-dot">2</span>
                  <span>Delivery</span>
                </div>
                <div className="rent-mobile-step-line" />
                <div className="rent-mobile-step-item">
                  <span className="rent-mobile-step-dot">3</span>
                  <span>Payment</span>
                </div>
              </div>

              {/* Rental Summary Panel */}
              <aside className="rent-checkout-summary">
                <div
                  className="rent-checkout-summary-card"
                  style={{
                    background: alpha(theme.colors.panel, 0.96),
                    border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                  }}
                >
                  {/* Rental Price Header */}
                  <div style={{ display: 'grid', gap: 8 }}>
                    <span className="rent-order-summary-title" style={{ color: theme.colors.slate, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Order Summary
                    </span>
                    <div style={{ alignItems: 'baseline', display: 'flex', gap: 4 }}>
                      <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 28, letterSpacing: '-0.04em' }}>
                        {currencyFormatter.format(pricing.rentalPricePerDay)}
                      </strong>
                      <span style={{ color: theme.colors.slate, fontSize: 14 }}>/day</span>
                    </div>
                  </div>

                  {/* Check-in and Check-out Dates */}
                  <div className="rent-summary-date-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span style={{ color: theme.colors.slate, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        Check-in
                      </span>
                      <Input
                        className="rent-summary-date-input"
                        name="requested_start"
                        onChange={handleFormChange}
                        type="datetime-local"
                        value={form.requested_start || ''}
                      />
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span style={{ color: theme.colors.slate, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        Check-out
                      </span>
                      <Input
                        className="rent-summary-date-input"
                        min={form.requested_start || undefined}
                        name="requested_end"
                        onChange={handleFormChange}
                        type="datetime-local"
                        value={form.requested_end || ''}
                      />
                    </div>
                  </div>

                  {/* Pricing Breakdown */}
                  <div className="rent-checkout-total-list">
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: theme.colors.slate, fontSize: 13 }}>Rental days</span>
                      <strong style={{ color: theme.colors.ink, fontSize: 13 }}>{rentalDays || 0}</strong>
                    </div>
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                        {currencyFormatter.format(pricing.rentalPricePerDay)} × {rentalDays || 0} day(s)
                      </span>
                      <strong style={{ color: theme.colors.ink, fontSize: 13 }}>
                        {currencyFormatter.format(pricing.rentalFeeTotal)}
                      </strong>
                    </div>
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: theme.colors.slate, fontSize: 13 }}>Security Deposit</span>
                      <strong style={{ color: theme.colors.ink, fontSize: 13 }}>
                        {currencyFormatter.format(pricing.securityDepositTotal)}
                      </strong>
                    </div>
                    {selectedBundleItems.length ? (
                      <>
                        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: theme.colors.slate, fontSize: 13 }}>Additional items rental fee</span>
                          <strong style={{ color: theme.colors.ink, fontSize: 13 }}>{currencyFormatter.format(pricing.bundleRentalFeeTotal)}</strong>
                        </div>
                        <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: theme.colors.slate, fontSize: 13 }}>Additional items deposit</span>
                          <strong style={{ color: theme.colors.ink, fontSize: 13 }}>{currencyFormatter.format(pricing.bundleSecurityDepositTotal)}</strong>
                        </div>
                      </>
                    ) : null}
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: theme.colors.slate, fontSize: 13 }}>Add-ons total</span>
                      <strong style={{ color: theme.colors.ink, fontSize: 13 }}>{currencyFormatter.format(pricing.addonTotal)}</strong>
                    </div>
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: theme.colors.slate, fontSize: 13 }}>Subtotal (before commission)</span>
                      <strong style={{ color: theme.colors.ink, fontSize: 13 }}>{currencyFormatter.format(pricing.subtotalBeforeCommission)}</strong>
                    </div>
                    <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: theme.colors.slate, fontSize: 13 }}>Commission fee (15%)</span>
                      <strong style={{ color: theme.colors.ink, fontSize: 13 }}>{currencyFormatter.format(pricing.commissionFee)}</strong>
                    </div>
                    <div className="rent-voucher-field">
                      <label htmlFor="checkout-voucher">Reward voucher</label>
                      <select id="checkout-voucher" onChange={(event) => setSelectedVoucherId(event.target.value)} value={selectedVoucherId}>
                        <option value="">No voucher</option>
                        {availableVouchers.map((voucher) => {
                          const minimum = Number(voucher.minimum_rental_amount || 0);
                          const eligible = pricing.rentalFeeTotal >= minimum;
                          return <option disabled={!eligible} key={voucher.id} value={voucher.id}>{voucher.reward_voucher_catalog?.name || voucher.code}{eligible ? '' : ` · Min. ${currencyFormatter.format(minimum)}`}</option>;
                        })}
                      </select>
                      {!availableVouchers.length ? <small>No available vouchers. Redeem one from Rewards.</small> : null}
                    </div>
                    {voucherDiscount > 0 ? <div className="rent-voucher-discount"><span>Voucher discount</span><strong>−{currencyFormatter.format(voucherDiscount)}</strong></div> : null}
                    <div
                      style={{
                        alignItems: 'center',
                        background: alpha(theme.colors.teal, 0.08),
                        border: `1px solid ${alpha(theme.colors.teal, 0.18)}`,
                        borderRadius: 8,
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                      }}
                    >
                      <span style={{ color: theme.colors.teal, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Total due
                      </span>
                      <strong style={{ color: theme.colors.teal, fontFamily: theme.fonts.display, fontSize: 18 }}>
                        {currencyFormatter.format(checkoutTotalDue)}
                      </strong>
                    </div>
                  </div>

                  {/* Action Button */}
                  <Button
                    className="rent-summary-place-order"
                    disabled={!canSubmitRequest}
                    type="submit"
                    style={{ width: '100%', minHeight: 48, fontWeight: 700 }}
                  >
                    {saving ? 'Placing order...' : 'Place Order'}
                  </Button>

                  <Button className="rent-summary-cancel" onClick={() => navigate(`/items/${itemId}`)} type="button" variant="ghost">
                    Cancel
                  </Button>

                  <span className="rent-summary-disclaimer" style={{ color: theme.colors.slate, fontSize: 12, textAlign: 'center' }}>You will be redirected to PayMongo checkout after submission.</span>
                </div>
              </aside>

              {/* Main Form Content */}
              <div className="rent-checkout-main">
              <div
                className="rent-order-hero"
                style={{
                  background: `linear-gradient(135deg, ${alpha(theme.colors.teal, 0.09)}, ${alpha(theme.colors.teal, 0.04)})`,
                  border: `1px solid ${alpha(theme.colors.teal, 0.2)}`,
                  borderRadius: 14,
                  display: 'grid',
                  gap: 10,
                  padding: '16px 18px',
                }}
              >
                <div style={{ alignItems: 'flex-start', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 20, letterSpacing: '-0.03em' }}>
                      Rent {item.title}
                    </strong>
                    <div className="rent-order-hero-meta">
                      <span className="rent-order-hero-price-pill" style={{
                        background: alpha(theme.colors.teal, 0.12),
                        borderRadius: 6,
                        color: theme.colors.teal,
                        fontSize: 13,
                        fontWeight: 700,
                        padding: '3px 9px',
                      }}>
                        {currencyFormatter.format(Number(item.rental_price_per_day) || 0)}/day
                      </span>
                      <span className="rent-order-hero-deposit" style={{ color: theme.colors.slate, fontSize: 13 }}>
                        Deposit {currencyFormatter.format(Number(item.security_deposit) || 0)} each
                      </span>
                    </div>
                    <span className="rent-order-hero-limit" style={{ color: theme.colors.slate, fontSize: 13 }}>
                      {buildRentalDayLimitNote(item)}
                    </span>
                  </div>
                  {rentalDays > 0 ? (
                    <Badge tone="success">{rentalDays} day{rentalDays === 1 ? '' : 's'} selected</Badge>
                  ) : (
                    <Badge tone="neutral">Select your dates below</Badge>
                  )}
                </div>
              </div>

              <div
                className="rent-order-section"
                style={{
                  background: alpha(theme.colors.panel, 0.92),
                  border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                  borderRadius: 12,
                  display: 'grid',
                  gap: 12,
                  padding: 18,
                }}
              >
                <div style={{ borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`, paddingBottom: 8 }}>
                  <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 22, letterSpacing: '-0.02em' }}>
                    Order Items
                  </strong>
                </div>
                <div className="rent-order-table-wrap">
                  <table className="rent-order-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="rent-order-qty-col">Qty</th>
                        <th>Price</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderRows.map((row) => (
                        <tr key={row.id}>
                          <td data-label="Item">
                            <div className="rent-order-item-cell">
                              <div className="rent-order-item-image">
                                {row.imageUrl ? <img alt={row.name} src={row.imageUrl} /> : null}
                              </div>
                              <div className="rent-order-item-meta">
                                <strong>{row.name}</strong>
                                <span>{row.itemType}</span>
                              </div>
                            </div>
                          </td>
                          <td className="rent-order-qty-col" data-label="Qty">
                            <Input
                              className="rent-order-qty-input"
                              max={row.maxQuantity}
                              min={1}
                              onChange={(event) =>
                                row.isMain
                                  ? handlePrimaryQuantityChange(event.target.value)
                                  : handleBundleItemQuantityChange(row.id, event.target.value)
                              }
                              style={{ minHeight: 36, padding: '0 8px', textAlign: 'center', width: 76 }}
                              type="number"
                              value={row.quantity}
                            />
                          </td>
                          <td data-label="Price">{currencyFormatter.format(row.total)}</td>
                          <td data-label="Action">
                            {row.isMain ? (
                              <span style={{ color: theme.colors.muted, fontSize: 12 }}>Required</span>
                            ) : (
                              <button
                                aria-label={`Remove ${row.name}`}
                                className="rent-order-remove-btn"
                                onClick={() => toggleBundleItem(row.id)}
                                style={{
                                  background: 'transparent',
                                  border: `1px solid ${alpha(theme.colors.danger, 0.24)}`,
                                  borderRadius: 8,
                                  color: theme.colors.danger,
                                  cursor: 'pointer',
                                  minHeight: 32,
                                  minWidth: 32,
                                  padding: 0,
                                }}
                                type="button"
                              >
                                <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4h8v2" />
                                  <path d="M7 6l1 14h8l1-14" />
                                  <path d="M10 11v6M14 11v6" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedAddonsSummary.length ? (
                <div
                  className="rent-order-section"
                  style={{
                    background: alpha(theme.colors.panel, 0.92),
                    border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                    borderRadius: 12,
                    display: 'grid',
                    gap: 10,
                    padding: 18,
                  }}
                >
                  <div style={{ borderBottom: `1px solid ${alpha(theme.colors.ink, 0.08)}`, paddingBottom: 8 }}>
                    <strong style={{ color: theme.colors.ink, fontFamily: theme.fonts.display, fontSize: 19, letterSpacing: '-0.02em' }}>
                      Selected Add-ons
                    </strong>
                  </div>
                  <div className="rent-order-addon-list">
                    {selectedAddonsSummary.map((addon) => (
                      <div className="rent-order-addon-row" key={addon.id}>
                        <div>
                          <strong>{addon.name}</strong>
                          <span>
                            {currencyFormatter.format(addon.unitPrice)} x {addon.quantity} ({addon.pricingType.replace('_', ' ')})
                          </span>
                        </div>
                        <div style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
                          <strong>{currencyFormatter.format(addon.lineTotal)}</strong>
                          {addon.isRequired ? (
                            <span style={{ color: theme.colors.muted, fontSize: 12 }}>Required</span>
                          ) : (
                            <button
                              aria-label={`Remove ${addon.name}`}
                              className="rent-order-remove-btn"
                              onClick={() => toggleAddon(addon.id)}
                              style={{
                                background: 'transparent',
                                border: `1px solid ${alpha(theme.colors.danger, 0.24)}`,
                                borderRadius: 8,
                                color: theme.colors.danger,
                                cursor: 'pointer',
                                minHeight: 30,
                                minWidth: 30,
                                padding: 0,
                              }}
                              type="button"
                            >
                              <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="15">
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M7 6l1 14h8l1-14" />
                                <path d="M10 11v6M14 11v6" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {ownerOtherItems.length ? (
                <div
                  className="rent-order-section"
                  style={{
                    background: alpha(theme.colors.panel, 0.92),
                    border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                    borderRadius: 12,
                    display: 'grid',
                    gap: 10,
                    padding: 16,
                  }}
                >
                  <div className="rent-owner-list-header" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                    <span style={{ color: theme.colors.ink, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Add from owner's other listings
                    </span>
                    <Badge tone="neutral">{selectedBundleItems.length} selected</Badge>
                  </div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    {ownerOtherItems.map((ownerItem) => {
                      const selected = Boolean(selectedBundleItemIds[ownerItem.id]);
                      const rentalLimitNote = buildRentalDayLimitNote(ownerItem);
                      const matchesSelectedDays = isRentalDayCountAllowed(ownerItem, rentalDays);
                      const disableAddForDays = rentalDays > 0 && !matchesSelectedDays;

                      return (
                        <div
                          className="rent-owner-item-row"
                          key={ownerItem.id}
                          style={{
                            alignItems: 'center',
                            background: alpha(theme.colors.panel, 0.86),
                            border: `1px solid ${alpha(theme.colors.ink, selected ? 0.2 : 0.08)}`,
                            borderRadius: 8,
                            display: 'grid',
                            gap: 10,
                            gridTemplateColumns: 'auto 48px minmax(0, 1fr) auto',
                            padding: 10,
                          }}
                        >
                          <button
                            className="rent-owner-add-btn"
                            disabled={disableAddForDays}
                            onClick={() => openBundleQuantityModal(ownerItem)}
                            style={{
                              alignItems: 'center',
                              background: selected ? alpha(theme.colors.teal, 0.14) : 'transparent',
                              border: `1px solid ${selected ? alpha(theme.colors.teal, 0.42) : alpha(theme.colors.ink, 0.18)}`,
                              borderRadius: 8,
                              color: selected ? theme.colors.teal : theme.colors.ink,
                              cursor: disableAddForDays ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              fontSize: 12,
                              fontWeight: 700,
                              justifyContent: 'center',
                              minHeight: 32,
                              minWidth: 56,
                              opacity: disableAddForDays ? 0.55 : 1,
                              padding: '0 10px',
                            }}
                            type="button"
                          >
                            {selected ? 'Edit' : 'Add'}
                          </button>

                          <div
                            className="rent-owner-item-thumb"
                            style={{
                              background: ownerItem.primaryImage?.image_url
                                ? `url(${ownerItem.primaryImage.image_url}) center/cover`
                                : alpha(theme.colors.ink, 0.06),
                              border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                              borderRadius: 6,
                              height: 48,
                              width: 48,
                            }}
                          />

                          <div className="rent-owner-item-meta" style={{ display: 'grid', gap: 3, minWidth: 0 }}>
                            <div className="rent-owner-item-title-row">
                              <strong style={{ color: theme.colors.ink, fontSize: 14 }}>{ownerItem.title}</strong>
                            <button
                              aria-label={`View details for ${ownerItem.title}`}
                              className="rent-owner-note-btn"
                              onClick={() =>
                                openMobileNoteModal(
                                  ownerItem.title,
                                  [
                                    `${currencyFormatter.format(Number(ownerItem.rental_price_per_day) || 0)}/day`,
                                    `Deposit ${currencyFormatter.format(Number(ownerItem.security_deposit) || 0)} each`,
                                    rentalLimitNote,
                                    rentalDays > 0
                                      ? matchesSelectedDays
                                        ? `Selected period (${rentalDays} day(s)) fits this item.`
                                        : `Selected period (${rentalDays} day(s)) does not fit this item's allowed days.`
                                      : 'Select dates to validate.',
                                    selected
                                      ? `Deposit total: ${currencyFormatter.format((Number(ownerItem.security_deposit) || 0) * (Number(bundleRequestedQuantities[ownerItem.id]) || 1))}`
                                      : '',
                                  ]
                                    .filter(Boolean)
                                    .join('\n')
                                )
                              }
                              type="button"
                              >
                                <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
                                  <path d="M12 16v.01" />
                                  <path d="M12 8a2 2 0 1 1 2 2c-.9 0-2 .6-2 2" />
                                  <circle cx="12" cy="12" r="10" />
                                </svg>
                              </button>
                            </div>
                            <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                              {currencyFormatter.format(Number(ownerItem.rental_price_per_day) || 0)}/day • Deposit {currencyFormatter.format(Number(ownerItem.security_deposit) || 0)} each
                            </span>
                            <span style={{ color: matchesSelectedDays ? theme.colors.slate : theme.colors.warning, fontSize: 12 }}>
                              {rentalLimitNote}
                            </span>
                            {rentalDays > 0 ? (
                              <span style={{ color: matchesSelectedDays ? theme.colors.success : theme.colors.warning, fontSize: 12 }}>
                                {matchesSelectedDays
                                  ? `Selected period (${rentalDays} day(s)) fits this item.`
                                  : `Selected period (${rentalDays} day(s)) does not fit this item's allowed days.`}
                              </span>
                            ) : (
                              <span style={{ color: theme.colors.slate, fontSize: 12 }}>Select dates to validate.</span>
                            )}
                            {selected ? (
                              <span style={{ color: theme.colors.slate, fontSize: 12 }}>
                                Deposit total: {currencyFormatter.format((Number(ownerItem.security_deposit) || 0) * (Number(bundleRequestedQuantities[ownerItem.id]) || 1))}
                              </span>
                            ) : null}
                          </div>

                          <div className="rent-owner-item-controls" style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                            <Input
                              disabled={!selected}
                              max={Number(ownerItem.quantity) || 1}
                              min={1}
                              onChange={(event) => handleBundleItemQuantityChange(ownerItem.id, event.target.value)}
                              style={{ borderRadius: 12, minHeight: 38, padding: '0 10px', width: 84 }}
                              type="number"
                              value={bundleRequestedQuantities[ownerItem.id] || 1}
                            />
                            <Badge tone="info">{Number(ownerItem.quantity) || 0} available</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedRangeBlocked ? (
                <StatusMessage tone="warning">
                  Selected dates overlap an owner block: {formatBlockDateRange(selectedRangeBlocked)}.
                </StatusMessage>
              ) : null}

              {bundleIssues.length ? <StatusMessage tone="warning">{bundleIssues[0]}</StatusMessage> : null}

              {availabilityBlocks.length ? (
                <div
                  style={{
                    background: alpha(theme.colors.warning, 0.04),
                    border: `1px solid ${alpha(theme.colors.warning, 0.18)}`,
                    borderRadius: 12,
                    display: 'grid',
                    gap: 8,
                    padding: 14,
                  }}
                >
                  <span style={{ color: theme.colors.warning, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Owner blocked dates
                  </span>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {availabilityBlocks.slice(0, 6).map((block) => (
                      <span key={block.id} style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.5 }}>
                        {formatBlockDateRange(block)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div
                className="rent-order-section"
                style={{
                  background: alpha(theme.colors.panel, 0.92),
                  border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                  borderRadius: 12,
                  display: 'grid',
                  gap: 12,
                  padding: 18,
                }}
              >
                <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                  <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                    <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={{ color: theme.colors.teal, flexShrink: 0 }} viewBox="0 0 24 24" width="15">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span style={{ color: theme.colors.ink, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Pickup location
                    </span>
                  </div>
                  {item.meetup_notes ? (
                    <span className="rent-meetup-note-icon" role="note" tabIndex={0}>
                      <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
                        <path d="M8 3h8l4 4v14H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                        <path d="M16 3v4h4" />
                        <path d="M10 12h6M10 16h6M10 8h2" />
                      </svg>
                      <span className="rent-meetup-note-tooltip">{item.meetup_notes}</span>
                    </span>
                  ) : null}
                </div>
                <span style={{ color: theme.colors.slate, fontSize: 14, lineHeight: 1.6 }}>
                  {pickupLocation || 'No pickup location details are set yet.'}
                </span>
              </div>

              <div
                className="rent-order-section"
                style={{
                  background: alpha(theme.colors.panel, 0.92),
                  border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                  borderRadius: 12,
                  display: 'grid',
                  gap: 14,
                  padding: 18,
                }}
              >
                <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                  <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" style={{ color: theme.colors.teal, flexShrink: 0 }} viewBox="0 0 24 24" width="15">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span style={{ color: theme.colors.ink, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Message to owner
                  </span>
                </div>
                <FormField hint="Add notes for dates, handling, or meetup preferences.">
                  <Textarea name="borrower_message" onChange={handleFormChange} placeholder="Hi, I need this for a weekend event and can pick up at your preferred time." value={form.borrower_message} />
                </FormField>
              </div>

              {addons.length ? (
                <div
                  className="rent-order-section"
                  style={{
                    background: alpha(theme.colors.panel, 0.92),
                    border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
                    borderRadius: 12,
                    display: 'grid',
                    gap: 12,
                    padding: 18,
                  }}
                >
                  <span style={{ color: theme.colors.ink, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Add-ons
                  </span>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {addons.map((addon) => {
                      const selection = addonSelection[addon.id] || { quantity: 1, selected: false };
                      const pricingLabel = String(addon.pricing_type || 'per_rental').replace('_', ' ');

                      return (
                        <label
                          className="rent-addon-option-row"
                          key={addon.id}
                          style={{
                            alignItems: 'center',
                            background: alpha(theme.colors.ink, 0.025),
                            border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                            borderRadius: 8,
                            display: 'grid',
                            gap: 12,
                            gridTemplateColumns: 'auto minmax(0, 1fr) 82px',
                            padding: 10,
                          }}
                        >
                          <input
                            checked={selection.selected || addon.is_required}
                            disabled={addon.is_required}
                            onChange={() => toggleAddon(addon.id)}
                            type="checkbox"
                          />
                          <div style={{ display: 'grid', gap: 4 }}>
                            <strong style={{ color: theme.colors.ink, fontSize: 14 }}>{addon.addon_name}</strong>
                            <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                              {currencyFormatter.format(Number(addon.price) || 0)} ({pricingLabel}) {addon.is_required ? '- required' : ''}
                            </span>
                          </div>
                          <Input
                            disabled={!(selection.selected || addon.is_required)}
                            min={1}
                            onChange={(event) => setAddonQuantity(addon.id, event.target.value)}
                            type="number"
                            value={selection.quantity}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
              </div>

              <div className="rent-mobile-paybar" role="region" aria-label="Checkout payment actions">
                <div className="rent-mobile-paybar-total">
                  <span>Total Payment</span>
                  <strong>{currencyFormatter.format(pricing.totalDue)}</strong>
                </div>
                <Button
                  className="rent-mobile-paybar-submit"
                  disabled={!canSubmitRequest}
                  type="submit"
                >
                  {saving ? 'Placing order...' : 'Place Order'}
                </Button>
              </div>
            </form>
          </Panel>
        ) : null}

        <Modal
          actions={
            <>
              <Button className="rent-modal-cancel" onClick={closeBundleQuantityModal} type="button" variant="ghost">
                Cancel
              </Button>
              <Button className="rent-modal-primary" disabled={!activeBundleModalItem} onClick={confirmBundleQuantityModal} type="button">
                Add item
              </Button>
            </>
          }
          contentClassName="rent-bundle-modal"
          onClose={closeBundleQuantityModal}
          open={bundleQuantityModal.open}
          size="compact"
          title={activeBundleModalItem ? `Add ${activeBundleModalItem.title}` : 'Add item'}
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: theme.colors.slate, fontSize: 14 }}>Available stock</span>
              <strong style={{ color: theme.colors.ink, fontSize: 14 }}>{Math.max(0, Number(activeBundleModalItem?.quantity) || 0)}</strong>
            </div>
            <FormField label="Quantity">
              <Input
                className="rent-bundle-quantity-input"
                max={Math.max(1, Number(activeBundleModalItem?.quantity) || 1)}
                min={1}
                onChange={(event) =>
                  setBundleQuantityModal((current) => ({
                    ...current,
                    quantity: clampRequestedQuantity(event.target.value, Math.max(1, Number(activeBundleModalItem?.quantity) || 1)),
                  }))
                }
                type="number"
                value={bundleQuantityModal.quantity}
              />
            </FormField>
          </div>
        </Modal>

        <Modal
          actions={
            <Button onClick={() => setMobileNoteModal({ content: '', open: false, title: '' })} variant="ghost">
              Close
            </Button>
          }
          contentClassName="rent-mobile-note-modal"
          onClose={() => setMobileNoteModal({ content: '', open: false, title: '' })}
          open={mobileNoteModal.open}
          size="compact"
          title={mobileNoteModal.title || 'Item details'}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            {String(mobileNoteModal.content || '')
              .split('\n')
              .filter(Boolean)
              .map((line, index) => (
                <span key={`${line}-${index}`} style={{ color: theme.colors.slate, fontSize: 14, lineHeight: 1.5 }}>
                  {line}
                </span>
              ))}
          </div>
        </Modal>
      </div>
      </main>
    </div>
  );
}


