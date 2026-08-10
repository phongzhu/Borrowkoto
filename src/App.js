import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './api/supabaseClient';
import { useUISettings } from './context/UISettingsContext';
import { RENTABLE_ITEM_STATUSES } from './utils/bookingEnums';
import borrowToolsCampaign from './assets/campaigns/borrow-tools.png';
import borrowTechCampaign from './assets/campaigns/borrow-tech.png';
import borrowWeekendCampaign from './assets/campaigns/borrow-weekend.png';
import './App.css';

const MARKET_CAMPAIGNS = [
  {
    eyebrow: 'DIY without the price tag',
    title: 'Build more. Buy less.',
    description: 'Borrow trusted tools from neighbors and get that weekend project done.',
    action: 'Explore tools',
    image: borrowToolsCampaign,
    tone: 'dark',
  },
  {
    eyebrow: 'Create your best weekend',
    title: 'Big tech. Small daily price.',
    description: 'Cameras, projectors, and speakers—ready when inspiration strikes.',
    action: 'Browse electronics',
    image: borrowTechCampaign,
    tone: 'dark',
  },
  {
    eyebrow: 'Make plans, not purchases',
    title: 'Your next escape starts here.',
    description: 'Rent outdoor essentials nearby and make every weekend count.',
    action: 'Find outdoor gear',
    image: borrowWeekendCampaign,
    tone: 'warm',
  },
];

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
  return String(value || 'Available')
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

function buildRentableStatusFilter() {
  return Array.from(RENTABLE_ITEM_STATUSES).join(',');
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

function RentalIcon({ type }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
    viewBox: '0 0 24 24',
  };

  if (type === 'price') {
    return (
      <svg {...common}>
        <path d="M20 13V7a2 2 0 0 0-2-2h-6L4 13l7 7 9-7Z" />
        <path d="M15 9h.01M9.5 13.5l5 5" />
      </svg>
    );
  }

  if (type === 'return') {
    return (
      <svg {...common}>
        <path d="M9 7H5v4" />
        <path d="M5 11a7 7 0 1 0 2-5" />
        <path d="M12 8v5l3 2" />
      </svg>
    );
  }

  if (type === 'handoff') {
    return (
      <svg {...common}>
        <path d="M4 12h10" />
        <path d="m10 8 4 4-4 4" />
        <path d="M17 7h3v10h-3" />
        <path d="M4 7H2v10h2" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
      <path d="M4.5 9 12 13.2 19.5 9M12 13v7" />
    </svg>
  );
}

function getCategoryIconType(categoryName) {
  const name = String(categoryName || '').toLowerCase();
  if (name.includes('electronic') || name.includes('tech')) return 'price';
  if (name.includes('tool')) return 'handoff';
  if (name.includes('event')) return 'return';
  return 'item';
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

export default function App() {
  const navigate = useNavigate();
  const { settings } = useUISettings();
  const [items, setItems] = useState([]);
  const [mostViewedCounts, setMostViewedCounts] = useState([]);
  const [mostRentedCounts, setMostRentedCounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [barangayFilter, setBarangayFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCampaign, setActiveCampaign] = useState(0);
  const [campaignPaused, setCampaignPaused] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedFilterCategories, setSelectedFilterCategories] = useState([]);
  const [selectedConditions, setSelectedConditions] = useState([]);
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [minimumRating, setMinimumRating] = useState('0');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState([]);
  const [activeRecentIndex, setActiveRecentIndex] = useState(0);
  const [recentCarouselPaused, setRecentCarouselPaused] = useState(false);
  const [activeArrival, setActiveArrival] = useState(0);
  const [arrivalCarouselPaused, setArrivalCarouselPaused] = useState(false);

  const brandName = settings.system_name?.trim() || "Borrow Ko 'To";
  const logoUrl = settings.logo_url?.trim() || '';
  const primary = settings.primary_color?.trim() || '#185a72';
  const primaryText = settings.primary_text_color?.trim() || '#ffffff';
  const secondary = settings.secondary_color?.trim() || '#f3a84f';
  const secondaryText = settings.secondary_text_color?.trim() || '#0f172a';
  const tertiary = settings.tertiary_color?.trim() || '#1f2937';
  const tertiaryText = settings.tertiary_text_color?.trim() || '#e2e8f0';

  useEffect(() => {
    if (campaignPaused) return undefined;
    const timer = window.setInterval(() => {
      setActiveCampaign((current) => (current + 1) % MARKET_CAMPAIGNS.length);
    }, 6500);
    return () => window.clearInterval(timer);
  }, [campaignPaused]);

  useEffect(() => {
    if (!filtersOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [filtersOpen]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('filters') === 'open') {
      setFiltersOpen(true);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadCurrentUser() {
      const { data } = await supabase.auth.getUser();
      if (mounted) setCurrentUser(data?.user || null);
    }

    loadCurrentUser();
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setCurrentUser(session?.user || null);
    });

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!currentUser?.id) {
      setRecentlyViewedIds([]);
      return undefined;
    }

    async function loadRecentlyViewed() {
      const { data, error: historyError } = await supabase
        .from('item_view_history')
        .select('item_id, last_viewed_at')
        .eq('viewer_id', currentUser.id)
        .order('last_viewed_at', { ascending: false })
        .limit(30);

      if (!mounted) return;
      if (historyError) {
        console.warn('Unable to load recently viewed items:', historyError.message);
        setRecentlyViewedIds([]);
        return;
      }
      setRecentlyViewedIds([...new Set((data || []).map((row) => row.item_id).filter(Boolean))].slice(0, 6));
    }

    loadRecentlyViewed();
    return () => { mounted = false; };
  }, [currentUser?.id]);

  useEffect(() => {
    let mounted = true;
    if (!currentUser?.id) {
      setCurrentUserProfile(null);
      return undefined;
    }

    async function loadCurrentUserProfile() {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('first_name, last_name, username, profile_photo_url')
        .eq('id', currentUser.id)
        .maybeSingle();
      if (!mounted) return;
      if (profileError) console.warn('Unable to load member profile:', profileError.message);
      setCurrentUserProfile(data || null);
    }

    loadCurrentUserProfile();
    return () => { mounted = false; };
  }, [currentUser?.id]);

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
          .limit(60),
        supabase
          .from('item_daily_view_counts')
          .select('item_id, total_views')
          .order('total_views', { ascending: false })
          .limit(400),
      ]);

      if (!mounted) return;

      const nextErrors = [];
      const nextCategories = categoriesResult.data || [];
      const rawItems = itemsResult.data || [];

      if (categoriesResult.error) nextErrors.push(`categories: ${categoriesResult.error.message}`);
      if (itemsResult.error) nextErrors.push(`items: ${itemsResult.error.message}`);
      if (viewCountsResult.error) nextErrors.push(`item_daily_view_counts: ${viewCountsResult.error.message}`);
      if (!itemsResult.error && rawItems.length === 0) {
        nextErrors.push(
          `No public rentable items were returned. Check Supabase RLS for public item browsing and make sure items have is_active = true and status = ${buildRentableStatusFilter()}.`
        );
      }

      const itemIds = rawItems.map((item) => item.id);
      const ownerIds = Array.from(new Set(rawItems.map((item) => item.owner_id).filter(Boolean)));
      const categoryMap = new Map(nextCategories.map((category) => [category.id, category]));

      const [imagesResult, ownersResult, ownerRatingsResult, itemSubcategoriesResult, bookingRentalsResult] = await Promise.all([
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
              .select('id, username, is_verified, verification_status, average_rating, total_reviews, street, barangay, city, province, region')
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
        itemIds.length
          ? supabase
              .from('bookings')
              .select('id, item_id, status, total_due, created_at')
              .in('item_id', itemIds)
              .in('status', ['accepted', 'completed'])
          : { data: [], error: null },
      ]);

      if (!mounted) return;

      if (imagesResult.error) nextErrors.push(`item_images: ${imagesResult.error.message}`);
      if (ownersResult.error) nextErrors.push(`profiles: ${ownersResult.error.message}`);
      if (ownerRatingsResult.error) nextErrors.push(`reviews: ${ownerRatingsResult.error.message}`);
      if (itemSubcategoriesResult.error) nextErrors.push(`item_subcategories: ${itemSubcategoriesResult.error.message}`);
      if (bookingRentalsResult.error) nextErrors.push(`bookings: ${bookingRentalsResult.error.message}`);

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
      setMostRentedCounts(bookingRentalsResult.data || []);
      setError(nextErrors.join(' '));
      setLoading(false);
    }

    loadMarketplace();
    return () => {
      mounted = false;
    };
  }, []);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const selectedCategoryIds = categoryFilter === 'all' ? null : buildDescendantIds(categoryFilter, categories);

    return items.filter((item) => {
      if (selectedCategoryIds) {
        const inMainCategory = selectedCategoryIds.has(item.category_id);
        const inSubcategory = (item.subcategoryIds || []).some((subcategoryId) => selectedCategoryIds.has(subcategoryId));
        if (!inMainCategory && !inSubcategory) return false;
      }

      if (selectedFilterCategories.length) {
        const matchesDrawerCategory = selectedFilterCategories.some((categoryId) => {
          const drawerCategoryIds = buildDescendantIds(categoryId, categories);
          return drawerCategoryIds.has(item.category_id) ||
            (item.subcategoryIds || []).some((subcategoryId) => drawerCategoryIds.has(subcategoryId));
        });
        if (!matchesDrawerCategory) return false;
      }

      const dailyPrice = Number(item.rental_price_per_day) || 0;
      if (minimumPrice !== '' && dailyPrice < Number(minimumPrice)) return false;
      if (maximumPrice !== '' && dailyPrice > Number(maximumPrice)) return false;

      if (selectedConditions.length) {
        const normalizedCondition = String(item.item_condition || '').toLowerCase().replaceAll('_', ' ');
        if (!selectedConditions.includes(normalizedCondition)) return false;
      }

      const itemRating = Number(item?.ownerAverageRating ?? item?.owner?.average_rating) || 0;
      if (Number(minimumRating) > 0 && itemRating < Number(minimumRating)) return false;

      if (!q) return true;

      return [
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
        .includes(q);
    });
  }, [categoryFilter, categories, items, maximumPrice, minimumPrice, minimumRating, search, selectedConditions, selectedFilterCategories]);

  const featuredItems = filteredItems;
  const itemsWithBarangay = useMemo(
    () =>
      featuredItems.map((item) => ({
        barangay: detectBaliuagBarangay(item),
        item,
      })),
    [featuredItems]
  );

  const barangayFilteredItems = useMemo(() => {
    const scoped = barangayFilter === 'all'
      ? itemsWithBarangay
      : itemsWithBarangay.filter((entry) => entry.barangay === barangayFilter);

    return scoped
      .slice()
      .sort(
        (left, right) =>
          left.barangay.localeCompare(right.barangay) ||
          String(left.item.title || '').localeCompare(String(right.item.title || ''))
      )
      .map((entry) => entry.item);
  }, [barangayFilter, itemsWithBarangay]);

  const totalViewsByItemId = useMemo(() => {
    const map = new Map();

    mostViewedCounts.forEach((row) => {
      const itemId = row?.item_id;
      if (!itemId) return;
      map.set(itemId, (map.get(itemId) || 0) + (Number(row.total_views) || 0));
    });

    return map;
  }, [mostViewedCounts]);

  const mostViewedItems = useMemo(() => {
    return barangayFilteredItems
      .map((item) => ({
        item,
        totalViews: totalViewsByItemId.get(item.id) || 0,
      }))
      .sort(
        (left, right) =>
          right.totalViews - left.totalViews ||
          String(left.item.title || '').localeCompare(String(right.item.title || ''))
      );
  }, [barangayFilteredItems, totalViewsByItemId]);

  const mostRentedItems = useMemo(() => {
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const statsByItemId = new Map();

    mostRentedCounts.forEach((booking) => {
      const itemId = booking?.item_id;
      if (!itemId || !itemMap.has(itemId)) return;

      const current = statsByItemId.get(itemId) || {
        completedCount: 0,
        rentalCount: 0,
        totalDue: 0,
      };
      const status = String(booking.status || '').toLowerCase();

      statsByItemId.set(itemId, {
        completedCount: current.completedCount + (status === 'completed' ? 1 : 0),
        rentalCount: current.rentalCount + 1,
        totalDue: current.totalDue + (Number(booking.total_due) || 0),
      });
    });

    return Array.from(statsByItemId.entries())
      .map(([itemId, stats]) => ({
        item: itemMap.get(itemId),
        ...stats,
      }))
      .filter((entry) => Boolean(entry.item))
      .sort(
        (left, right) =>
          right.rentalCount - left.rentalCount ||
          right.completedCount - left.completedCount ||
          right.totalDue - left.totalDue ||
          String(left.item.title || '').localeCompare(String(right.item.title || ''))
      )
      .slice(0, 5);
  }, [items, mostRentedCounts]);

  const nearbyItems = useMemo(() => barangayFilteredItems.slice(0, 4), [barangayFilteredItems]);
  const trendingItems = useMemo(() => mostViewedItems.slice(0, 5), [mostViewedItems]);
  const cheapestItems = useMemo(
    () =>
      barangayFilteredItems
        .slice()
        .sort(
          (left, right) =>
            (Number(left.rental_price_per_day) || 0) - (Number(right.rental_price_per_day) || 0) ||
            String(left.title || '').localeCompare(String(right.title || ''))
        )
        .slice(0, 5),
    [barangayFilteredItems]
  );
  const priciestItems = useMemo(
    () =>
      barangayFilteredItems
        .slice()
        .sort(
          (left, right) =>
            (Number(right.rental_price_per_day) || 0) - (Number(left.rental_price_per_day) || 0) ||
            String(left.title || '').localeCompare(String(right.title || ''))
        )
        .slice(0, 5),
    [barangayFilteredItems]
  );
  const quickCategories = useMemo(
    () =>
      categories.map((category) => ({
        id: category.id,
        name: category.name,
      })),
    [categories]
  );
  const parentCategories = useMemo(() => {
    const parents = categories.filter((category) => !category.parent_category_id);
    return parents.length ? parents : categories;
  }, [categories]);
  const categorySections = useMemo(
    () =>
      parentCategories
        .map((category) => {
          const categoryIds = buildDescendantIds(category.id, categories);
          const itemsForCategory = barangayFilteredItems
            .filter((item) => {
              const inMainCategory = categoryIds.has(item.category_id);
              const inSubcategory = (item.subcategoryIds || []).some((subcategoryId) => categoryIds.has(subcategoryId));
              return inMainCategory || inSubcategory;
            })
            .slice(0, 4);

          return {
            category,
            items: itemsForCategory,
          };
        })
        .filter((entry) => entry.items.length),
    [barangayFilteredItems, categories, parentCategories]
  );
  const newArrivalItems = useMemo(
    () =>
      [...barangayFilteredItems]
        .sort((first, second) => new Date(second.created_at || 0).getTime() - new Date(first.created_at || 0).getTime())
        .slice(0, 5),
    [barangayFilteredItems]
  );
  const activeFilterCount = selectedFilterCategories.length + selectedConditions.length +
    (minimumPrice !== '' ? 1 : 0) + (maximumPrice !== '' ? 1 : 0) + (Number(minimumRating) > 0 ? 1 : 0);
  const recentlyViewedItems = useMemo(() => {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return recentlyViewedIds.map((itemId) => itemsById.get(itemId)).filter(Boolean);
  }, [items, recentlyViewedIds]);
  const activeRecentItem = recentlyViewedItems[activeRecentIndex] || recentlyViewedItems[0] || null;

  useEffect(() => {
    if (!currentUser || recentCarouselPaused || recentlyViewedItems.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveRecentIndex((current) => (current + 1) % recentlyViewedItems.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [currentUser, recentCarouselPaused, recentlyViewedItems.length]);

  useEffect(() => {
    if (activeRecentIndex >= recentlyViewedItems.length) setActiveRecentIndex(0);
  }, [activeRecentIndex, recentlyViewedItems.length]);

  useEffect(() => {
    if (arrivalCarouselPaused || newArrivalItems.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setActiveArrival((current) => (current + 1) % newArrivalItems.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [arrivalCarouselPaused, newArrivalItems.length]);

  useEffect(() => {
    if (activeArrival >= newArrivalItems.length) setActiveArrival(0);
  }, [activeArrival, newArrivalItems.length]);

  function toggleFilterValue(value, setter) {
    setter((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value]);
  }

  function clearMarketplaceFilters() {
    setSelectedFilterCategories([]);
    setSelectedConditions([]);
    setMinimumPrice('');
    setMaximumPrice('');
    setMinimumRating('0');
    setCategoryFilter('all');
  }

  function openPublicItem(itemId) {
    if (itemId) {
      navigate(`/items/${itemId}`);
    }
  }

  function openCatalogPage({ categoryId = '', mode = 'all', q = search, barangay = barangayFilter } = {}) {
    const params = new URLSearchParams();

    if (mode && mode !== 'all') {
      params.set('mode', mode);
    }
    if (categoryId) {
      params.set('categoryId', categoryId);
    }
    if (q && q.trim()) {
      params.set('q', q.trim());
    }
    if (barangay && barangay !== 'all') {
      params.set('barangay', barangay);
    }

    const queryString = params.toString();
    navigate(`/items${queryString ? `?${queryString}` : ''}`);
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    openCatalogPage({ mode: 'all' });
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
              <select
                aria-label="Filter by Baliuag barangay"
                id="barangay-filter"
                onChange={(event) => setBarangayFilter(event.target.value)}
                value={barangayFilter}
              >
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
          <button className="landing-filter-trigger" onClick={() => setFiltersOpen(true)} type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
            <span>Filters</span>
            {activeFilterCount ? <b>{activeFilterCount}</b> : null}
          </button>
          <button aria-label={currentUser ? 'Open member dashboard' : 'Sign in'} className={`landing-icon-btn ${currentUser ? 'signed-in' : ''}`} onClick={() => navigate(currentUser ? '/user/dashboard' : '/login')} title={currentUserProfile?.first_name || currentUserProfile?.username || ''} type="button">
            {currentUserProfile?.profile_photo_url ? (
              <img alt="" src={currentUserProfile.profile_photo_url} />
            ) : (
              <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
            )}
          </button>
        </nav>
      </header>

      <div className={`market-filter-layer ${filtersOpen ? 'open' : ''}`} aria-hidden={!filtersOpen}>
        <button aria-label="Close filters" className="market-filter-backdrop" onClick={() => setFiltersOpen(false)} tabIndex={filtersOpen ? 0 : -1} type="button" />
        <aside aria-label="Marketplace filters" aria-modal="true" className="market-filter-drawer" role="dialog">
          <div className="market-filter-header">
            <div><span>Refine your search</span><h2>Filters</h2></div>
            <button aria-label="Close filters" onClick={() => setFiltersOpen(false)} type="button">×</button>
          </div>

          <div className="market-filter-body">
            <fieldset>
              <legend>Categories</legend>
              <div className="market-filter-options market-filter-categories">
                {parentCategories.map((category) => (
                  <label key={`filter-${category.id}`}>
                    <input checked={selectedFilterCategories.includes(category.id)} onChange={() => toggleFilterValue(category.id, setSelectedFilterCategories)} type="checkbox" />
                    <span>{category.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Daily price</legend>
              <div className="market-filter-price">
                <label><span>Minimum</span><div>₱<input min="0" onChange={(event) => setMinimumPrice(event.target.value)} placeholder="0" type="number" value={minimumPrice} /></div></label>
                <i>—</i>
                <label><span>Maximum</span><div>₱<input min="0" onChange={(event) => setMaximumPrice(event.target.value)} placeholder="Any" type="number" value={maximumPrice} /></div></label>
              </div>
            </fieldset>

            <fieldset>
              <legend>Minimum review</legend>
              <div className="market-filter-rating">
                {[0, 3, 4, 4.5].map((rating) => (
                  <button className={Number(minimumRating) === rating ? 'active' : ''} key={rating} onClick={() => setMinimumRating(String(rating))} type="button">
                    {rating === 0 ? 'Any' : `${rating}+ ★`}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Condition</legend>
              <div className="market-filter-options market-filter-condition">
                {['new', 'like new', 'good', 'fair'].map((condition) => (
                  <label key={condition}>
                    <input checked={selectedConditions.includes(condition)} onChange={() => toggleFilterValue(condition, setSelectedConditions)} type="checkbox" />
                    <span>{condition.replace(/\b\w/g, (letter) => letter.toUpperCase())}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="market-filter-footer">
            <button className="clear" onClick={clearMarketplaceFilters} type="button">Clear all</button>
            <button className="apply" onClick={() => setFiltersOpen(false)} type="button">Show {barangayFilteredItems.length} results</button>
          </div>
        </aside>
      </div>

      <section className="landing-categories landing-categories-sticky">
        <div className="landing-categories-grid">
          {quickCategories.map((category) => (
            <button
              aria-pressed={categoryFilter === category.id}
              className={categoryFilter === category.id ? 'active' : ''}
              key={category.id}
              onClick={() => setCategoryFilter((current) => current === category.id ? 'all' : category.id)}
              type="button"
            >
              <span className="landing-category-icon">
                <RentalIcon type={getCategoryIconType(category.name)} />
              </span>
              <strong>{category.name}</strong>
            </button>
          ))}
        </div>
      </section>

      <main className="landing-main">
        {error ? <div className="market-alert">{error}</div> : null}

        {currentUser ? (
          <section className="landing-recently-viewed">
            {activeRecentItem ? (
              <div className="landing-recent-feature" onMouseEnter={() => setRecentCarouselPaused(true)} onMouseLeave={() => setRecentCarouselPaused(false)}>
                <div className="landing-recent-feature-media" key={`recent-media-${activeRecentItem.id}`}><ProductImage item={activeRecentItem} /></div>
                <div className="landing-recent-feature-shade" />
                <div className="landing-recent-feature-copy" key={`recent-copy-${activeRecentItem.id}`}>
                  <span>Continue where you left off</span>
                  <h2>{activeRecentItem.title}</h2>
                  <p>Available in {detectBaliuagBarangay(activeRecentItem)} for <strong>{currencyFormatter.format(Number(activeRecentItem.rental_price_per_day) || 0)} per day</strong>.</p>
                  <div>
                    <button onClick={() => openPublicItem(activeRecentItem.id)} type="button">View again <b aria-hidden="true">→</b></button>
                    <button onClick={() => openCatalogPage({ mode: 'all' })} type="button">Explore more</button>
                  </div>
                </div>
                {recentlyViewedItems.length > 1 ? (
                  <div className="landing-recent-history" aria-label="More recently viewed items">
                    <small>Your viewing history</small>
                    <div>
                      {recentlyViewedItems.slice(0, 5).map((item, index) => (
                        <button aria-label={`Show ${item.title}`} className={activeRecentIndex === index ? 'active' : ''} key={`recent-thumb-${item.id}`} onClick={() => setActiveRecentIndex(index)} title={item.title} type="button">
                          <ProductImage item={item} />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {recentlyViewedItems.length > 1 ? (
                  <div className="landing-recent-progress" aria-label="Recently viewed carousel position">
                    {recentlyViewedItems.map((item, index) => <button aria-label={`Show ${item.title}`} className={activeRecentIndex === index ? 'active' : ''} key={`recent-dot-${item.id}`} onClick={() => setActiveRecentIndex(index)} type="button"><i /></button>)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="landing-recently-empty">
                <span className="landing-recent-eyebrow">Borrow around Baliuag</span>
                <h2>Useful things, shared<br />closer to home.</h2>
                <p>Discover items from trusted neighbors, borrow only what you need, and make more room for what matters.</p>
                <div className="landing-recent-empty-actions">
                  <button onClick={() => openCatalogPage({ mode: 'all' })} type="button">Explore rentals</button>
                  <button onClick={() => navigate('/list-item')} type="button">List an item</button>
                </div>
                <small>Your recently viewed items will appear here once you start exploring.</small>
              </div>
            )}
          </section>
        ) : <>
        <section
          aria-label="Featured rental campaigns"
          aria-roledescription="carousel"
          className="landing-hero landing-campaign-carousel"
          onMouseEnter={() => setCampaignPaused(true)}
          onMouseLeave={() => setCampaignPaused(false)}
        >
          {MARKET_CAMPAIGNS.map((campaign, index) => (
            <article
              aria-hidden={activeCampaign !== index}
              className={`landing-campaign-slide ${campaign.tone} ${activeCampaign === index ? 'active' : ''}`}
              key={campaign.title}
            >
              <img alt="" src={campaign.image} />
              <div className="landing-campaign-shade" />
              <div className="landing-campaign-copy">
                <span>{campaign.eyebrow}</span>
                <h1>{campaign.title}</h1>
                <p>{campaign.description}</p>
                <button onClick={() => openCatalogPage({ mode: 'all' })} tabIndex={activeCampaign === index ? 0 : -1} type="button">
                  {campaign.action}<b aria-hidden="true">→</b>
                </button>
              </div>
            </article>
          ))}

          <button
            aria-label="Previous campaign"
            className="landing-carousel-arrow previous"
            onClick={() => setActiveCampaign((activeCampaign - 1 + MARKET_CAMPAIGNS.length) % MARKET_CAMPAIGNS.length)}
            type="button"
          >‹</button>
          <button
            aria-label="Next campaign"
            className="landing-carousel-arrow next"
            onClick={() => setActiveCampaign((activeCampaign + 1) % MARKET_CAMPAIGNS.length)}
            type="button"
          >›</button>

          <div className="landing-carousel-dots" role="tablist" aria-label="Choose campaign">
            {MARKET_CAMPAIGNS.map((campaign, index) => (
              <button
                aria-label={`Show campaign: ${campaign.title}`}
                aria-selected={activeCampaign === index}
                className={activeCampaign === index ? 'active' : ''}
                key={campaign.title}
                onClick={() => setActiveCampaign(index)}
                role="tab"
                type="button"
              ><i /></button>
            ))}
          </div>
        </section>

        <section className="landing-trust-row">
          <article>
            <RentalIcon type="return" />
            <div>
              <strong>Verified Neighbors</strong>
              <span>Identity checked community members</span>
            </div>
          </article>
          <article>
            <RentalIcon type="item" />
            <div>
              <strong>Insurance Protection</strong>
              <span>Coverage up to {currencyFormatter.format(50000)}</span>
            </div>
          </article>
          <article>
            <RentalIcon type="price" />
            <div>
              <strong>Secure Payments</strong>
              <span>100% secure escrow payments</span>
            </div>
          </article>
        </section>

        <div className="landing-market-divider" aria-hidden="true">
          <div className="landing-editorial-rule">
            <i />
            <span />
            <i />
          </div>
        </div>
        </>}

        {categorySections.length ? (
          <section className="landing-category-editorial">
            <div className="landing-category-editorial-grid">
              {categorySections.slice(0, 4).map(({ category, items: categoryItems }, index) => (
                <button
                  className={`landing-category-feature feature-${index + 1}`}
                  key={category.id}
                  onClick={() => openCatalogPage({ categoryId: category.id, mode: 'all' })}
                  type="button"
                >
                  <ProductImage item={categoryItems[0]} />
                  <span className="landing-category-feature-shade" />
                  <span className="landing-category-feature-label">
                    <small>{categoryItems.length} nearby {categoryItems.length === 1 ? 'item' : 'items'}</small>
                    <strong>{category.name}</strong>
                    <i aria-hidden="true">Explore →</i>
                  </span>
                </button>
              ))}
            </div>
            <div className="landing-category-editorial-copy">
              <span>Borrow around Baliuag</span>
              <h2>Find more. Own less.</h2>
              <p>Explore useful finds shared by people in your community—from everyday essentials to something special for the weekend.</p>
              <button onClick={() => openCatalogPage({ mode: 'all' })} type="button">Explore all categories <b aria-hidden="true">→</b></button>
            </div>
          </section>
        ) : null}

        <section className="landing-nearby-wrap">
          <article className="landing-nearby">
            <div className="landing-section-head landing-collection-head">
              <h2>Available Near You</h2>
            </div>
            <div className="landing-nearby-grid">
              {nearbyItems.map((item) => (
                <button className="landing-item-card" key={item.id} onClick={() => openPublicItem(item.id)} type="button">
                  <div className="landing-item-media">
                    <ProductImage item={item} />
                  </div>
                  <span className="landing-item-tag">{item.category?.name || formatCondition(item.item_condition)}</span>
                  <h3>{item.title}</h3>
                  <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                  <small className="landing-item-rating">{formatItemRating(item)}</small>
                  <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                  <small className="landing-item-meta-line"><b>Located at:</b> {detectBaliuagBarangay(item)}</small>
                  <small>Est. value: {currencyFormatter.format(Number(item.security_deposit) || Number(item.rental_price_per_day) * 10 || 0)}</small>
                </button>
              ))}
              {!loading && nearbyItems.length === 0 ? (
                <p className="landing-empty-note">No listed items for rent.</p>
              ) : null}
            </div>
          </article>
        </section>

        <section className="landing-trending landing-trending-featured">
          <div className="landing-section-head landing-lined-head">
            <div>
              <span className="landing-section-eyebrow">Popular in the community</span>
              <h2>Discover trending rentals</h2>
            </div>
          </div>

          <div className="landing-trending-grid">
            {trendingItems.map(({ item, totalViews }) => (
              <button className="landing-trending-card" key={item.id} onClick={() => openPublicItem(item.id)} type="button">
                <div className="landing-item-media">
                  <ProductImage item={item} />
                  <span className="landing-trending-tile-label">
                    <b>{item.title}</b>
                    <small>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</small>
                  </span>
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {detectBaliuagBarangay(item)}</small>
                <small>* {totalViews || 0} ({mostRentedItems.find((entry) => entry.item.id === item.id)?.rentalCount || 0})</small>
              </button>
            ))}
            {!loading && trendingItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>

          <button className="landing-load-more" onClick={() => setCategoryFilter('all')} type="button">Load More</button>
        </section>

        <section className="landing-trending landing-most-viewed landing-product-shelf">
          <div className="landing-section-head landing-lined-head">
            <h2>Most Viewed</h2>
          </div>

          <div className="landing-trending-grid">
            {mostViewedItems.slice(0, 8).map(({ item, totalViews }) => (
              <button className="landing-trending-card" key={`most-viewed-${item.id}`} onClick={() => openPublicItem(item.id)} type="button">
                <div className="landing-item-media">
                  <ProductImage item={item} />
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {detectBaliuagBarangay(item)}</small>
                <small>{totalViews || 0} view{Number(totalViews || 0) === 1 ? '' : 's'}</small>
              </button>
            ))}
            {!loading && mostViewedItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>
        </section>

        <section className="landing-trending landing-product-shelf">
          <div className="landing-section-head landing-lined-head">
            <h2>Cheapest Rentals</h2>
          </div>
          <div className="landing-trending-grid">
            {cheapestItems.map((item) => (
              <button className="landing-trending-card" key={`cheapest-${item.id}`} onClick={() => openPublicItem(item.id)} type="button">
                <div className="landing-item-media">
                  <ProductImage item={item} />
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {detectBaliuagBarangay(item)}</small>
              </button>
            ))}
            {!loading && cheapestItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>
        </section>

        <section className="landing-trending landing-product-shelf">
          <div className="landing-section-head landing-lined-head">
            <h2>Priciest Rentals</h2>
          </div>
          <div className="landing-trending-grid">
            {priciestItems.map((item) => (
              <button className="landing-trending-card" key={`priciest-${item.id}`} onClick={() => openPublicItem(item.id)} type="button">
                <div className="landing-item-media">
                  <ProductImage item={item} />
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {detectBaliuagBarangay(item)}</small>
              </button>
            ))}
            {!loading && priciestItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>
        </section>

        {newArrivalItems.length ? (
          <section
            aria-label="New arrivals"
            aria-roledescription="carousel"
            className="landing-arrivals-carousel"
            onMouseEnter={() => setArrivalCarouselPaused(true)}
            onMouseLeave={() => setArrivalCarouselPaused(false)}
          >
            {newArrivalItems.map((item, index) => (
              <article
                aria-hidden={activeArrival !== index}
                className={`landing-arrival-slide ${activeArrival === index ? 'active' : ''}`}
                key={`arrival-${item.id}`}
              >
                <ProductImage item={item} />
                <div className="landing-arrival-shade" />
                <div className="landing-arrival-copy">
                  <span>New arrival</span>
                  <h2>{item.title}</h2>
                  <p>
                    Newly available in {detectBaliuagBarangay(item)} for {currencyFormatter.format(Number(item.rental_price_per_day) || 0)} per day.
                  </p>
                  <button onClick={() => openPublicItem(item.id)} tabIndex={activeArrival === index ? 0 : -1} type="button">
                    View item <b aria-hidden="true">→</b>
                  </button>
                </div>
              </article>
            ))}

            {newArrivalItems.length > 1 ? (
              <>
                <button
                  aria-label="Previous new arrival"
                  className="landing-carousel-arrow previous"
                  onClick={() => setActiveArrival((activeArrival - 1 + newArrivalItems.length) % newArrivalItems.length)}
                  type="button"
                >‹</button>
                <button
                  aria-label="Next new arrival"
                  className="landing-carousel-arrow next"
                  onClick={() => setActiveArrival((activeArrival + 1) % newArrivalItems.length)}
                  type="button"
                >›</button>
                <div className="landing-carousel-dots" role="tablist" aria-label="Choose new arrival">
                  {newArrivalItems.map((item, index) => (
                    <button
                      aria-label={`Show ${item.title}`}
                      aria-selected={activeArrival === index}
                      className={activeArrival === index ? 'active' : ''}
                      key={`arrival-dot-${item.id}`}
                      onClick={() => setActiveArrival(index)}
                      role="tab"
                      type="button"
                    ><i /></button>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="landing-category-sections">
          {categorySections.map((entry) => (
            <article className="landing-category-section landing-product-shelf" key={`section-${entry.category.id}`}>
              <div className="landing-section-head">
                <h2>{entry.category.name}</h2>
              </div>
              <div className="landing-trending-grid">
                {entry.items.map((item) => (
                  <button className="landing-trending-card landing-category-ad-card" key={`category-${entry.category.id}-${item.id}`} onClick={() => openPublicItem(item.id)} type="button">
                    <div className="landing-item-media">
                      <ProductImage item={item} />
                      <span className="landing-category-ad-shade" />
                    </div>
                    <span className="landing-category-ad-copy">
                      <h3>{item.title}</h3>
                      <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                      <small>Available in {detectBaliuagBarangay(item)}</small>
                      <b className="landing-category-ad-action">Rent this item <i aria-hidden="true">→</i></b>
                    </span>
                  </button>
                ))}
              </div>
            </article>
          ))}
          {!loading && categorySections.length === 0 ? (
            <p className="landing-empty-note">No listed items for rent.</p>
          ) : null}
        </section>
      </main>

    </div>
  );
}


