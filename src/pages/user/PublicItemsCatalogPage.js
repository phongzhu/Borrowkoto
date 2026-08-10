import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { useUISettings } from '../../context/UISettingsContext';
import { RENTABLE_ITEM_STATUSES } from '../../utils/bookingEnums';
import '../../App.css';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  maximumFractionDigits: 0,
  style: 'currency',
});

const TAGS_META_PREFIX = '[TAGS]::';
const BALIUAG_BARANGAYS = [
  'Adias',
  'Bagong Nayon',
  'Balon',
  'Banag',
  'Barihan',
  'Calantipay',
  'Catulinan',
  'Concepcion',
  'Hinukay',
  'Makinabang',
  'Matangtubig',
  'Pagala',
  'Paitan',
  'Piel',
  'Pinagbarilan',
  'Poblacion',
  'Sabang',
  'San Jose',
  'San Roque',
  'Santa Barbara',
  'Santo Cristo',
  'Santo Nino',
  'Subic',
  'Sulivan',
  'Tangos',
  'Tarcan',
  'Tibag',
  'Tilapayong',
  'Virgen Delas Flores',
];

function getLocation(item) {
  return [item.pickup_city, item.pickup_province].filter(Boolean).join(', ') || 'Location on request';
}

function formatCondition(value) {
  return String(value || 'Condition not set')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseItemTagsFromNotes(meetupNotesValue) {
  const rawText = String(meetupNotesValue || '');
  const markerIndex = rawText.indexOf(TAGS_META_PREFIX);

  if (markerIndex < 0) {
    return [];
  }

  return rawText
    .slice(markerIndex + TAGS_META_PREFIX.length)
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .filter((tag, index, list) => list.indexOf(tag) === index);
}

function buildDescendantIds(categoryId, categories) {
  const descendants = new Set([categoryId]);
  const queue = [categoryId];

  while (queue.length) {
    const currentId = queue.shift();
    categories.forEach((category) => {
      if (category.parent_category_id === currentId && !descendants.has(category.id)) {
        descendants.add(category.id);
        queue.push(category.id);
      }
    });
  }

  return descendants;
}

function detectBaliuagBarangay(item) {
  const ownerBarangay = String(item?.owner?.barangay || '').trim();
  if (ownerBarangay) {
    return ownerBarangay;
  }

  const pickupBarangay = String(item?.pickup_barangay || '').trim();
  if (pickupBarangay) {
    return pickupBarangay;
  }

  const haystack = [
    item.pickup_barangay,
    item.pickup_city,
    item.pickup_province,
    item.meetup_notes,
    item.description,
    item.owner?.street,
    item.owner?.barangay,
    item.owner?.city,
    item.owner?.province,
    ...(item.searchTags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const matched = BALIUAG_BARANGAYS.find((name) => haystack.includes(name.toLowerCase()));
  return matched || 'Unspecified';
}

function formatItemRating(item) {
  const ratingValue = Number(item?.ownerAverageRating ?? item?.owner?.average_rating);
  const reviewCount = Number((item?.ownerTotalReviews ?? item?.owner?.total_reviews) || 0);

  if (Number.isFinite(ratingValue) && ratingValue > 0) {
    return `★ ${ratingValue.toFixed(1)} (${reviewCount})`;
  }

  return 'No reviews yet';
}

function conditionScore(condition) {
  const normalized = String(condition || '').toLowerCase().replaceAll(' ', '_');
  if (normalized === 'new') return 5;
  if (normalized === 'like_new') return 4;
  if (normalized === 'good') return 3;
  if (normalized === 'fair') return 2;
  if (normalized === 'used') return 1;
  return 0;
}

function keywordMatchScore(item, keywords) {
  const haystack = [
    item.title,
    item.description,
    item.category?.name,
    ...(item.subcategories || []).map((subcategory) => subcategory.name),
    item.item_condition,
    getLocation(item),
    ...(item.searchTags || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return keywords.reduce((score, keyword) => score + (haystack.includes(keyword) ? 1 : 0), 0);
}

function LogoMark({ logoUrl, brandName }) {
  return logoUrl ? (
    <img alt={brandName} src={logoUrl} />
  ) : (
    <span>{brandName.slice(0, 2).toUpperCase()}</span>
  );
}

function ProductImage({ item }) {
  const imageUrl = item.primaryImage?.image_url;
  if (imageUrl) return <img alt={item.title} src={imageUrl} />;
  return (
    <div className="market-product-placeholder">
      <span>{item.title?.slice(0, 1)?.toUpperCase() || 'I'}</span>
    </div>
  );
}

export default function PublicItemsCatalogPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings } = useUISettings();

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [mostViewedCounts, setMostViewedCounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [savedItemIds, setSavedItemIds] = useState(() => new Set());
  const [savingItemId, setSavingItemId] = useState('');

  const initialQ = searchParams.get('q') || '';
  const initialBarangay = searchParams.get('barangay') || 'all';
  const categoryId = searchParams.get('categoryId') || '';
  const requestedMode = searchParams.get('mode') || '';
  const mode = requestedMode || (categoryId ? 'category' : 'all');
  // The general All Rentals catalog shares the same structured browsing UI as
  // category and search results. Curated collection modes keep their simpler
  // presentation when opened directly from the marketplace homepage.
  const isRefinedCatalog = mode === 'all' || mode === 'category' || Boolean(initialQ.trim());

  const [search, setSearch] = useState(initialQ);
  const [barangayFilter, setBarangayFilter] = useState(initialBarangay);
  const [categoryMinPrice, setCategoryMinPrice] = useState('');
  const [categoryMaxPrice, setCategoryMaxPrice] = useState('');
  const [categoryMinRating, setCategoryMinRating] = useState('0');
  const [categoryConditions, setCategoryConditions] = useState([]);
  const [categorySubcategory, setCategorySubcategory] = useState('all');
  const [categorySort, setCategorySort] = useState('relevance');

  const brandName = settings.system_name?.trim() || "Borrow Ko 'To";
  const logoUrl = settings.logo_url?.trim() || '';
  const primary = settings.primary_color?.trim() || '#185a72';
  const primaryText = settings.primary_text_color?.trim() || '#ffffff';
  const secondary = settings.secondary_color?.trim() || '#f3a84f';
  const secondaryText = settings.secondary_text_color?.trim() || '#0f172a';
  const tertiary = settings.tertiary_color?.trim() || '#1f2937';
  const tertiaryText = settings.tertiary_text_color?.trim() || '#e2e8f0';

  useEffect(() => {
    let mounted = true;

    async function loadCurrentUser() {
      const { data } = await supabase.auth.getUser();
      const user = data?.user || null;
      if (!mounted) return;
      setCurrentUser(user);

      if (!user) {
        setCurrentUserProfile(null);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, username, profile_photo_url')
        .eq('id', user.id)
        .maybeSingle();

      if (mounted) setCurrentUserProfile(profile || null);

      const { data: savedRows } = await supabase
        .from('saved_rent_items')
        .select('item_id')
        .eq('user_id', user.id);
      if (mounted) setSavedItemIds(new Set((savedRows || []).map((row) => row.item_id)));
    }

    loadCurrentUser();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setSearch(initialQ);
    setBarangayFilter(initialBarangay);
  }, [initialBarangay, initialQ]);

  useEffect(() => {
    let mounted = true;

    async function loadMarketplace() {
      setLoading(true);
      setError('');

      const [categoriesResult, itemsResult, viewCountsResult] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name, parent_category_id')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('items')
          .select(
            'id, owner_id, category_id, title, description, item_condition, rental_price_per_day, security_deposit, pickup_barangay, pickup_city, pickup_province, pickup_region, pickup_street, meetup_notes, status, is_active, created_at'
          )
          .eq('is_active', true)
          .in('status', Array.from(RENTABLE_ITEM_STATUSES))
          .order('created_at', { ascending: false })
          .limit(300),
        supabase
          .from('item_daily_view_counts')
          .select('item_id, total_views')
          .order('total_views', { ascending: false })
          .limit(500),
      ]);

      if (!mounted) return;

      const nextErrors = [];
      const nextCategories = categoriesResult.data || [];
      const rawItems = itemsResult.data || [];

      if (categoriesResult.error) nextErrors.push(`categories: ${categoriesResult.error.message}`);
      if (itemsResult.error) nextErrors.push(`items: ${itemsResult.error.message}`);
      if (viewCountsResult.error) nextErrors.push(`item_daily_view_counts: ${viewCountsResult.error.message}`);

      const itemIds = rawItems.map((item) => item.id);
      const ownerIds = Array.from(new Set(rawItems.map((item) => item.owner_id).filter(Boolean)));
      const categoryMap = new Map(nextCategories.map((category) => [category.id, category]));

      const [imagesResult, ownersResult, ownerRatingsResult, itemSubcategoriesResult] = await Promise.all([
        itemIds.length
          ? supabase
              .from('item_images')
              .select('id, item_id, image_url, is_primary, sort_order')
              .in('item_id', itemIds)
              .order('sort_order', { ascending: true })
          : { data: [], error: null },
        ownerIds.length
          ? supabase
              .from('profiles')
              .select('id, average_rating, total_reviews, street, barangay, city, province, region')
              .in('id', ownerIds)
          : { data: [], error: null },
        ownerIds.length
          ? supabase
              .from('reviews')
              .select('reviewee_id, rating')
              .in('reviewee_id', ownerIds)
              .not('rating', 'is', null)
          : { data: [], error: null },
        itemIds.length
          ? supabase
              .from('item_subcategories')
              .select('item_id, subcategory_id, categories!item_subcategories_subcategory_id_fkey(id, name, parent_category_id)')
              .in('item_id', itemIds)
          : { data: [], error: null },
      ]);

      if (!mounted) return;

      if (imagesResult.error) nextErrors.push(`item_images: ${imagesResult.error.message}`);
      if (ownersResult.error) nextErrors.push(`profiles: ${ownersResult.error.message}`);
      if (ownerRatingsResult.error) nextErrors.push(`reviews: ${ownerRatingsResult.error.message}`);
      if (itemSubcategoriesResult.error) nextErrors.push(`item_subcategories: ${itemSubcategoriesResult.error.message}`);

      const imagesByItemId = new Map();
      const subcategoriesByItemId = new Map();
      const ownersById = new Map((ownersResult.data || []).map((owner) => [owner.id, owner]));
      const ownerRatingStatsById = new Map();

      (ownerRatingsResult.data || []).forEach((row) => {
        const ownerId = row?.reviewee_id;
        const rating = Number(row?.rating);

        if (!ownerId || !Number.isFinite(rating)) return;

        const current = ownerRatingStatsById.get(ownerId) || { count: 0, total: 0 };
        ownerRatingStatsById.set(ownerId, {
          count: current.count + 1,
          total: current.total + rating,
        });
      });

      (imagesResult.data || []).forEach((img) => {
        const list = imagesByItemId.get(img.item_id) || [];
        list.push(img);
        imagesByItemId.set(img.item_id, list);
      });

      (itemSubcategoriesResult.data || []).forEach((row) => {
        const list = subcategoriesByItemId.get(row.item_id) || [];
        if (row.categories) {
          list.push(row.categories);
        }
        subcategoriesByItemId.set(row.item_id, list);
      });

      const nextItems = rawItems.map((item) => {
        const images = (imagesByItemId.get(item.id) || [])
          .slice()
          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
        const ownerProfile = ownersById.get(item.owner_id) || null;
        const ownerRatingStats = ownerRatingStatsById.get(item.owner_id) || null;
        const profileAverageRating = Number(ownerProfile?.average_rating);
        const profileTotalReviews = Number(ownerProfile?.total_reviews || 0);
        const ownerAverageRating = ownerRatingStats?.count
          ? ownerRatingStats.total / ownerRatingStats.count
          : (Number.isFinite(profileAverageRating) && profileAverageRating > 0 ? profileAverageRating : null);
        const ownerTotalReviews = ownerRatingStats?.count || profileTotalReviews;

        return {
          ...item,
          category: categoryMap.get(item.category_id) || null,
          owner: ownerProfile,
          ownerAverageRating,
          ownerTotalReviews,
          primaryImage: images[0] || null,
          searchTags: parseItemTagsFromNotes(item.meetup_notes),
          subcategories: subcategoriesByItemId.get(item.id) || [],
          subcategoryIds: (subcategoriesByItemId.get(item.id) || []).map((subcategory) => subcategory.id),
        };
      });

      setCategories(nextCategories);
      setItems(nextItems);
      setMostViewedCounts(viewCountsResult.data || []);
      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadMarketplace();
    return () => {
      mounted = false;
    };
  }, []);

  const totalViewsByItemId = useMemo(() => {
    const map = new Map();

    mostViewedCounts.forEach((row) => {
      const itemId = row?.item_id;
      if (!itemId) return;
      map.set(itemId, (map.get(itemId) || 0) + (Number(row.total_views) || 0));
    });

    return map;
  }, [mostViewedCounts]);

  const baseFilteredItems = useMemo(() => {
    const q = initialQ.trim().toLowerCase();
    let scoped = items.map((item) => ({
      barangay: detectBaliuagBarangay(item),
      item,
      totalViews: totalViewsByItemId.get(item.id) || 0,
    }));

    if (initialBarangay !== 'all') {
      scoped = scoped.filter((entry) => entry.barangay === initialBarangay);
    }

    if (q) {
      scoped = scoped.filter(({ item }) =>
        [
          item.title,
          item.description,
          item.category?.name,
          ...(item.subcategories || []).map((subcategory) => subcategory.name),
          item.item_condition,
          getLocation(item),
          ...(item.searchTags || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      );
    }

    if (mode === 'category' && categoryId) {
      const categoryIds = buildDescendantIds(categoryId, categories);
      scoped = scoped.filter(({ item }) => {
        const inMainCategory = categoryIds.has(item.category_id);
        const inSubcategory = (item.subcategoryIds || []).some((subcategoryId) => categoryIds.has(subcategoryId));
        return inMainCategory || inSubcategory;
      });
    }

    if (mode === 'trending' || mode === 'most-viewed') {
      return scoped
        .slice()
        .sort(
          (left, right) =>
            right.totalViews - left.totalViews ||
            String(left.item.title || '').localeCompare(String(right.item.title || ''))
        );
    }

    if (mode === 'cheapest') {
      return scoped
        .slice()
        .sort(
          (left, right) =>
            (Number(left.item.rental_price_per_day) || 0) - (Number(right.item.rental_price_per_day) || 0) ||
            String(left.item.title || '').localeCompare(String(right.item.title || ''))
        );
    }

    if (mode === 'priciest') {
      return scoped
        .slice()
        .sort(
          (left, right) =>
            (Number(right.item.rental_price_per_day) || 0) - (Number(left.item.rental_price_per_day) || 0) ||
            String(left.item.title || '').localeCompare(String(right.item.title || ''))
        );
    }

    return scoped
      .slice()
      .sort(
        (left, right) =>
          new Date(right.item.created_at || 0).getTime() - new Date(left.item.created_at || 0).getTime() ||
          String(left.item.title || '').localeCompare(String(right.item.title || ''))
      );
  }, [categoryId, categories, initialBarangay, initialQ, items, mode, totalViewsByItemId]);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === categoryId) || null,
    [categories, categoryId]
  );

  const categorySubcategories = useMemo(
    () => mode === 'category'
      ? categories.filter((category) => category.parent_category_id === categoryId)
      : categories.filter((category) => !category.parent_category_id),
    [categories, categoryId, mode]
  );

  const filteredItems = useMemo(() => {
    if (!isRefinedCatalog) return baseFilteredItems;

    let next = baseFilteredItems.filter(({ item }) => {
      const price = Number(item.rental_price_per_day) || 0;
      const rating = Number(item.ownerAverageRating ?? item.owner?.average_rating) || 0;
      const normalizedCondition = String(item.item_condition || '').toLowerCase();
      if (categoryMinPrice !== '' && price < Number(categoryMinPrice)) return false;
      if (categoryMaxPrice !== '' && price > Number(categoryMaxPrice)) return false;
      if (Number(categoryMinRating) > 0 && rating < Number(categoryMinRating)) return false;
      if (categoryConditions.length && !categoryConditions.includes(normalizedCondition)) return false;
      if (categorySubcategory !== 'all') {
        const selectedIds = buildDescendantIds(categorySubcategory, categories);
        const matchesSelectedCategory = selectedIds.has(item.category_id) || (item.subcategoryIds || []).some((id) => selectedIds.has(id));
        if (!matchesSelectedCategory) return false;
      }
      return true;
    });

    if (categorySort === 'price-low') next = next.slice().sort((a, b) => Number(a.item.rental_price_per_day) - Number(b.item.rental_price_per_day));
    if (categorySort === 'price-high') next = next.slice().sort((a, b) => Number(b.item.rental_price_per_day) - Number(a.item.rental_price_per_day));
    if (categorySort === 'rating') next = next.slice().sort((a, b) => Number(b.item.ownerAverageRating || 0) - Number(a.item.ownerAverageRating || 0));
    if (categorySort === 'newest') next = next.slice().sort((a, b) => new Date(b.item.created_at || 0) - new Date(a.item.created_at || 0));
    return next;
  }, [baseFilteredItems, categories, categoryConditions, categoryMaxPrice, categoryMinPrice, categoryMinRating, categorySort, categorySubcategory, isRefinedCatalog]);

  function toggleCategoryCondition(condition) {
    setCategoryConditions((current) => current.includes(condition) ? current.filter((value) => value !== condition) : [...current, condition]);
  }

  async function toggleSavedItem(event, itemId) {
    event.stopPropagation();
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (savingItemId) return;

    const isSaved = savedItemIds.has(itemId);
    setSavingItemId(itemId);
    const result = isSaved
      ? await supabase.from('saved_rent_items').delete().eq('user_id', currentUser.id).eq('item_id', itemId)
      : await supabase.from('saved_rent_items').upsert({ desired_quantity: 1, item_id: itemId, note: null, user_id: currentUser.id }, { onConflict: 'user_id,item_id' });

    if (!result.error) {
      setSavedItemIds((current) => {
        const next = new Set(current);
        if (isSaved) next.delete(itemId);
        else next.add(itemId);
        return next;
      });
    }
    setSavingItemId('');
  }

  const pageTitle = useMemo(() => {
    if (mode === 'trending') return 'Trending Rentals';
    if (mode === 'most-viewed') return 'Most Viewed Rentals';
    if (mode === 'cheapest') return 'Cheapest Rentals';
    if (mode === 'priciest') return 'Priciest Rentals';
    if (mode === 'category') return selectedCategory?.name ? `${selectedCategory.name} Rentals` : 'Category Rentals';
    if (initialQ.trim()) return `Search results for “${initialQ.trim()}”`;
    return 'All Rentals';
  }, [initialQ, mode, selectedCategory]);

  const recommendationHighlights = useMemo(() => {
    const keywords = initialQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!keywords.length || !items.length) return [];

    let candidates = items.map((item) => ({ barangay: detectBaliuagBarangay(item), item }));
    if (initialBarangay !== 'all') candidates = candidates.filter((entry) => entry.barangay === initialBarangay);
    if (categoryId) {
      const categoryIds = buildDescendantIds(categoryId, categories);
      candidates = candidates.filter(({ item }) => categoryIds.has(item.category_id) || (item.subcategoryIds || []).some((id) => categoryIds.has(id)));
    }

    const scored = candidates.map(({ item, barangay }) => {
      const price = Number(item.rental_price_per_day) || 0;
      const rating = Number(item.ownerAverageRating ?? item.owner?.average_rating) || 0;
      const reviews = Number(item.ownerTotalReviews ?? item.owner?.total_reviews) || 0;
      const quality = rating + conditionScore(item.item_condition) * .35 + Math.min(reviews, 10) * .03;
      return { barangay, item, match: keywordMatchScore(item, keywords), price, quality };
    });
    if (!scored.length) return [];

    const best = scored.slice().sort((a, b) => b.match - a.match || b.quality - a.quality || a.price - b.price)[0];
    const cheapest = scored.slice().sort((a, b) => a.price - b.price || b.quality - a.quality)[0];
    const priciest = scored.slice().sort((a, b) => b.price - a.price || b.quality - a.quality)[0];

    return [
      { ...best, description: 'Strongest balance of search relevance, condition, reviews, and price.', label: 'Best match', tone: 'best' },
      { ...cheapest, description: 'Lowest daily rental price among the available recommendations.', label: 'Cheapest', tone: 'budget' },
      { ...priciest, description: 'Premium-priced option currently available in this result set.', label: 'Priciest', tone: 'premium' },
    ];
  }, [categories, categoryId, initialBarangay, initialQ, items]);

  function updateQuery(next = {}) {
    const params = new URLSearchParams(searchParams);
    const nextQ = typeof next.q === 'string' ? next.q.trim() : search.trim();
    const nextBarangay = next.barangay ?? barangayFilter;

    if (nextQ) params.set('q', nextQ);
    else params.delete('q');

    if (nextBarangay && nextBarangay !== 'all') params.set('barangay', nextBarangay);
    else params.delete('barangay');

    setSearchParams(params, { replace: true });
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    updateQuery({ q: search });
  }

  function handleBarangayChange(event) {
    const next = event.target.value;
    setBarangayFilter(next);
    updateQuery({ barangay: next });
  }

  return (
    <div
      className="market-page"
      style={{
        '--market-primary': primary,
        '--market-primary-text': primaryText,
        '--market-secondary': secondary,
        '--market-secondary-text': secondaryText,
        '--market-tertiary': tertiary,
        '--market-tertiary-text': tertiaryText,
      }}
    >
      <header className="landing-nav">
        <button className="landing-brand" onClick={() => navigate('/')} type="button">
          <span className="landing-brand-mark">
            <LogoMark brandName={brandName} logoUrl={logoUrl} />
          </span>
          <strong>{brandName}</strong>
        </button>

        <section className="landing-toolbar landing-toolbar-top">
          <div className="landing-search-row">
            <div className="landing-controls inline">
              <select aria-label="Filter by Baliuag barangay" id="catalog-barangay-filter" onChange={handleBarangayChange} value={barangayFilter}>
                <option value="all">All barangays</option>
                {BALIUAG_BARANGAYS.map((barangay) => (
                  <option key={barangay} value={barangay}>
                    {barangay}
                  </option>
                ))}
                <option value="Unspecified">Unspecified</option>
              </select>
            </div>

            <form className="landing-search" onSubmit={handleSearchSubmit}>
              <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.4-3.4" />
              </svg>
              <input
                aria-label="Search rentals"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search for items to borrow..."
                value={search}
              />
              <button type="submit">Search</button>
            </form>
          </div>
        </section>

        <nav aria-label="Main links" className="landing-nav-links">
          {!isRefinedCatalog ? (
            <button className="landing-filter-trigger" onClick={() => navigate('/?filters=open')} type="button">
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
              <span>Filters</span>
            </button>
          ) : null}
          <button aria-label={currentUser ? 'Open member dashboard' : 'Sign in'} className={`landing-icon-btn ${currentUser ? 'signed-in' : ''}`} onClick={() => navigate(currentUser ? '/user/dashboard' : '/login')} title={currentUserProfile?.first_name || currentUserProfile?.username || ''} type="button">
            {currentUserProfile?.profile_photo_url ? (
              <img alt="" src={currentUserProfile.profile_photo_url} />
            ) : (
              <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
            )}
          </button>
        </nav>
      </header>

      <main className="landing-main landing-catalog-main">
        {error ? <div className="market-alert">{error}</div> : null}
        <section className={`landing-catalog ${isRefinedCatalog ? 'category-catalog' : ''}`}>
          <div className="landing-section-head">
            <h2>{pageTitle}</h2>
            <div className="landing-section-head-actions">
              <span>{loading ? 'Loading...' : `${filteredItems.length} items`}</span>
              <button onClick={() => navigate('/')} type="button">Back to Home</button>
            </div>
          </div>

          {!loading && recommendationHighlights.length ? (
            <section className="catalog-ai-recommendations" aria-label="Smart rental recommendations">
              <div className="catalog-ai-head">
                <span aria-hidden="true">✦</span>
                <div>
                  <small>AI-assisted recommendations</small>
                  <h3>Recommended for “{initialQ}”</h3>
                  <p>Compared by relevance, daily price, item condition, and owner reviews.</p>
                </div>
              </div>
              <div className="catalog-ai-grid">
                {recommendationHighlights.map((recommendation) => (
                  <button className={`catalog-ai-card ${recommendation.tone}`} key={recommendation.label} onClick={() => navigate(`/items/${recommendation.item.id}`)} type="button">
                    <div className="catalog-ai-media"><ProductImage item={recommendation.item} /><span>{recommendation.label}</span></div>
                    <div className="catalog-ai-copy">
                      <h4>{recommendation.item.title}</h4>
                      <strong>{currencyFormatter.format(recommendation.price)} / day</strong>
                      <p>{recommendation.description}</p>
                      <small>{recommendation.barangay} <b aria-hidden="true">→</b></small>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className={isRefinedCatalog ? 'category-catalog-layout' : undefined}>
          {isRefinedCatalog ? (
            <aside className="category-refine" aria-label="Refine category results">
              <div className="category-refine-title"><span>Refine by</span><button onClick={() => { setCategoryMinPrice(''); setCategoryMaxPrice(''); setCategoryMinRating('0'); setCategoryConditions([]); setCategorySubcategory('all'); }} type="button">Clear</button></div>
              {categorySubcategories.length ? <fieldset><legend>{mode === 'category' ? 'Type' : 'Category'}</legend><label><input checked={categorySubcategory === 'all'} name="subcategory" onChange={() => setCategorySubcategory('all')} type="radio" /> {mode === 'category' ? `All ${selectedCategory?.name || 'items'}` : 'All categories'}</label>{categorySubcategories.map((subcategory) => <label key={subcategory.id}><input checked={categorySubcategory === subcategory.id} name="subcategory" onChange={() => setCategorySubcategory(subcategory.id)} type="radio" /> {subcategory.name}</label>)}</fieldset> : null}
              <fieldset><legend>Daily price</legend><div className="category-price-fields"><label><span>Minimum</span><input min="0" onChange={(event) => setCategoryMinPrice(event.target.value)} placeholder="₱ 0" type="number" value={categoryMinPrice} /></label><label><span>Maximum</span><input min="0" onChange={(event) => setCategoryMaxPrice(event.target.value)} placeholder="₱ Any" type="number" value={categoryMaxPrice} /></label></div></fieldset>
              <fieldset><legend>Minimum review</legend><select onChange={(event) => setCategoryMinRating(event.target.value)} value={categoryMinRating}><option value="0">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></select></fieldset>
              <fieldset><legend>Condition</legend><div className="category-condition-grid">{[['new','New'],['like_new','Like New'],['good','Good'],['fair','Fair']].map(([value,label]) => <label key={value}><input checked={categoryConditions.includes(value)} onChange={() => toggleCategoryCondition(value)} type="checkbox" /> {label}</label>)}</div></fieldset>
            </aside>
          ) : null}
          <div className={isRefinedCatalog ? 'category-results' : undefined}>
          {isRefinedCatalog ? <div className="category-results-toolbar"><label>Sort by <select onChange={(event) => setCategorySort(event.target.value)} value={categorySort}><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="rating">Highest rated</option></select></label><span>{loading ? 'Loading…' : `${filteredItems.length} rental${filteredItems.length === 1 ? '' : 's'}`}</span></div> : null}
          <div className={`landing-catalog-grid ${isRefinedCatalog ? 'category-product-grid' : ''}`}>
            {filteredItems.map(({ item, barangay, totalViews }) => (
              <article className="landing-trending-card" key={`catalog-${item.id}`} onClick={() => navigate(`/items/${item.id}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate(`/items/${item.id}`); }} role="link" tabIndex="0">
                <div className="landing-item-media">
                  <ProductImage item={item} />
                  {isRefinedCatalog ? (
                    <button aria-label={savedItemIds.has(item.id) ? `Remove ${item.title} from saved listings` : `Save ${item.title}`} aria-pressed={savedItemIds.has(item.id)} className={`category-save-button ${savedItemIds.has(item.id) ? 'saved' : ''}`} disabled={savingItemId === item.id} onClick={(event) => toggleSavedItem(event, item.id)} type="button">
                      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></svg>
                    </button>
                  ) : null}
                </div>
                <span className="landing-item-tag">{item.category?.name || 'Uncategorized'}</span>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {barangay}</small>
                <small className="landing-item-views">{totalViews} view{totalViews === 1 ? '' : 's'}</small>
              </article>
            ))}
            {!loading && filteredItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>
          </div>
          </div>
        </section>
      </main>
    </div>
  );
}
