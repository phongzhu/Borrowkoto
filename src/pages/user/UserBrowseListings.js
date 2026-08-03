import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { getDamageClaimsForBorrower, userHasActiveDamageHold } from '../../services/damageClaimsService';
import { CatalogIcon, CloseIcon, FilterIcon } from '../../ui/icons';
import { Badge, Button, Modal, Panel, StarRating, StatusMessage } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import UserShell from './UserShell';
import './UserBrowseListings.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const rowCardWidth = 286;

function buildOwnerName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function buildReadableIdentity(profile, fallback = 'Unknown seller') {
  if (!profile) return fallback;
  const fullName = buildOwnerName(profile);
  if (fullName && profile.username) return `${fullName} (@${profile.username})`;
  if (fullName) return fullName;
  if (profile.username) return `@${profile.username}`;
  return fallback;
}

function buildItemLocation(item) {
  return [item.pickup_barangay, item.pickup_city, item.pickup_province, item.pickup_country].filter(Boolean).join(', ');
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

function numericOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const sLat = toRadians(aLat);
  const eLat = toRadians(bLat);

  const angle =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(sLat) * Math.cos(eLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
}

function proximityScore(item, profile) {
  if (!profile) {
    return null;
  }

  const userLat = numericOrNull(profile.latitude);
  const userLng = numericOrNull(profile.longitude);
  const itemLat = numericOrNull(item.pickup_latitude);
  const itemLng = numericOrNull(item.pickup_longitude);

  if (userLat !== null && userLng !== null && itemLat !== null && itemLng !== null) {
    return haversineKm(userLat, userLng, itemLat, itemLng);
  }

  const sameCity =
    profile.city &&
    item.pickup_city &&
    String(profile.city).toLowerCase() === String(item.pickup_city).toLowerCase();
  const sameProvince =
    profile.province &&
    item.pickup_province &&
    String(profile.province).toLowerCase() === String(item.pickup_province).toLowerCase();
  const sameRegion =
    profile.region &&
    item.pickup_region &&
    String(profile.region).toLowerCase() === String(item.pickup_region).toLowerCase();

  if (sameCity && sameProvince) {
    return 5;
  }

  if (sameProvince) {
    return 25;
  }

  if (sameRegion) {
    return 80;
  }

  return null;
}

function createSectionItems(items, comparator, limit = 12) {
  return items.slice().sort(comparator).slice(0, limit);
}

function conditionScore(condition) {
  const normalized = String(condition || '').toLowerCase();
  if (normalized === 'new') return 5;
  if (normalized === 'like_new') return 4;
  if (normalized === 'good') return 3;
  if (normalized === 'fair') return 2;
  if (normalized === 'used') return 1;
  return 0;
}

function keywordMatchScore(item, keywords) {
  if (!keywords.length) {
    return 0;
  }

  const haystack = [
    item.title,
    item.description,
    item.category?.name,
    ...(item.subcategories || []).map((subcategory) => subcategory.name),
    item.item_condition,
    buildItemLocation(item),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return keywords.reduce((score, keyword) => (haystack.includes(keyword) ? score + 1 : score), 0);
}

function ListingCard({ item, onOpen }) {
  const location = buildItemLocation(item) || 'Location not set';
  const hasImage = Boolean(item.primaryImage?.image_url);

  return (
    <article
      className="listing-card-hover"
      onClick={() => onOpen(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(item);
        }
      }}
      role="button"
      style={{
        background: alpha(theme.colors.panel, 0.96),
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: 12,
        boxShadow: '0 10px 28px rgba(24, 33, 46, 0.07)',
        cursor: 'pointer',
        display: 'grid',
        flex: `0 0 ${rowCardWidth}px`,
        gridTemplateRows: '152px auto',
        overflow: 'hidden',
        transition: 'box-shadow 180ms ease',
        width: rowCardWidth,
      }}
      tabIndex={0}
    >
      <div
        style={{
          background: hasImage
            ? `linear-gradient(180deg, rgba(18, 25, 36, 0.02) 0%, rgba(18, 25, 36, 0.16) 52%, rgba(18, 25, 36, 0.76) 100%), url(${item.primaryImage.image_url}) center/cover`
            : `linear-gradient(135deg, ${alpha(theme.colors.teal, 0.92)} 0%, ${alpha(theme.colors.sky, 0.62)} 100%)`,
          display: 'grid',
          gap: 6,
          padding: 10,
        }}
      >
        <div style={{ alignSelf: 'end', display: 'grid', gap: 6 }}>
          <strong
            style={{
              color: '#fff',
              fontFamily: theme.fonts.display,
              fontSize: 21,
              letterSpacing: '-0.03em',
              lineHeight: 1.18,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
              textShadow: '0 2px 10px rgba(0, 0, 0, 0.32)',
            }}
          >
            {item.title}
          </strong>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, padding: 14 }}>
        <div style={{ alignItems: 'baseline', display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <strong
              style={{
                color: theme.colors.ink,
                fontFamily: theme.fonts.display,
                fontSize: 23,
                letterSpacing: '-0.06em',
                lineHeight: 1,
              }}
            >
              {currencyFormatter.format(Number(item.rental_price_per_day) || 0)}
            </strong>
            <span style={{ color: theme.colors.slate, fontSize: 13 }}>per day</span>
          </div>

          <div
            style={{
              background: alpha(theme.colors.ink, 0.04),
              borderRadius: 8,
              display: 'grid',
              gap: 2,
              minWidth: 78,
              padding: '9px 10px',
            }}
          >
            <span style={{ color: '#526173', fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Deposit
            </span>
            <span style={{ color: theme.colors.ink, fontSize: 13, fontWeight: 700 }}>{currencyFormatter.format(Number(item.security_deposit) || 0)}</span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          <StarRating
            rating={item.owner?.average_rating}
            reviewCount={item.owner?.total_reviews}
            size={12}
            style={{ flexWrap: 'wrap', rowGap: 4 }}
            textStyle={{ lineHeight: 1.3, whiteSpace: 'normal' }}
          />
          <div style={{ color: '#526173', display: 'grid', fontSize: 13, gap: 5, lineHeight: 1.35, minWidth: 0 }}>
            <span>
              <strong style={{ color: theme.colors.ink }}>Condition:</strong>{' '}
              {item.item_condition ? formatListingStatusLabel(item.item_condition) : 'Condition not set'}
            </span>
            <span
              style={{
                display: '-webkit-box',
                overflow: 'hidden',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
              }}
            >
              <strong style={{ color: theme.colors.ink }}>Located at:</strong>{' '}
              {location}
            </span>
          </div>
        </div>

      </div>
    </article>
  );
}

function ListingRow({ description, items, onOpen, title }) {
  if (!items.length) {
    return null;
  }

  return (
    <div
      style={{
        background: alpha(theme.colors.panel, 0.88),
        border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
        borderRadius: 10,
        display: 'grid',
        gap: 12,
        padding: 14,
      }}
    >
      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
          <strong
            style={{
              color: theme.colors.ink,
              fontFamily: theme.fonts.display,
              fontSize: 22,
              letterSpacing: '-0.05em',
              lineHeight: 1.08,
            }}
          >
            {title}
          </strong>
          <Badge tone="neutral">{items.length} items</Badge>
        </div>
        {description ? <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.45 }}>{description}</span> : null}
      </div>

      <div
        style={{
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingBottom: 6,
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', gap: 12, width: 'max-content' }}>
          {items.map((item) => (
            <ListingCard item={item} key={`${title}-${item.id}`} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function UserBrowseListings() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [recentViewedItemIds, setRecentViewedItemIds] = useState([]);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [barangayFilter, setBarangayFilter] = useState('all');
  const [categoryFilters, setCategoryFilters] = useState([]);
  const [conditionFilters, setConditionFilters] = useState([]);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [activeDamageHold, setActiveDamageHold] = useState(false);
  const [pendingDamageClaim, setPendingDamageClaim] = useState(null);
  const [pendingDamageItemTitle, setPendingDamageItemTitle] = useState('');
  const [pendingDamageSellerName, setPendingDamageSellerName] = useState('');
  const [showDamageHoldModal, setShowDamageHoldModal] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadListings() {
      setLoading(true);

      const [{ data: authData }, categoriesResult, itemsResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('categories').select('id, name, parent_category_id').eq('is_active', true).order('name', { ascending: true }),
        supabase
          .from('items')
          .select(
            'id, owner_id, category_id, title, description, item_condition, rental_price_per_day, security_deposit, estimated_value, min_rental_days, max_rental_days, quantity, pickup_barangay, pickup_city, pickup_country, pickup_latitude, pickup_longitude, pickup_province, pickup_region, pickup_street, meetup_notes, status, is_active, created_at, updated_at'
          )
          .eq('is_active', true)
          .eq('status', 'available')
          .order('created_at', { ascending: false }),
      ]);

      if (!mounted) {
        return;
      }

      const nextErrors = [];
      const nextCategories = categoriesResult.data || [];
      const rawItems = itemsResult.data || [];
      const currentUserId = authData?.user?.id || null;

      if (currentUserId) {
        const [hasHold, borrowerClaims] = await Promise.all([
          userHasActiveDamageHold(currentUserId),
          getDamageClaimsForBorrower(currentUserId),
        ]);

        if (!mounted) {
          return;
        }

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
              .select('id, first_name, middle_name, last_name, suffix, username')
              .eq('id', claimItem.owner_id)
              .maybeSingle();
            nextSellerName = buildReadableIdentity(sellerProfile);
          }
        }

        setActiveDamageHold(Boolean(hasHold));
        setPendingDamageClaim(pendingClaim);
        setPendingDamageItemTitle(nextItemTitle);
        setPendingDamageSellerName(nextSellerName);
        setShowDamageHoldModal(Boolean(hasHold && pendingClaim));
      } else {
        setActiveDamageHold(false);
        setPendingDamageClaim(null);
        setPendingDamageItemTitle('');
        setPendingDamageSellerName('');
        setShowDamageHoldModal(false);
      }

      if (categoriesResult.error) {
        nextErrors.push(`categories: ${categoriesResult.error.message}`);
      }

      if (itemsResult.error) {
        nextErrors.push(`items: ${itemsResult.error.message}`);
      }

      const ownerIds = Array.from(new Set(rawItems.map((item) => item.owner_id).filter(Boolean)));
      const itemIds = rawItems.map((item) => item.id);
      const categoryMap = new Map(nextCategories.map((category) => [category.id, category]));

      const [ownersResult, imagesResult, profileResult, itemSubcategoriesResult, itemViewHistoryResult] = await Promise.all([
        ownerIds.length
          ? supabase
              .from('profiles')
              .select('id, first_name, middle_name, last_name, suffix, username, profile_photo_url, average_rating, total_reviews, is_verified, verification_status')
              .in('id', ownerIds)
          : Promise.resolve({ data: [], error: null }),
        itemIds.length
          ? supabase
              .from('item_images')
              .select('id, item_id, image_url, is_primary, sort_order')
              .in('item_id', itemIds)
              .order('sort_order', { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        currentUserId
          ? supabase
              .from('profiles')
              .select('id, city, province, region, latitude, longitude')
              .eq('id', currentUserId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        itemIds.length
          ? supabase
              .from('item_subcategories')
              .select('item_id, subcategory_id, categories!item_subcategories_subcategory_id_fkey(id, name, parent_category_id)')
              .in('item_id', itemIds)
          : Promise.resolve({ data: [], error: null }),
        currentUserId
          ? supabase
              .from('item_view_history')
              .select('item_id, last_viewed_at, viewed_at')
              .eq('viewer_id', currentUserId)
              .order('last_viewed_at', { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (!mounted) {
        return;
      }

      if (ownersResult.error) {
        nextErrors.push(`profiles: ${ownersResult.error.message}`);
      }

      if (imagesResult.error) {
        nextErrors.push(`item_images: ${imagesResult.error.message}`);
      }

      if (profileResult.error) {
        nextErrors.push(`current profile: ${profileResult.error.message}`);
      }
      if (itemSubcategoriesResult.error) {
        nextErrors.push(`item_subcategories: ${itemSubcategoriesResult.error.message}`);
      }
      if (itemViewHistoryResult.error) {
        nextErrors.push(`item_view_history: ${itemViewHistoryResult.error.message}`);
      }

      const ownerMap = new Map((ownersResult.data || []).map((profile) => [profile.id, profile]));
      const imagesByItemId = new Map();
      const subcategoriesByItemId = new Map();

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

      const nextItems = rawItems.map((item) => {
        const images = (imagesByItemId.get(item.id) || [])
          .slice()
          .sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);

        return {
          ...item,
          category: categoryMap.get(item.category_id) || null,
          images,
          owner: ownerMap.get(item.owner_id) || null,
          primaryImage: images[0] || null,
          subcategories: subcategoriesByItemId.get(item.id) || [],
        };
      });

      const recentHistoryRows = itemViewHistoryResult.data || [];
      const recencyMap = new Map();
      recentHistoryRows.forEach((row) => {
        if (!row?.item_id) {
          return;
        }
        const rowTime = new Date(row.last_viewed_at || row.viewed_at || 0).getTime() || 0;
        const previous = recencyMap.get(row.item_id);
        if (!previous || rowTime > previous) {
          recencyMap.set(row.item_id, rowTime);
        }
      });
      const nextRecentViewedItemIds = Array.from(recencyMap.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([itemId]) => itemId)
        .slice(0, 12);

      setCategories(nextCategories);
      setCurrentProfile(profileResult.data || null);
      setItems(nextItems);
      setRecentViewedItemIds(nextRecentViewedItemIds);
      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadListings();

    return () => {
      mounted = false;
    };
  }, []);

  const conditionOptions = useMemo(
    () =>
      Array.from(new Set(items.map((item) => item.item_condition).filter(Boolean))).sort((left, right) =>
        String(left).localeCompare(String(right))
      ),
    [items]
  );
  const barangayOptions = useMemo(
    () =>
      Array.from(new Set(items.map((item) => String(item.pickup_barangay || '').trim()).filter(Boolean))).sort((left, right) =>
        left.localeCompare(right)
      ),
    [items]
  );
  const rootCategories = useMemo(() => categories.filter((category) => !category.parent_category_id), [categories]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return items.filter((item) => {
      if (barangayFilter !== 'all' && String(item.pickup_barangay || '').trim() !== barangayFilter) {
        return false;
      }

      if (categoryFilters.length && !categoryFilters.includes(item.category_id)) {
        return false;
      }

      if (conditionFilters.length && !conditionFilters.includes(item.item_condition)) {
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
        buildOwnerName(item.owner),
        item.owner?.username,
        buildItemLocation(item),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [barangayFilter, categoryFilters, conditionFilters, items, search]);

  const newestItems = useMemo(
    () => createSectionItems(filteredItems, (left, right) => new Date(right.created_at) - new Date(left.created_at)),
    [filteredItems]
  );

  const cheapItems = useMemo(
    () => createSectionItems(filteredItems, (left, right) => Number(left.rental_price_per_day || 0) - Number(right.rental_price_per_day || 0)),
    [filteredItems]
  );

  const priceyItems = useMemo(
    () => createSectionItems(filteredItems, (left, right) => Number(right.rental_price_per_day || 0) - Number(left.rental_price_per_day || 0)),
    [filteredItems]
  );

  const nearbyItems = useMemo(() => {
    if (!currentProfile) {
      return [];
    }

    return filteredItems
      .map((item) => ({ item, score: proximityScore(item, currentProfile) }))
      .filter((entry) => entry.score !== null)
      .sort((left, right) => left.score - right.score)
      .slice(0, 12)
      .map((entry) => entry.item);
  }, [currentProfile, filteredItems]);

  const categoryRows = useMemo(() => {
    return categories
      .map((category) => ({
        category,
        items: filteredItems.filter((item) => item.category_id === category.id).slice(0, 12),
      }))
      .filter((entry) => entry.items.length);
  }, [categories, filteredItems]);

  const recentlyViewedItems = useMemo(() => {
    if (!recentViewedItemIds.length || !filteredItems.length) {
      return [];
    }

    const itemMap = new Map(filteredItems.map((item) => [item.id, item]));
    return recentViewedItemIds.map((itemId) => itemMap.get(itemId)).filter(Boolean);
  }, [filteredItems, recentViewedItemIds]);

  const recommendationRows = useMemo(() => {
    const normalizedKeywords = search
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (!filteredItems.length || !normalizedKeywords.length) {
      return [];
    }

    const qualityScored = filteredItems.map((item) => {
      const rating = Number(item.owner?.average_rating) || 0;
      const reviews = Number(item.owner?.total_reviews) || 0;
      const confidenceBoost = Math.min(1, reviews / 10);
      const quality = rating * (0.75 + 0.25 * confidenceBoost) + conditionScore(item.item_condition) * 0.35;
      const price = Number(item.rental_price_per_day) || 0;
      const valueScore = quality - price / 180;
      const matchScore = keywordMatchScore(item, normalizedKeywords);

      return { item, matchScore, price, quality, reviews, valueScore };
    });

    const bestValue = qualityScored
      .slice()
      .sort((a, b) => b.valueScore - a.valueScore || a.price - b.price)
      .slice(0, 8)
      .map((entry) => entry.item);

    const budget = qualityScored
      .slice()
      .sort((a, b) => a.price - b.price || b.quality - a.quality)
      .slice(0, 8)
      .map((entry) => entry.item);

    const topRated = qualityScored
      .slice()
      .sort((a, b) => b.quality - a.quality || b.reviews - a.reviews)
      .slice(0, 8)
      .map((entry) => entry.item);

    const premium = qualityScored
      .filter((entry) => entry.quality >= 3.8)
      .slice()
      .sort((a, b) => b.price - a.price || b.quality - a.quality)
      .slice(0, 8)
      .map((entry) => entry.item);

    const bestMatch = (normalizedKeywords.length ? qualityScored.filter((entry) => entry.matchScore > 0) : qualityScored)
      .slice()
      .sort((a, b) => b.matchScore - a.matchScore || b.quality - a.quality || a.price - b.price)
      .slice(0, 8)
      .map((entry) => entry.item);

    return [
      {
        description: 'Cheaper listings that still keep solid condition and owner review quality.',
        items: bestValue,
        title: 'Best value for money',
      },
      {
        description: 'Lowest daily rates from currently visible available listings.',
        items: budget,
        title: 'Budget picks',
      },
      {
        description: 'Strong owner ratings and better item condition confidence.',
        items: topRated,
        title: 'Top rated',
      },
      {
        description: 'Higher-priced but still quality-checked listings.',
        items: premium,
        title: 'Premium but good',
      },
      {
        description: normalizedKeywords.length
          ? `Matches your search keywords: ${normalizedKeywords.join(', ')}.`
          : 'Overall strongest picks based on quality, relevance, and price balance.',
        items: bestMatch,
        title: 'Best match for your search',
      },
    ].filter((row) => row.items.length);
  }, [filteredItems, search]);

  const aiOverviewText = useMemo(() => {
    if (!recommendationRows.length) {
      return '';
    }

    const topMatch = recommendationRows.find((row) => row.title === 'Best match for your search')?.items?.[0];
    const topBudget = recommendationRows.find((row) => row.title === 'Budget picks')?.items?.[0];
    const topRated = recommendationRows.find((row) => row.title === 'Top rated')?.items?.[0];

    const lines = [];
    lines.push(`I found ${filteredItems.length} available listing${filteredItems.length === 1 ? '' : 's'} matching your search.`);

    if (topMatch) {
      lines.push(`Best overall match: ${topMatch.title} (${currencyFormatter.format(Number(topMatch.rental_price_per_day) || 0)}/day).`);
    }
    if (topBudget) {
      lines.push(`Cheapest recommended: ${topBudget.title} (${currencyFormatter.format(Number(topBudget.rental_price_per_day) || 0)}/day).`);
    }
    if (topRated) {
      const rating = Number(topRated.owner?.average_rating) || 0;
      const reviews = Number(topRated.owner?.total_reviews) || 0;
      lines.push(`Top-rated option: ${topRated.title} (${rating.toFixed(1)} stars, ${reviews} review${reviews === 1 ? '' : 's'}).`);
    }

    return lines.join(' ');
  }, [filteredItems.length, recommendationRows]);

  const aiRecommendationHighlights = useMemo(() => {
    if (!recommendationRows.length) {
      return [];
    }

    const topMatch = recommendationRows.find((row) => row.title === 'Best match for your search')?.items?.[0];
    const topBudget = recommendationRows.find((row) => row.title === 'Budget picks')?.items?.[0];
    const topRated = recommendationRows.find((row) => row.title === 'Top rated')?.items?.[0];

    const highlights = [];

    if (topMatch) {
      highlights.push({
        badgeTone: 'info',
        item: topMatch,
        label: 'Best match',
        value: `${topMatch.title} · ${currencyFormatter.format(Number(topMatch.rental_price_per_day) || 0)}/day`,
      });
    }

    if (topBudget) {
      highlights.push({
        badgeTone: 'warning',
        item: topBudget,
        label: 'Cheapest',
        value: `${topBudget.title} · ${currencyFormatter.format(Number(topBudget.rental_price_per_day) || 0)}/day`,
      });
    }

    if (topRated) {
      const rating = Number(topRated.owner?.average_rating) || 0;
      const reviews = Number(topRated.owner?.total_reviews) || 0;
      highlights.push({
        badgeTone: 'neutral',
        item: topRated,
        label: 'Top rated',
        value: `${topRated.title} · ${rating.toFixed(1)}★ (${reviews} review${reviews === 1 ? '' : 's'})`,
      });
    }

    return highlights;
  }, [recommendationRows]);

  function openItemDetails(item) {
    if (!item?.id) {
      return;
    }

    navigate(`/user/view-item-list/${item.id}`);
  }

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

  function handleSearchSubmit(event) {
    event.preventDefault();
    setSearch((current) => current.trimStart());
  }

  function clearFilters() {
    setSearch('');
    setCategoryFilters([]);
    setConditionFilters([]);
  }

  function toggleCategoryFilter(categoryId) {
    setCategoryFilters((current) => (current.includes(categoryId) ? current.filter((value) => value !== categoryId) : [...current, categoryId]));
  }

  function toggleConditionFilter(conditionValue) {
    setConditionFilters((current) =>
      current.includes(conditionValue) ? current.filter((value) => value !== conditionValue) : [...current, conditionValue]
    );
  }

  return (
    <UserShell subtitle="" title="">
      {activeDamageHold && pendingDamageClaim ? (
        <StatusMessage tone="warning">
          Your account is temporarily restricted due to a pending damage balance. Settle it first before new rentals/listings.
        </StatusMessage>
      ) : null}

      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

      <div style={{ alignContent: 'start', alignItems: 'start', display: 'grid', gap: 10 }}>
        <Panel className="browse-listings-panel" style={{ marginTop: 0 }}>
          <div className="browse-listings-top">
            <div className="browse-listings-search-row">
              <form className="landing-search browse-listings-search" onSubmit={handleSearchSubmit}>
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.4-3.4" />
                </svg>
                <input
                  aria-label="Search listings"
                  name="listing_search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search for items to borrow..."
                  value={search}
                />
                <button type="submit">Search</button>
              </form>
              <label className="browse-barangay-select">
                <span>Barangay</span>
                <select onChange={(event) => setBarangayFilter(event.target.value)} value={barangayFilter}>
                  <option value="all">All barangays</option>
                  {barangayOptions.map((barangay) => (
                    <option key={barangay} value={barangay}>
                      {barangay}
                    </option>
                  ))}
                </select>
              </label>
              <button
                aria-label="Open filters"
                className="browse-filter-toggle"
                onClick={() => setFilterDrawerOpen(true)}
                type="button"
              >
                <FilterIcon size={16} />
              </button>
            </div>

            <div className="browse-listings-categories">
              <button
                className={categoryFilters.length === 0 ? 'active' : ''}
                onClick={() => setCategoryFilters([])}
                type="button"
              >
                <span className="landing-category-icon">
                  <CatalogIcon size={14} />
                </span>
                <strong>All</strong>
              </button>
              {rootCategories.map((category) => (
                <button
                  className={categoryFilters.includes(category.id) ? 'active' : ''}
                  key={`topcat-${category.id}`}
                  onClick={() => toggleCategoryFilter(category.id)}
                  type="button"
                >
                  <span className="landing-category-icon">
                    <CatalogIcon size={14} />
                  </span>
                  <strong>{category.name}</strong>
                </button>
              ))}
            </div>

            <div className="browse-listings-filter-row">
              <span>{loading ? 'Loading listings...' : `${filteredItems.length} items`}</span>
            </div>

            {loading ? <StatusMessage tone="info">Loading item listings.</StatusMessage> : null}
            {!loading && !filteredItems.length ? <StatusMessage tone="info">No active item listings are visible for the current search or filters.</StatusMessage> : null}

            {!loading ? (
              <div style={{ display: 'grid', gap: 18 }}>
                {recommendationRows.length ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div
                      style={{
                        background: `linear-gradient(180deg, ${alpha(theme.colors.sky, 0.11)} 0%, ${alpha(theme.colors.panel, 0.95)} 100%)`,
                        border: `1px solid ${alpha(theme.colors.sky, 0.3)}`,
                        borderRadius: 14,
                        display: 'grid',
                        gap: 14,
                        padding: 14,
                      }}
                    >
                      <div style={{ alignItems: 'start', display: 'grid', gap: 6, gridTemplateColumns: 'auto 1fr' }}>
                        <span
                          style={{
                            alignItems: 'center',
                            background: '#1f4da3',
                            borderRadius: '50%',
                            color: '#fff',
                            display: 'inline-flex',
                            fontSize: 16,
                            fontWeight: 800,
                            height: 34,
                            justifyContent: 'center',
                            width: 34,
                          }}
                        >
                          ✦
                        </span>
                        <div style={{ display: 'grid', gap: 4 }}>
                          <strong style={{ color: '#1f4da3', fontFamily: theme.fonts.display, fontSize: 32, letterSpacing: '-0.04em', lineHeight: 1 }}>
                            Assistant&apos;s Picks
                          </strong>
                          <span style={{ color: theme.colors.slate, fontSize: 13 }}>Curated from your current search and filters.</span>
                        </div>
                      </div>

                      {aiOverviewText ? (
                        <p style={{ color: theme.colors.ink, fontSize: 16, lineHeight: 1.45, margin: 0 }}>
                          {aiOverviewText}
                        </p>
                      ) : null}

                      {aiRecommendationHighlights.length ? (
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                          {aiRecommendationHighlights.filter((highlight) => Boolean(highlight?.item?.id)).map((highlight) => (
                            <button
                              key={highlight.label}
                              onClick={() => highlight?.item?.id && openItemDetails(highlight.item)}
                              style={{
                                background: alpha(theme.colors.panel, 0.96),
                                border: `1px solid ${alpha(theme.colors.ink, 0.12)}`,
                                borderRadius: 12,
                                cursor: 'pointer',
                                display: 'grid',
                                gap: 10,
                                gridTemplateColumns: '90px 1fr',
                                padding: 10,
                                position: 'relative',
                                textAlign: 'left',
                              }}
                            >
                              <span
                                style={{
                                  background:
                                    highlight.badgeTone === 'warning'
                                      ? '#e68a2e'
                                      : highlight.badgeTone === 'neutral'
                                        ? '#374151'
                                        : '#1f4da3',
                                  borderRadius: 999,
                                  color: '#fff',
                                  fontSize: 11,
                                  fontWeight: 800,
                                  letterSpacing: '0.04em',
                                  padding: '5px 10px',
                                  position: 'absolute',
                                  right: 8,
                                  top: -11,
                                }}
                              >
                                {highlight.label}
                              </span>

                              <div
                                style={{
                                  background: alpha(theme.colors.ink, 0.04),
                                  border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                                  borderRadius: 8,
                                  height: 82,
                                  overflow: 'hidden',
                                  width: 82,
                                }}
                              >
                                {highlight.item?.primaryImage?.image_url ? (
                                  <img
                                    alt={highlight.item.title}
                                    src={highlight.item.primaryImage.image_url}
                                    style={{ display: 'block', height: '100%', objectFit: 'cover', width: '100%' }}
                                  />
                                ) : null}
                              </div>

                              <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                                <strong
                                  style={{
                                    color: theme.colors.ink,
                                    display: '-webkit-box',
                                    fontSize: 19,
                                    lineHeight: 1.2,
                                    overflow: 'hidden',
                                    WebkitBoxOrient: 'vertical',
                                    WebkitLineClamp: 2,
                                  }}
                                >
                                  {highlight.item?.title || '-'}
                                </strong>
                                <strong style={{ color: '#1f4da3', fontSize: 18, lineHeight: 1 }}>
                                  {currencyFormatter.format(Number(highlight.item?.rental_price_per_day) || 0)}/day
                                </strong>
                                <span style={{ color: theme.colors.slate, fontSize: 13 }}>
                                  ★ {Number(highlight.item?.owner?.average_rating || 0).toFixed(1)} ({Number(highlight.item?.owner?.total_reviews || 0)} reviews)
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <ListingRow
                  description="Items you viewed recently. Tap any card to reopen its item page."
                  items={recentlyViewedItems}
                  onOpen={openItemDetails}
                  title="Recently viewed"
                />

                <ListingRow
                  description="The latest item releases that were most recently added by community members."
                  items={newestItems}
                  onOpen={openItemDetails}
                  title="Newly released"
                />

                {nearbyItems.length ? (
                  <ListingRow
                    description="Listings that appear closest to the city, province, or saved coordinates on your member profile."
                    items={nearbyItems}
                    onOpen={openItemDetails}
                    title="Near you"
                  />
                ) : null}

                <ListingRow
                  description="A quick lane for lower daily rates across the currently visible catalog."
                  items={cheapItems}
                  onOpen={openItemDetails}
                  title="Budget-friendly picks"
                />

                <ListingRow
                  description="Higher-value listings with larger rental rates, deposits, and stronger equipment coverage."
                  items={priceyItems}
                  onOpen={openItemDetails}
                  title="Premium picks"
                />

                {categoryRows.map(({ category, items: rowItems }) => (
                  <ListingRow
                    description={`Browse active listings currently filed under ${category.name}.`}
                    items={rowItems}
                    key={category.id}
                    onOpen={openItemDetails}
                    title={category.name}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      {filterDrawerOpen ? <button aria-label="Close filters" className="browse-filter-backdrop" onClick={() => setFilterDrawerOpen(false)} type="button" /> : null}
      <aside className={`browse-filter-drawer ${filterDrawerOpen ? 'open' : ''}`}>
        <div className="browse-filter-drawer-head">
          <div>
            <strong>Filters</strong>
            <span>Refine your search</span>
          </div>
          <button aria-label="Close filters" onClick={() => setFilterDrawerOpen(false)} type="button">
            <CloseIcon size={16} />
          </button>
        </div>

        <button className="browse-filter-clear" onClick={clearFilters} type="button">
          Clear all
        </button>

        <div className="browse-filter-section">
          <h4>Category</h4>
          <label className="browse-filter-option">
            <input checked={categoryFilters.length === 0} onChange={() => setCategoryFilters([])} type="checkbox" />
            <span>All categories</span>
          </label>
          {rootCategories.map((category) => (
            <label className="browse-filter-option" key={`drawer-cat-${category.id}`}>
              <input
                checked={categoryFilters.includes(category.id)}
                onChange={() => toggleCategoryFilter(category.id)}
                type="checkbox"
              />
              <span>{category.name}</span>
            </label>
          ))}
        </div>

        <div className="browse-filter-section">
          <h4>Condition</h4>
          <label className="browse-filter-option">
            <input checked={conditionFilters.length === 0} onChange={() => setConditionFilters([])} type="checkbox" />
            <span>All conditions</span>
          </label>
          {conditionOptions.map((condition) => (
            <label className="browse-filter-option" key={`drawer-cond-${condition}`}>
              <input
                checked={conditionFilters.includes(condition)}
                onChange={() => toggleConditionFilter(condition)}
                type="checkbox"
              />
              <span>{formatListingStatusLabel(condition)}</span>
            </label>
          ))}
        </div>
      </aside>

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
