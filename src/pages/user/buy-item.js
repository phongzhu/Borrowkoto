import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import TermsModal from '../../components/TermsModal';
import { loadActiveTerms } from '../../services/termsService';
import { createTestCheckoutSession } from '../../services/transaction';
import { Badge, Button, FormField, Input, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { sanitizeText } from '../../ui/profileFormUtils';
import {
  buildPurchaseAddonState,
  calculatePurchaseTotals,
  clampPurchaseQuantity,
  selectPurchaseAddons,
} from '../../utils/purchaseCheckout';
import { isMarketplaceOwnerActive } from '../../utils/marketplaceVisibility';
import { useUISettings } from '../../context/UISettingsContext';
import '../../App.css';
import './rent-item-datepicker.css';
import './buy-item.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const itemSelectFields =
  'id, owner_id, title, description, item_condition, is_for_sale, sale_price, sale_inclusions, quantity, pickup_street, pickup_region, pickup_barangay, pickup_city, pickup_province, pickup_country, pickup_time, return_time, meetup_notes, status, is_active';

function buildItemLocation(item) {
  return [item?.pickup_street, item?.pickup_barangay, item?.pickup_city, item?.pickup_province, item?.pickup_region, item?.pickup_country]
    .filter(Boolean)
    .join(', ');
}

function formatDateTimeLocalValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function normalizeListingTime(value, fallback) {
  const normalized = String(value || fallback).slice(0, 5);
  return /^\d{2}:\d{2}$/.test(normalized) ? normalized : fallback;
}

function applyListingTime(value, listingTime) {
  const day = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T${listingTime}` : '';
}

function getMinimumScheduledPickup(listingTime) {
  const now = new Date();
  const candidate = new Date(applyListingTime(formatDateTimeLocalValue(now), listingTime));
  if (candidate.getTime() <= now.getTime() + (30 * 60 * 1000)) candidate.setDate(candidate.getDate() + 1);
  return formatDateTimeLocalValue(candidate);
}

function normalizePickupDate(value) {
  const text = sanitizeText(value);
  if (!text) throw new Error('Preferred pickup date is required.');
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error('Preferred pickup date is invalid.');
  if (date <= new Date()) throw new Error('Preferred pickup must be in the future.');
  return date;
}

export default function BuyItem() {
  const navigate = useNavigate();
  const { itemId } = useParams();
  const { settings } = useUISettings();
  const [userId, setUserId] = useState('');
  const [profile, setProfile] = useState(null);
  const [item, setItem] = useState(null);
  const [itemImages, setItemImages] = useState([]);
  const [addons, setAddons] = useState([]);
  const [addonSelection, setAddonSelection] = useState({});
  const [itemQuantity, setItemQuantity] = useState(1);
  const [preferredPickup, setPreferredPickup] = useState('');
  const [buyerMessage, setBuyerMessage] = useState('');
  const [headerSearch, setHeaderSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [termsDocument, setTermsDocument] = useState(null);
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsError, setTermsError] = useState('');
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsViewed, setTermsViewed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    let ignore = false;
    setTermsLoading(true);
    setTermsError('');

    loadActiveTerms()
      .then((document) => {
        if (ignore) return;
        setTermsDocument(document);
        if (!document) setTermsError('Purchase checkout is unavailable until the administrator publishes Terms and Conditions.');
      })
      .catch((error) => {
        if (!ignore) setTermsError(error.message || 'Unable to load the current Terms and Conditions.');
      })
      .finally(() => {
        if (!ignore) setTermsLoading(false);
      });

    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCheckout() {
      setLoading(true);
      setMessage('');

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!mounted) return;
      if (userError || !user?.id) {
        navigate('/login');
        return;
      }
      setUserId(user.id);

      const query = new URLSearchParams(window.location.search);
      const cancelledRequestId = query.get('purchase_request_id');
      if (query.get('paymongo') === 'cancelled' && cancelledRequestId) {
        const cancelResult = await supabase.rpc('cancel_item_purchase_checkout', { p_request_id: cancelledRequestId });
        if (!mounted) return;
        if (cancelResult.error) {
          setMessage(`Payment was cancelled, but inventory could not be released: ${cancelResult.error.message}`);
          setMessageTone('warning');
        } else {
          setMessage('Payment was cancelled. Your reserved items were released and you can review the order again.');
          setMessageTone('info');
        }
        window.history.replaceState({}, '', `/user/buy-item/${itemId}`);
      }

      const [itemResult, addonsResult, imagesResult, profileResult] = await Promise.all([
        supabase.from('items').select(itemSelectFields).eq('id', itemId).maybeSingle(),
        supabase
          .from('item_addons')
          .select('id, item_id, addon_name, description, price, pricing_type, quantity, is_required, image_url, is_active, sort_order')
          .eq('item_id', itemId)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('item_images')
          .select('id, image_url, is_primary, sort_order')
          .eq('item_id', itemId)
          .order('sort_order', { ascending: true }),
        supabase
          .from('profiles')
          .select('id, first_name, last_name, username, profile_photo_url, account_status, is_profile_complete, nub_registry_managed')
          .eq('id', user.id)
          .maybeSingle(),
      ]);

      if (!mounted) return;
      const loadError = itemResult.error || addonsResult.error || imagesResult.error || profileResult.error;
      if (loadError) {
        setMessage(`Unable to load purchase checkout: ${loadError.message}`);
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

      const ownerProfileResult = await supabase
        .from('profiles')
        .select('id, account_status')
        .eq('id', itemResult.data.owner_id)
        .maybeSingle();
      if (!mounted) return;

      if (ownerProfileResult.error || !isMarketplaceOwnerActive(ownerProfileResult.data)) {
        setMessage('This listing is unavailable because the seller account is not active.');
        setMessageTone('warning');
        setLoading(false);
        return;
      }

      const sortedImages = (imagesResult.data || [])
        .slice()
        .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || Number(left.sort_order) - Number(right.sort_order));
      const addonRows = addonsResult.data || [];

      setProfile(profileResult.data || null);
      setItem(itemResult.data);
      setItemImages(sortedImages);
      setAddons(addonRows);
      setAddonSelection(buildPurchaseAddonState(addonRows));
      setItemQuantity(1);
      setLoading(false);
    }

    loadCheckout();
    return () => { mounted = false; };
  }, [itemId, navigate]);

  const selectedAddons = useMemo(
    () => selectPurchaseAddons(addons, addonSelection),
    [addonSelection, addons]
  );
  const pricing = useMemo(
    () => calculatePurchaseTotals({ addonRows: selectedAddons, itemQuantity, salePrice: item?.sale_price }),
    [item?.sale_price, itemQuantity, selectedAddons]
  );
  const orderRows = useMemo(() => {
    if (!item) return [];
    return [
      {
        description: item.sale_inclusions || item.description || '',
        id: item.id,
        imageUrl: itemImages[0]?.image_url || '',
        isMain: true,
        isRequired: true,
        maxQuantity: Math.max(1, Number(item.quantity) || 1),
        name: item.title,
        quantity: itemQuantity,
        total: pricing.mainTotal,
        type: 'Main item',
      },
      ...selectedAddons.map((addon) => ({
        description: addon.description,
        id: `addon-${addon.id}`,
        imageUrl: addon.imageUrl,
        isAddon: true,
        isRequired: addon.isRequired,
        maxQuantity: addon.availableQuantity,
        name: addon.name,
        quantity: addon.quantity,
        sourceId: addon.id,
        total: addon.lineTotal,
        type: addon.isRequired ? 'Required add-on' : 'Add-on',
      })),
    ];
  }, [item, itemImages, itemQuantity, pricing.mainTotal, selectedAddons]);

  const purchaseIssues = useMemo(() => {
    if (!item) return [];
    const issues = [];
    if (!userId) issues.push('Sign in before purchasing an item.');
    if (!profile?.nub_registry_managed) issues.push('Your account must be linked to the official NUB student registry.');
    else if (!profile?.is_profile_complete) issues.push('Complete your profile before purchasing an item.');
    if (item.owner_id === userId) issues.push('You cannot purchase your own listing.');
    if (!item.is_active || !item.is_for_sale || Number(item.sale_price) <= 0) issues.push('This listing is not available for purchase.');
    if (Number(item.quantity) < 1) issues.push('This listing has no stock available.');
    if (itemQuantity > Number(item.quantity)) issues.push(`Only ${Number(item.quantity)} item(s) are available.`);
    return issues;
  }, [item, itemQuantity, profile, userId]);

  const canSubmit = Boolean(
    !loading
    && !saving
    && item
    && !purchaseIssues.length
    && termsDocument
    && termsViewed
    && termsAccepted
    && preferredPickup
  );

  function toggleAddon(addonId) {
    const addon = addons.find((entry) => entry.id === addonId);
    if (!addon || addon.is_required) return;
    setAddonSelection((current) => ({
      ...current,
      [addonId]: {
        quantity: current[addonId]?.quantity || 1,
        selected: !current[addonId]?.selected,
      },
    }));
  }

  function setAddonQuantity(addonId, quantity) {
    const addon = addons.find((entry) => entry.id === addonId);
    const maximum = Math.max(1, Number(addon?.quantity) || 1);
    setAddonSelection((current) => ({
      ...current,
      [addonId]: {
        quantity: clampPurchaseQuantity(quantity, maximum),
        selected: Boolean(addon?.is_required || current[addonId]?.selected),
      },
    }));
  }

  function submitHeaderSearch(event) {
    event.preventDefault();
    const query = sanitizeText(headerSearch);
    navigate(`/items${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!item || !userId) return;
    setSaving(true);
    setMessage('');

    let createdRequestId = '';
    try {
      if (purchaseIssues.length) throw new Error(purchaseIssues[0]);
      if (!termsDocument || !termsViewed || !termsAccepted) {
        throw new Error('Review and accept the current Terms and Conditions before continuing.');
      }

      const latestTerms = await loadActiveTerms();
      if (!latestTerms || latestTerms.id !== termsDocument.id) {
        setTermsDocument(latestTerms);
        setTermsViewed(false);
        setTermsAccepted(false);
        throw new Error('The Terms and Conditions were updated. Review and accept the current version before continuing.');
      }

      const pickupDate = normalizePickupDate(preferredPickup);
      const selectedAddonPayload = selectedAddons.map((addon) => ({
        addon_id: addon.id,
        quantity: addon.quantity,
      }));
      const checkoutResult = await supabase.rpc('create_item_purchase_checkout', {
        p_addons: selectedAddonPayload,
        p_buyer_message: sanitizeText(buyerMessage) || null,
        p_item_id: item.id,
        p_preferred_pickup_at: pickupDate.toISOString(),
        p_quantity: itemQuantity,
        p_terms_document_id: termsDocument.id,
      });

      if (checkoutResult.error) throw new Error(checkoutResult.error.message);
      createdRequestId = checkoutResult.data?.[0]?.request_id || '';
      if (!createdRequestId) throw new Error('The purchase reservation could not be created.');

      const [requestResult, requestAddonsResult] = await Promise.all([
        supabase
          .from('item_purchase_requests')
          .select('id, buyer_requested_quantity, sale_price_snapshot, commission_fee_snapshot, sale_total_amount_snapshot')
          .eq('id', createdRequestId)
          .single(),
        supabase
          .from('item_purchase_request_addons')
          .select('addon_name_snapshot, description_snapshot, price_snapshot, quantity, total_amount')
          .eq('purchase_request_id', createdRequestId)
          .order('created_at', { ascending: true }),
      ]);
      if (requestResult.error) throw new Error(requestResult.error.message);
      if (requestAddonsResult.error) throw new Error(requestAddonsResult.error.message);

      const checkoutLineItems = [
        {
          amount: Number(requestResult.data.sale_price_snapshot),
          description: item.sale_inclusions || undefined,
          name: `${item.title} purchase`,
          quantity: Number(requestResult.data.buyer_requested_quantity) || 1,
        },
        ...(requestAddonsResult.data || []).map((addon) => ({
          amount: Number(addon.price_snapshot),
          description: addon.description_snapshot || undefined,
          name: `${addon.addon_name_snapshot} add-on`,
          quantity: Number(addon.quantity) || 1,
        })),
        ...(Number(requestResult.data.commission_fee_snapshot) > 0 ? [{
          amount: Number(requestResult.data.commission_fee_snapshot),
          description: 'Borrow Ko To marketplace service fee',
          name: 'Platform commission (15%)',
          quantity: 1,
        }] : []),
      ];
      const successUrl = `${window.location.origin}/user/manage-booking?payment_status=success&purchase_paid=true&purchase_request_id=${encodeURIComponent(createdRequestId)}`;
      const cancelUrl = `${window.location.origin}/user/buy-item/${item.id}?paymongo=cancelled&purchase_request_id=${encodeURIComponent(createdRequestId)}`;
      const checkoutSession = await createTestCheckoutSession({
        amount: Number(requestResult.data.sale_total_amount_snapshot),
        cancelUrl,
        currency: 'PHP',
        description: `Purchase checkout for ${item.title}`,
        lineItems: checkoutLineItems,
        metadata: {
          item_id: item.id,
          purchase_request_id: createdRequestId,
          source: 'purchase_request_payment',
          terms_document_id: termsDocument.id,
        },
        showLineItems: true,
        successUrl,
      });

      if (!checkoutSession?.attributes?.checkout_url) throw new Error('PayMongo did not return a checkout URL.');
      window.location.href = checkoutSession.attributes.checkout_url;
    } catch (error) {
      if (createdRequestId) {
        await supabase.rpc('cancel_item_purchase_checkout', { p_request_id: createdRequestId });
      }
      setMessage(`Unable to continue to payment: ${error.message}`);
      setMessageTone('warning');
      setSaving(false);
    }
  }

  const marketplaceName = settings?.system_name?.trim() || "Borrow Ko 'To";
  const profileName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.username || 'My account';
  const pickupLocation = buildItemLocation(item);
  const pickupTime = normalizeListingTime(item?.pickup_time, '09:00');
  const endPickupTime = normalizeListingTime(item?.return_time, '18:00');
  const minimumPickup = getMinimumScheduledPickup(pickupTime);

  return (
    <div
      className="market-page rent-checkout-market-page buy-checkout-page"
      style={{
        '--market-primary': settings?.primary_color || '#173b8f',
        '--ui-background-color': settings?.tertiary_color || '#ffffff',
        '--ui-primary-color': settings?.primary_color || '#173b8f',
        '--ui-primary-text-color': settings?.primary_text_color || '#ffffff',
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
            <div className="landing-controls inline"><button onClick={() => navigate('/?filters=open')} type="button">Schools &amp; courses</button></div>
            <form className="landing-search" onSubmit={submitHeaderSearch}>
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.4-3.4" /></svg>
              <input aria-label="Search rentals" onChange={(event) => setHeaderSearch(event.target.value)} placeholder="Search for items to borrow..." value={headerSearch} />
              <button type="submit">Search</button>
            </form>
          </div>
        </section>
        <nav aria-label="Main links" className="landing-nav-links">
          <button className="landing-filter-trigger" onClick={() => navigate('/?filters=open')} type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg><span>Filters</span>
          </button>
          <button aria-label={profileName} className="landing-icon-btn signed-in" onClick={() => navigate('/user/dashboard')} type="button">
            {profile?.profile_photo_url ? <img alt="" src={profile.profile_photo_url} /> : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>}
          </button>
        </nav>
      </header>

      <main className="rent-checkout-public-main">
        <div className="rent-order-shell">
          {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
          {loading ? <StatusMessage tone="info">Loading purchase checkout.</StatusMessage> : null}

          {!loading && item ? (
            <Panel className="rent-order-panel">
              {purchaseIssues.length ? <StatusMessage tone="warning">{purchaseIssues[0]}</StatusMessage> : null}
              <form className="rent-checkout-layout" onSubmit={handleSubmit}>
                <div aria-hidden="true" className="rent-mobile-stepper">
                  <div className="rent-mobile-step-item is-complete"><span className="rent-mobile-step-dot">1</span><span>Cart</span></div>
                  <div className="rent-mobile-step-line" />
                  <div className="rent-mobile-step-item is-active"><span className="rent-mobile-step-dot">2</span><span>Pickup</span></div>
                  <div className="rent-mobile-step-line" />
                  <div className="rent-mobile-step-item"><span className="rent-mobile-step-dot">3</span><span>Payment</span></div>
                </div>
                <aside className="rent-checkout-summary">
                  <div className="rent-checkout-summary-card">
                    <div className="buy-summary-heading">
                      <span className="rent-order-summary-title">Order Summary</span>
                      <strong>{currencyFormatter.format(pricing.salePrice)}</strong>
                    </div>
                    <div className="buy-summary-pickup-date">
                      <span>Pickup date<span aria-hidden="true" className="required-asterisk">*</span></span>
                      <Input
                        className="rent-summary-date-input"
                        min={minimumPickup.slice(0, 10)}
                        onChange={(event) => setPreferredPickup(applyListingTime(event.target.value, pickupTime))}
                        required
                        type="date"
                        value={preferredPickup.slice(0, 10)}
                      />
                    </div>
                    <div aria-label="Lender pickup hours" className="buy-summary-pickup-window">
                      <span><small>Pickup time</small><strong>{pickupTime}</strong></span>
                      <span><small>End time</small><strong>{endPickupTime}</strong></span>
                    </div>
                    <p className="rent-summary-schedule-note">
                      These pickup hours are set by the lender.
                    </p>
                    <div className="rent-checkout-total-list">
                      <div><span>Main item × {itemQuantity}</span><strong>{currencyFormatter.format(pricing.mainTotal)}</strong></div>
                      <div><span>Add-ons ({selectedAddons.length})</span><strong>{currencyFormatter.format(pricing.addonTotal)}</strong></div>
                      <div><span>Subtotal (before commission)</span><strong>{currencyFormatter.format(pricing.subtotalBeforeCommission)}</strong></div>
                      <div><span>Commission fee (15%)</span><strong>{currencyFormatter.format(pricing.commissionFee)}</strong></div>
                      <div className="buy-summary-total"><span>Total due</span><strong>{currencyFormatter.format(pricing.grandTotal)}</strong></div>
                    </div>

                    <div className={`rent-terms-acceptance ${termsAccepted ? 'accepted' : ''}`}>
                      <div className="rent-terms-heading">
                        <span aria-hidden="true" className="rent-terms-mark">✓</span>
                        <span className="rent-terms-copy">
                          <strong>Terms and Conditions</strong>
                          <small>{termsDocument ? `Policy version ${termsDocument.version}` : termsError || 'Loading current policy...'}</small>
                        </span>
                        <Button className="rent-terms-view" disabled={termsLoading || !termsDocument} onClick={() => { setTermsViewed(true); setTermsOpen(true); }} type="button" variant="secondary">
                          {termsLoading ? 'Loading...' : termsViewed ? 'Review again' : 'Review terms'}
                        </Button>
                      </div>
                      <label className={`rent-terms-consent ${!termsViewed ? 'is-disabled' : ''}`}>
                        <input checked={termsAccepted} disabled={!termsViewed || !termsDocument || termsLoading} onChange={(event) => setTermsAccepted(event.target.checked)} type="checkbox" />
                        <span>{termsViewed ? 'I have read and agree to this policy.' : 'Review the policy before accepting.'}</span>
                      </label>
                    </div>
                    {termsError ? <StatusMessage tone="warning">{termsError}</StatusMessage> : null}
                    <Button className="rent-summary-place-order" disabled={!canSubmit} type="submit">
                      {saving ? 'Preparing payment...' : 'Continue to PayMongo'}
                    </Button>
                    <Button className="rent-summary-cancel" onClick={() => navigate(`/items/${itemId}`)} type="button" variant="ghost">Cancel</Button>
                    <span className="rent-summary-disclaimer">Your items are reserved while PayMongo checkout is open.</span>
                  </div>
                </aside>

                <div className="rent-checkout-main">
                  <div className="rent-order-hero buy-order-hero">
                    <div>
                      <strong>Buy {item.title}</strong>
                      <div className="rent-order-hero-meta">
                        <span className="buy-price-pill">{currencyFormatter.format(Number(item.sale_price) || 0)} each</span>
                        <span className="buy-stock-pill">{Number(item.quantity) || 0} available</span>
                      </div>
                    </div>
                    <Badge tone="success">For sale</Badge>
                  </div>

                  <section className="rent-order-section">
                    <div className="buy-section-title"><strong>Order Items</strong></div>
                    <div className="rent-order-table-wrap">
                      <table className="rent-order-table">
                        <thead><tr><th>Item</th><th className="rent-order-qty-col">Qty</th><th>Price</th><th>Action</th></tr></thead>
                        <tbody>
                          {orderRows.map((row) => (
                            <tr key={row.id}>
                              <td data-label="Item">
                                <div className="rent-order-item-cell">
                                  <div className="rent-order-item-image">{row.imageUrl ? <img alt={row.name} src={row.imageUrl} /> : null}</div>
                                  <div className="rent-order-item-meta"><strong>{row.name}</strong><span>{row.type}</span>{row.description ? <small>{row.description}</small> : null}</div>
                                </div>
                              </td>
                              <td className="rent-order-qty-col" data-label="Qty">
                                <Input className="rent-order-qty-input" max={row.maxQuantity} min={1} onChange={(event) => row.isMain ? setItemQuantity(clampPurchaseQuantity(event.target.value, row.maxQuantity)) : setAddonQuantity(row.sourceId, event.target.value)} type="number" value={row.quantity} />
                              </td>
                              <td data-label="Price">{currencyFormatter.format(row.total)}</td>
                              <td data-label="Action">
                                {row.isMain || row.isRequired ? <span className="buy-required-label">Required</span> : (
                                  <button aria-label={`Remove ${row.name}`} className="rent-order-remove-btn buy-remove-button" onClick={() => toggleAddon(row.sourceId)} type="button">
                                    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
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
                  </section>

                  {addons.length ? (
                    <section className="rent-order-section">
                      <div className="buy-compact-section-header"><span>Available Add-ons</span><Badge tone="neutral">{selectedAddons.length} selected</Badge></div>
                      <div className="buy-addon-list">
                        {addons.map((addon) => {
                          const selection = addonSelection[addon.id] || { quantity: 1, selected: false };
                          const selected = Boolean(addon.is_required || selection.selected);
                          return (
                            <div className={`rent-owner-item-row rent-addon-item-row buy-addon-row ${selected ? 'is-selected' : ''}`} key={addon.id}>
                              <button className="rent-owner-add-btn" disabled={addon.is_required} onClick={() => toggleAddon(addon.id)} type="button">{addon.is_required ? 'Required' : selected ? 'Remove' : 'Add'}</button>
                              <div className="rent-owner-item-thumb rent-addon-item-thumb buy-addon-thumb">{addon.image_url ? <img alt="" src={addon.image_url} /> : null}</div>
                              <div className="rent-owner-item-meta rent-addon-item-meta buy-addon-copy"><strong>{addon.addon_name}</strong>{addon.description ? <span>{addon.description}</span> : null}<small>{currencyFormatter.format(Number(addon.price) || 0)} each</small></div>
                              <div className="rent-owner-item-controls rent-addon-item-controls buy-addon-controls"><Input disabled={!selected} max={Math.max(1, Number(addon.quantity) || 1)} min={1} onChange={(event) => setAddonQuantity(addon.id, event.target.value)} type="number" value={selection.quantity} /><Badge tone="info">{Math.max(0, Number(addon.quantity) || 0)} available</Badge></div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}

                  <section className="rent-order-section buy-pickup-card">
                    <div className="buy-compact-section-title"><span>Pickup location</span></div>
                    <p className="buy-pickup-address">{pickupLocation || 'Finalize the pickup location with the seller.'}</p>
                    <div aria-label="Listing pickup schedule" className="rent-pickup-schedule">
                      <span><strong>Pickup time</strong>{pickupTime}</span>
                      <span><strong>End time</strong>{endPickupTime}</span>
                    </div>
                  </section>

                  <section className="rent-order-section">
                    <div className="buy-compact-section-title"><span>Message to seller</span></div>
                    <FormField hint="Optional pickup instructions or questions for the seller.">
                      <Textarea className="rent-message-input buy-message-input" maxLength={500} onChange={(event) => setBuyerMessage(event.target.value)} placeholder="Share pickup instructions, availability, or questions..." rows={3} value={buyerMessage} />
                    </FormField>
                  </section>
                  {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
                </div>

                <div className="rent-mobile-paybar">
                  <div className="rent-mobile-paybar-total"><span>Total payment</span><strong>{currencyFormatter.format(pricing.grandTotal)}</strong></div>
                  <Button className="rent-mobile-paybar-submit" disabled={!canSubmit} type="submit">{saving ? 'Preparing...' : 'Continue'}</Button>
                </div>
              </form>
            </Panel>
          ) : null}
        </div>
      </main>

      <TermsModal document={termsDocument} error={termsError} loading={termsLoading} onClose={() => setTermsOpen(false)} open={termsOpen} />
    </div>
  );
}
