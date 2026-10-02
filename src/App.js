import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './api/supabaseClient';
import { useAuth } from './context/AuthContext';
import { useUISettings } from './context/UISettingsContext';
import { getNubProgramsForSchool, itemMatchesAcademicFilters, NUB_PROGRAMS, NUB_SCHOOLS } from './data/nubAcademicData';
import { RENTABLE_ITEM_STATUSES } from './utils/bookingEnums';
import { filterListingsByActiveOwners, selectPromotedMarketplaceItems } from './utils/marketplaceVisibility';
import DataLoadingScreen from './ui/DataLoadingScreen';
import borrowToolsCampaign from './assets/campaigns/borrow-tools.png';
import borrowTechCampaign from './assets/campaigns/borrow-tech.png';
import borrowWeekendCampaign from './assets/campaigns/borrow-weekend.png';
import SearchableSelect from './ui/SearchableSelect';
import CategoryIcon from './ui/CategoryIcon';
import { Button, Modal } from './ui/primitives';
import './App.css';

const welcomeStorageKey = (userId) => `borrowkoto:landing-welcome-seen:${userId}`;

const MARKET_CAMPAIGNS = [
  {
    eyebrow: 'Course-ready equipment',
    title: 'Build more. Buy less.',
    description: 'Borrow reusable tools approved for your NU Baliwag school or program.',
    action: 'Explore equipment',
    image: borrowToolsCampaign,
    tone: 'dark',
  },
  {
    eyebrow: 'Technology for every program',
    title: 'Big tech. Small daily price.',
    description: 'Laptops, cameras, projectors, and speakers available to all NUB students.',
    action: 'Browse electronics',
    image: borrowTechCampaign,
    tone: 'dark',
  },
  {
    eyebrow: 'Use what your course needs',
    title: 'Access beats ownership.',
    description: 'Find engineering, business, education, hospitality, and architecture equipment.',
    action: 'Browse by school',
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
function getLocation(item) {
  return [item.pickup_city, item.pickup_province].filter(Boolean).join(', ') || 'Location on request';
}

function formatCondition(value) {
  return String(value || 'Available')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatItemProgramAudience(item) {
  if (item?.applies_to_all_programs) return 'All NUB programs';
  const labels = (item?.programCodes || [])
    .map((code) => NUB_PROGRAMS.find((program) => program.code === code)?.displayCode || code)
    .filter(Boolean);
  return labels.join(', ') || item?.category?.name || 'NUB course resource';
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

function ProductImage({ item, promoted = false }) {
  const imageUrl = item.primaryImage?.image_url;
  if (imageUrl) return <><img alt={item.title} src={imageUrl} />{promoted ? <span className="item-promotion-badge">Promoted</span> : null}</>;
  return (
    <><div className="market-product-placeholder">
      <span>{item.title?.slice(0, 1)?.toUpperCase() || 'I'}</span>
    </div>{promoted ? <span className="item-promotion-badge">Promoted</span> : null}</>
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

function getItemArea(item) {
  return getLocation(item);
}

function formatItemRating(item) {
  const ratingValue = Number(item?.itemAverageRating);
  const reviewCount = Number(item?.itemTotalReviews || 0);

  if (Number.isFinite(ratingValue) && ratingValue > 0) {
    return `★ ${ratingValue.toFixed(1)} (${reviewCount})`;
  }

  return 'No reviews yet';
}

export default function App() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { loading: settingsLoading, settings } = useUISettings();
  const [items, setItems] = useState([]);
  const [mostViewedCounts, setMostViewedCounts] = useState([]);
  const [mostRentedCounts, setMostRentedCounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [expandedHeaderCategoryId, setExpandedHeaderCategoryId] = useState('');
  const [expandedFooterCategoryId, setExpandedFooterCategoryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCampaign, setActiveCampaign] = useState(0);
  const [campaignPaused, setCampaignPaused] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedSchoolCodes, setSelectedSchoolCodes] = useState([]);
  const [selectedProgramCodes, setSelectedProgramCodes] = useState([]);
  const [filterCategorySearch, setFilterCategorySearch] = useState('');
  const [selectedFilterCategories, setSelectedFilterCategories] = useState([]);
  const [selectedConditions, setSelectedConditions] = useState([]);
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [minimumRating, setMinimumRating] = useState('0');
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [savedItemIds, setSavedItemIds] = useState(() => new Set());
  const [savingItemId, setSavingItemId] = useState('');
  const [promotedItemIds, setPromotedItemIds] = useState([]);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState([]);
  const [activeRecentIndex, setActiveRecentIndex] = useState(0);
  const [recentCarouselPaused, setRecentCarouselPaused] = useState(false);
  const [activeArrival, setActiveArrival] = useState(0);
  const [arrivalCarouselPaused, setArrivalCarouselPaused] = useState(false);
  const [trendingVisibleCount, setTrendingVisibleCount] = useState(5);

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
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [filtersOpen]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('filters') === 'open') {
      setFiltersOpen(true);
    }
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
      setSavedItemIds(new Set());
      return undefined;
    }

    supabase
      .from('saved_rent_items')
      .select('item_id')
      .eq('user_id', currentUser.id)
      .then(({ data, error: savedError }) => {
        if (!mounted) return;
        if (savedError) {
          console.warn('Unable to load saved listings:', savedError.message);
          return;
        }
        setSavedItemIds(new Set((data || []).map((row) => row.item_id)));
      });

    return () => { mounted = false; };
  }, [currentUser?.id]);

  useEffect(() => {
    let mounted = true;
    supabase.from('active_item_promotions').select('item_id,last_displayed_at').order('last_displayed_at', { ascending: true, nullsFirst: true })
      .then(({ data }) => { if (mounted) setPromotedItemIds((data || []).map((entry) => entry.item_id)); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!currentUser?.id) {
      setCurrentUserProfile(null);
      setShowWelcome(false);
      return undefined;
    }

    async function loadCurrentUserProfile() {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('first_name, last_name, username, profile_photo_url, is_profile_complete, school_code, program_code')
        .eq('id', currentUser.id)
        .maybeSingle();
      if (!mounted) return;
      if (profileError) console.warn('Unable to load member profile:', profileError.message);
      setCurrentUserProfile(data || null);
      const hasSeenWelcome = window.localStorage.getItem(welcomeStorageKey(currentUser.id)) === 'true';
      setShowWelcome(Boolean(data && !data.is_profile_complete && !hasSeenWelcome));
    }

    loadCurrentUserProfile();
    return () => { mounted = false; };
  }, [currentUser?.id]);

  function dismissWelcome() {
    if (currentUser?.id) window.localStorage.setItem(welcomeStorageKey(currentUser.id), 'true');
    setShowWelcome(false);
  }

  function openProfileFromWelcome() {
    dismissWelcome();
    navigate('/user/profile');
  }

  useEffect(() => {
    let mounted = true;

    async function loadMarketplace() {
      setLoading(true);
      setError('');

      const [categoriesResult, itemsResult, viewCountsResult] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name, description, icon_key, icon_url, parent_category_id')
          .eq('is_active', true)
          .order('name', { ascending: true }),
        supabase
          .from('items')
          .select(
            'id, owner_id, category_id, subcategory_id, applies_to_all_programs, title, description, item_condition, rental_price_per_day, security_deposit, pickup_barangay, pickup_city, pickup_province, pickup_region, pickup_street, meetup_notes, status, is_active, created_at'
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

      const [imagesResult, ownersResult, itemRatingsResult, itemSubcategoriesResult, itemProgramsResult, bookingRentalsResult] = await Promise.all([
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
              .select('id, username, is_verified, verification_status, average_rating, total_reviews, street, barangay, city, province, region, account_status')
              .in('id', ownerIds)
          : { data: [], error: null },
        itemIds.length
          ? supabase
              .from('reviews')
              .select('item_id, reviewer_id, rating')
              .in('item_id', itemIds)
              .eq('reviewer_role', 'borrower')
              .not('rating', 'is', null)
          : { data: [], error: null },
        itemIds.length
          ? supabase
              .from('item_subcategories')
              .select('item_id, subcategory_id, categories!item_subcategories_subcategory_id_fkey(id, name, description, parent_category_id)')
              .in('item_id', itemIds)
          : { data: [], error: null },
        itemIds.length
          ? supabase
              .from('item_programs')
              .select('item_id, program_code')
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
      if (itemRatingsResult.error) nextErrors.push(`reviews: ${itemRatingsResult.error.message}`);
      if (itemSubcategoriesResult.error) nextErrors.push(`item_subcategories: ${itemSubcategoriesResult.error.message}`);
      if (itemProgramsResult.error) nextErrors.push(`item_programs: ${itemProgramsResult.error.message}`);
      if (bookingRentalsResult.error) nextErrors.push(`bookings: ${bookingRentalsResult.error.message}`);

      const imagesByItemId = new Map();
      const subcategoriesByItemId = new Map();
      const programCodesByItemId = new Map();
      const ownersById = new Map((ownersResult.data || []).map((owner) => [owner.id, owner]));
      const ownerByItemId = new Map(rawItems.map((item) => [item.id, item.owner_id]));
      const itemRatingStatsById = new Map();

      (itemRatingsResult.data || []).forEach((row) => {
        const itemId = row?.item_id;
        const rating = Number(row?.rating);

        if (!itemId || row?.reviewer_id === ownerByItemId.get(itemId) || !Number.isFinite(rating)) return;

        const current = itemRatingStatsById.get(itemId) || { count: 0, total: 0 };
        itemRatingStatsById.set(itemId, {
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
      (itemProgramsResult.data || []).forEach((row) => {
        const list = programCodesByItemId.get(row.item_id) || [];
        list.push(row.program_code);
        programCodesByItemId.set(row.item_id, list);
      });

      const visibleItems = filterListingsByActiveOwners(rawItems, ownersResult.data || []);
      const nextItems = visibleItems.map((item) => {
        const images = (imagesByItemId.get(item.id) || [])
          .slice()
          .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
        const ownerProfile = ownersById.get(item.owner_id) || null;
        const itemRatingStats = itemRatingStatsById.get(item.id) || null;
        const profileAverageRating = Number(ownerProfile?.average_rating);
        const profileTotalReviews = Number(ownerProfile?.total_reviews || 0);
        const ownerAverageRating = Number.isFinite(profileAverageRating) && profileAverageRating > 0 ? profileAverageRating : null;
        const ownerTotalReviews = profileTotalReviews;
        const itemAverageRating = itemRatingStats?.count ? itemRatingStats.total / itemRatingStats.count : null;
        const itemTotalReviews = itemRatingStats?.count || 0;

        return {
          ...item,
          category: categoryMap.get(item.category_id) || null,
          owner: ownerProfile,
          itemAverageRating,
          itemTotalReviews,
          ownerAverageRating,
          ownerTotalReviews,
          primaryImage: images[0] || null,
          programCodes: programCodesByItemId.get(item.id) || [],
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
    const q = appliedSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (!q) return true;

      return [
        item.title,
        item.description,
        item.category?.name,
        item.category?.description,
        ...(item.subcategories || []).map((subcategory) => subcategory.name),
        ...(item.subcategories || []).map((subcategory) => subcategory.description),
        item.item_condition,
        getLocation(item),
        ...(item.searchTags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [appliedSearch, items]);

  const featuredItems = filteredItems;
  const academicFilteredItems = featuredItems;

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
    return academicFilteredItems
      .map((item) => ({
        item,
        totalViews: totalViewsByItemId.get(item.id) || 0,
      }))
      .sort(
        (left, right) =>
          right.totalViews - left.totalViews ||
          String(left.item.title || '').localeCompare(String(right.item.title || ''))
      );
  }, [academicFilteredItems, totalViewsByItemId]);

  const mostRentedItems = useMemo(() => {
    const itemMap = new Map(academicFilteredItems.map((item) => [item.id, item]));
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
  }, [academicFilteredItems, mostRentedCounts]);

  const nearbyItems = academicFilteredItems;
  const trendingItems = mostViewedItems;
  const visibleTrendingItems = trendingItems.slice(0, trendingVisibleCount);
  const hasMoreTrendingItems = trendingVisibleCount < trendingItems.length;
  const cheapestItems = useMemo(
    () =>
      academicFilteredItems
        .slice()
        .sort(
          (left, right) =>
            (Number(left.rental_price_per_day) || 0) - (Number(right.rental_price_per_day) || 0) ||
            String(left.title || '').localeCompare(String(right.title || ''))
        )
        .slice(0, 5),
    [academicFilteredItems]
  );
  const priciestItems = useMemo(
    () =>
      academicFilteredItems
        .slice()
        .sort(
          (left, right) =>
            (Number(right.rental_price_per_day) || 0) - (Number(left.rental_price_per_day) || 0) ||
            String(left.title || '').localeCompare(String(right.title || ''))
        )
        .slice(0, 5),
    [academicFilteredItems]
  );
  const quickCategories = useMemo(
    () => {
      const mainCategories = categories.filter((category) => !category.parent_category_id);
      const visibleCategories = mainCategories.length ? mainCategories : categories;
      return visibleCategories.map((category) => ({
        description: category.description,
        id: category.id,
        icon_url: category.icon_url,
        icon_key: category.icon_key,
        name: category.name,
      }));
    },
    [categories]
  );
  const subcategoriesByParentId = useMemo(() => {
    const next = new Map();
    categories.forEach((category) => {
      if (!category.parent_category_id) return;
      const siblings = next.get(category.parent_category_id) || [];
      siblings.push(category);
      next.set(category.parent_category_id, siblings);
    });
    return next;
  }, [categories]);
  const parentCategories = useMemo(() => {
    const parents = categories.filter((category) => !category.parent_category_id);
    return parents.length ? parents : categories;
  }, [categories]);
  const filterPrograms = useMemo(() => {
    if (!selectedSchoolCodes.length) return NUB_PROGRAMS;
    return NUB_PROGRAMS.filter((program) => selectedSchoolCodes.includes(program.schoolCode));
  }, [selectedSchoolCodes]);
  const filteredFilterCategories = useMemo(() => {
    const query = filterCategorySearch.trim().toLowerCase();
    if (!query) return parentCategories;
    return parentCategories.filter((category) => {
      const childTerms = categories
        .filter((child) => child.parent_category_id === category.id)
        .flatMap((child) => [child.name, child.description]);
      return [category.name, category.description, ...childTerms]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [categories, filterCategorySearch, parentCategories]);
  const categorySections = useMemo(
    () =>
      parentCategories
        .map((category) => {
          const categoryIds = buildDescendantIds(category.id, categories);
          const itemsForCategory = academicFilteredItems
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
    [academicFilteredItems, categories, parentCategories]
  );
  const newArrivalItems = useMemo(
    () =>
      [...academicFilteredItems]
        .sort((first, second) => new Date(second.created_at || 0).getTime() - new Date(first.created_at || 0).getTime())
        .slice(0, 5),
    [academicFilteredItems]
  );
  const activeFilterCount = selectedSchoolCodes.length + selectedProgramCodes.length + selectedFilterCategories.length + selectedConditions.length +
    (minimumPrice !== '' ? 1 : 0) + (maximumPrice !== '' ? 1 : 0) + (Number(minimumRating) > 0 ? 1 : 0);
  const recentlyViewedItems = useMemo(() => {
    const itemsById = new Map(items.map((item) => [item.id, item]));
    return recentlyViewedIds.map((itemId) => itemsById.get(itemId)).filter(Boolean);
  }, [items, recentlyViewedIds]);
  const activeRecentItem = recentlyViewedItems[activeRecentIndex] || recentlyViewedItems[0] || null;
  const promotedItems = selectPromotedMarketplaceItems(promotedItemIds, items);

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
    setSelectedSchoolCodes([]);
    setSelectedProgramCodes([]);
    setFilterCategorySearch('');
    setSelectedFilterCategories([]);
    setSelectedConditions([]);
    setMinimumPrice('');
    setMaximumPrice('');
    setMinimumRating('0');
  }

  function openPublicItem(itemId) {
    if (itemId) {
      navigate(`/items/${itemId}`);
    }
  }

  async function toggleSavedPromotedItem(event, itemId) {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUser?.id) {
      navigate('/login');
      return;
    }
    if (savingItemId) return;

    const isSaved = savedItemIds.has(itemId);
    setSavingItemId(itemId);
    const result = isSaved
      ? await supabase.from('saved_rent_items').delete().eq('user_id', currentUser.id).eq('item_id', itemId)
      : await supabase.from('saved_rent_items').upsert({ desired_quantity: 1, item_id: itemId, note: null, user_id: currentUser.id }, { onConflict: 'user_id,item_id' });

    if (result.error) {
      setError(result.error.message);
    } else {
      setSavedItemIds((current) => {
        const next = new Set(current);
        if (isSaved) next.delete(itemId);
        else next.add(itemId);
        return next;
      });
    }
    setSavingItemId('');
  }

  function openCatalogPage({ categoryId = '', mode = 'all', q = appliedSearch, schoolCode = selectedSchoolCodes[0] || '', programCode = selectedProgramCodes[0] || '' } = {}) {
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
    if (schoolCode) params.set('school', schoolCode);
    if (programCode) params.set('program', programCode);

    const queryString = params.toString();
    navigate(`/items${queryString ? `?${queryString}` : ''}`);
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    const submittedQuery = search.trim();
    setAppliedSearch(submittedQuery);
    openCatalogPage({ mode: 'all', q: submittedQuery });
  }

  function applyMarketplaceFilters() {
    const params = new URLSearchParams();
    if (appliedSearch.trim()) params.set('q', appliedSearch.trim());
    selectedSchoolCodes.forEach((code) => params.append('school', code));
    selectedProgramCodes.forEach((code) => params.append('program', code));
    selectedFilterCategories.forEach((id) => params.append('filterCategory', id));
    selectedConditions.forEach((condition) => params.append('condition', condition.replaceAll(' ', '_')));
    if (minimumPrice !== '') params.set('minPrice', minimumPrice);
    if (maximumPrice !== '') params.set('maxPrice', maximumPrice);
    if (Number(minimumRating) > 0) params.set('minRating', minimumRating);
    const queryString = params.toString();
    navigate(`/items${queryString ? `?${queryString}` : ''}`);
  }

  function toggleCategoryExpansion(categoryId, setExpandedCategoryId) {
    const subcategories = subcategoriesByParentId.get(categoryId) || [];
    if (!subcategories.length) {
      openCatalogPage({ categoryId, mode: 'all' });
      return;
    }
    setExpandedCategoryId((current) => current === categoryId ? '' : categoryId);
  }

  const expandedHeaderCategory = quickCategories.find((category) => category.id === expandedHeaderCategoryId) || null;
  const expandedHeaderSubcategories = expandedHeaderCategory
    ? subcategoriesByParentId.get(expandedHeaderCategory.id) || []
    : [];

  if (loading || settingsLoading) {
    return (
      <DataLoadingScreen
        fullScreen
        label="Loading the Borrow Ko 'To marketplace"
        message="Loading available items and categories from the database."
        title="Getting the marketplace ready"
      />
    );
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
              <SearchableSelect
                ariaLabel="Filter by NU Baliwag school"
                onChange={(value) => {
                  const nextSchools = value === 'all' ? [] : [value];
                  setSelectedSchoolCodes(nextSchools);
                  setSelectedProgramCodes((current) => current.filter((code) => !value || value === 'all' || getNubProgramsForSchool(value).some((program) => program.code === code)));
                }}
                options={[
                  { label: 'All schools', value: 'all' },
                  ...NUB_SCHOOLS.map((school) => ({ label: school.code, value: school.code })),
                ]}
                placeholder="All schools"
                searchPlaceholder="Search school"
                value={selectedSchoolCodes.length === 1 ? selectedSchoolCodes[0] : 'all'}
              />
              <SearchableSelect
                ariaLabel="Filter by NU Baliwag course"
                onChange={(value) => setSelectedProgramCodes(value === 'all' ? [] : [value])}
                options={[
                  { label: 'All courses', value: 'all' },
                  ...(selectedSchoolCodes.length === 1 ? getNubProgramsForSchool(selectedSchoolCodes[0]) : NUB_PROGRAMS)
                    .map((program) => ({ label: program.displayCode, value: program.code })),
                ]}
                placeholder="All courses"
                searchPlaceholder="Search course"
                value={selectedProgramCodes.length === 1 ? selectedProgramCodes[0] : 'all'}
              />
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
          <button aria-expanded={filtersOpen} className={`landing-filter-trigger ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen((current) => !current)} type="button">
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
        <aside aria-labelledby="market-filter-title" aria-modal="true" className="market-filter-drawer" role="dialog">
          <div className="market-filter-header">
            <div><span>Refine your search</span><h2 id="market-filter-title">Filters</h2></div>
            <button aria-label="Close filters" onClick={() => setFiltersOpen(false)} type="button">×</button>
          </div>

          <div className="market-filter-body">
            <fieldset>
              <legend>Schools</legend>
              <div className="market-filter-options market-filter-academics">
                <label className="market-filter-all-option">
                  <input checked={selectedSchoolCodes.length === 0} onChange={() => setSelectedSchoolCodes([])} type="checkbox" />
                  <span>All schools</span>
                </label>
                {NUB_SCHOOLS.map((school) => (
                  <label key={`filter-school-${school.code}`}>
                    <input checked={selectedSchoolCodes.includes(school.code)} onChange={() => toggleFilterValue(school.code, setSelectedSchoolCodes)} type="checkbox" />
                    <span>{school.code} — {school.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Courses</legend>
              <div className="market-filter-options market-filter-academics">
                <label className="market-filter-all-option">
                  <input checked={selectedProgramCodes.length === 0} onChange={() => setSelectedProgramCodes([])} type="checkbox" />
                  <span>All courses</span>
                </label>
                {filterPrograms.map((program) => (
                  <label key={`filter-program-${program.code}`}>
                    <input checked={selectedProgramCodes.includes(program.code)} onChange={() => toggleFilterValue(program.code, setSelectedProgramCodes)} type="checkbox" />
                    <span>{program.displayCode} — {program.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend>Categories</legend>
              <input
                aria-label="Search categories"
                className="market-filter-search"
                onChange={(event) => setFilterCategorySearch(event.target.value)}
                placeholder="Search category"
                type="search"
                value={filterCategorySearch}
              />
              <div className="market-filter-options market-filter-categories">
                {filteredFilterCategories.map((category) => (
                  <label key={`filter-${category.id}`}>
                    <input checked={selectedFilterCategories.includes(category.id)} onChange={() => toggleFilterValue(category.id, setSelectedFilterCategories)} type="checkbox" />
                    <span className="market-filter-category-label">
                      <i className="market-filter-category-icon">
                        <CategoryIcon iconKey={category.icon_key || getCategoryIconType(category.name)} iconUrl={category.icon_url} size={15} />
                      </i>
                      {category.name}
                    </span>
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
            <button className="apply" onClick={applyMarketplaceFilters} type="button">Show results</button>
          </div>
        </aside>
      </div>

      <section className="landing-categories landing-categories-sticky">
        <div className="landing-categories-grid">
          {quickCategories.map((category) => {
            const hasSubcategories = (subcategoriesByParentId.get(category.id) || []).length > 0;
            const isExpanded = expandedHeaderCategoryId === category.id;
            return (
              <button
                aria-controls={hasSubcategories ? `landing-subcategories-${category.id}` : undefined}
                aria-expanded={hasSubcategories ? isExpanded : undefined}
                className={isExpanded ? 'active' : ''}
                key={category.id}
                onClick={() => toggleCategoryExpansion(category.id, setExpandedHeaderCategoryId)}
                type="button"
              >
                <span className="landing-category-icon">
                  <CategoryIcon iconKey={category.icon_key || getCategoryIconType(category.name)} iconUrl={category.icon_url} size={18} />
                </span>
                <strong>{category.name}</strong>
                {hasSubcategories ? <svg aria-hidden="true" className="landing-category-chevron" viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5" /></svg> : null}
              </button>
            );
          })}
        </div>
        {expandedHeaderCategory && expandedHeaderSubcategories.length ? (
          <div className="landing-subcategories-panel" id={`landing-subcategories-${expandedHeaderCategory.id}`}>
            <span>{expandedHeaderCategory.name}</span>
            <button className="view-all" onClick={() => openCatalogPage({ categoryId: expandedHeaderCategory.id, mode: 'all' })} type="button">
              View all
            </button>
            {expandedHeaderSubcategories.map((subcategory) => (
              <button key={`header-subcategory-${subcategory.id}`} onClick={() => openCatalogPage({ categoryId: subcategory.id, mode: 'all' })} type="button">
                {subcategory.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <main className="landing-main">
        {error ? <div className="market-alert">{error}</div> : null}

        {currentUser && !promotedItems.length ? (
          <section className="landing-recently-viewed">
            {activeRecentItem ? (
              <div className="landing-recent-feature" onMouseEnter={() => setRecentCarouselPaused(true)} onMouseLeave={() => setRecentCarouselPaused(false)}>
                <div className="landing-recent-feature-media" key={`recent-media-${activeRecentItem.id}`}><ProductImage item={activeRecentItem} promoted={promotedItemIds.includes(activeRecentItem.id)} /></div>
                <div className="landing-recent-feature-shade" />
                <div className="landing-recent-feature-copy" key={`recent-copy-${activeRecentItem.id}`}>
                  <span>Continue where you left off</span>
                  <h2>{activeRecentItem.title}</h2>
                  <p>Available in {getItemArea(activeRecentItem)} for <strong>{currencyFormatter.format(Number(activeRecentItem.rental_price_per_day) || 0)} per day</strong>.</p>
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
                          <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
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
                <span className="landing-recent-eyebrow">Borrow within the NUB community</span>
                <h2>Useful things, shared closer to home.</h2>
                <p>Discover items from trusted neighbors, borrow only what you need, and make more room for what matters.</p>
                <div className="landing-recent-empty-actions">
                  <button onClick={() => openCatalogPage({ mode: 'all' })} type="button">Explore rentals</button>
                  {currentUserProfile?.is_profile_complete ? (
                    <button onClick={() => navigate('/user/rental-items/add')} type="button">List an item</button>
                  ) : (
                    <button onClick={() => navigate('/user/profile')} type="button">Finish setting up your account</button>
                  )}
                </div>
                <small>Your recently viewed items will appear here once you start exploring.</small>
              </div>
            )}
          </section>
        ) : !currentUser ? <>
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

        </> : null}

        {promotedItems.length ? (
          <section className="landing-promoted-banner">
            <span aria-hidden="true" className="landing-promoted-decor">
              <i className="decor-arc decor-arc-top" />
              <i className="decor-arc decor-arc-bottom" />
              <i className="decor-dot-grid decor-dot-grid-top" />
              <i className="decor-dot-grid decor-dot-grid-bottom" />
              <i className="decor-rays" />
            </span>
            <div className="landing-promoted-intro">
              <span className="landing-promoted-kicker"><i aria-hidden="true" /><span>Student rentals near you</span></span>
              <h2>Find what you need.<br/>Borrow it <b>nearby.</b></h2>
              <p>Rent useful items from students in your school community.</p>
              <button onClick={() => openCatalogPage({ mode: 'all' })} type="button">Browse all items <b aria-hidden="true">→</b></button>
              <button className="landing-promoted-secondary-cta" onClick={() => navigate(currentUserProfile?.is_profile_complete ? '/user/rental-items/add' : currentUser ? '/user/profile' : '/login')} type="button">List an item</button>
            </div>
            <div className="landing-promoted-list">
              {promotedItems.map((item) => (
                <button key={item.id} onClick={() => openPublicItem(item.id)} type="button">
                  <span className="landing-promoted-media"><ProductImage item={item}/><em><b aria-hidden="true">ϟ</b> Promoted</em><i aria-label={savedItemIds.has(item.id) ? `Remove ${item.title} from saved listings` : `Save ${item.title}`} aria-pressed={savedItemIds.has(item.id)} className={`landing-promoted-favorite ${savedItemIds.has(item.id) ? 'saved' : ''} ${savingItemId === item.id ? 'saving' : ''}`} onClick={(event)=>toggleSavedPromotedItem(event,item.id)} onKeyDown={(event)=>{if(event.key==='Enter'||event.key===' '){toggleSavedPromotedItem(event,item.id)}}} role="button" tabIndex="0">{savedItemIds.has(item.id) ? '♥' : '♡'}</i><span className="landing-promoted-features"><i>◖ <b>Powerful<br/>performance</b></i><i>⌁ <b>Easy to<br/>use</b></i><i>▣ <b>Rental<br/>ready</b></i></span></span>
                  <span className="landing-promoted-content"><span className="landing-promoted-category">{formatItemProgramAudience(item)}</span><strong>{item.title}</strong><b>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} <i>/ day</i></b><small className="landing-promoted-meta"><i>Reusable</i><i>{formatCondition(item.item_condition)}</i><i>{getItemArea(item)}</i></small><small className="landing-promoted-rating">{formatItemRating(item)}</small><span className="landing-promoted-action">View rental details <i>→</i></span></span>
                </button>
              ))}
            </div>
            {recentlyViewedItems.length ? <aside className="landing-promoted-history"><small>Your viewing history</small><div>{recentlyViewedItems.slice(0,3).map((item)=><button aria-label={`View ${item.title}`} key={`promoted-history-${item.id}`} onClick={()=>openPublicItem(item.id)} type="button"><ProductImage item={item}/></button>)}</div></aside> : null}
          </section>
        ) : null}

        {!currentUser ? <section className="landing-trust-row landing-trust-row-after-promotion">
          <article><RentalIcon type="return" /><div><strong>Registry-linked Students</strong><span>Active members from the official NUB roster</span></div></article>
          <article><RentalIcon type="item" /><div><strong>Insurance Protection</strong><span>Coverage up to {currencyFormatter.format(50000)}</span></div></article>
          <article><RentalIcon type="price" /><div><strong>Secure Payments</strong><span>100% secure escrow payments</span></div></article>
        </section> : null}

        {categorySections.length ? (
          <section className="landing-category-editorial">
            <div aria-label="Marketplace categories" className="landing-category-editorial-grid" role="region" tabIndex={0}>
              {categorySections.map(({ category, items: categoryItems }, index) => (
                <button
                  className={`landing-category-feature feature-${index + 1}`}
                  key={category.id}
                  onClick={() => openCatalogPage({ categoryId: category.id, mode: 'all' })}
                  type="button"
                >
                  <ProductImage item={categoryItems[0]} promoted={promotedItemIds.includes(categoryItems[0].id)} />
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
              <span>Reusable equipment for NUB students</span>
              <h2>Find more. Own less.</h2>
              <p>Explore useful finds shared by people in your community—from everyday essentials to something special for the weekend.</p>
              <button onClick={() => openCatalogPage({ mode: 'all' })} type="button">Explore all categories <b aria-hidden="true">→</b></button>
            </div>
          </section>
        ) : null}

        {newArrivalItems.length ? (
          <section
            aria-label="New arrivals"
            aria-roledescription="carousel"
            className="landing-arrivals-carousel"
            onMouseEnter={() => setArrivalCarouselPaused(true)}
            onMouseLeave={() => setArrivalCarouselPaused(false)}
          >
            {newArrivalItems.map((item, index) => (
              <article aria-hidden={activeArrival !== index} className={`landing-arrival-slide ${activeArrival === index ? 'active' : ''}`} key={`arrival-${item.id}`}>
                <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
                <div className="landing-arrival-shade" />
                <div className="landing-arrival-copy">
                  <span>New arrival</span><h2>{item.title}</h2>
                  <p>Newly available in {getItemArea(item)} for {currencyFormatter.format(Number(item.rental_price_per_day) || 0)} per day.</p>
                  <button onClick={() => openPublicItem(item.id)} tabIndex={activeArrival === index ? 0 : -1} type="button">View item <b aria-hidden="true">→</b></button>
                </div>
              </article>
            ))}
            {newArrivalItems.length > 1 ? <><button aria-label="Previous new arrival" className="landing-carousel-arrow previous" onClick={() => setActiveArrival((activeArrival - 1 + newArrivalItems.length) % newArrivalItems.length)} type="button">‹</button><button aria-label="Next new arrival" className="landing-carousel-arrow next" onClick={() => setActiveArrival((activeArrival + 1) % newArrivalItems.length)} type="button">›</button><div className="landing-carousel-dots" role="tablist" aria-label="Choose new arrival">{newArrivalItems.map((item, index) => <button aria-label={`Show ${item.title}`} aria-selected={activeArrival === index} className={activeArrival === index ? 'active' : ''} key={`arrival-dot-${item.id}`} onClick={() => setActiveArrival(index)} role="tab" type="button"><i /></button>)}</div></> : null}
          </section>
        ) : null}

        <section className="landing-nearby-wrap">
          <article className="landing-nearby">
            <div className="landing-section-head landing-collection-head">
              <h2>Available for Your School or Course</h2>
            </div>
            <div aria-label="Available rentals" className="landing-nearby-grid" role="region" tabIndex={0}>
              {nearbyItems.map((item) => (
                <button className="landing-item-card" key={item.id} onClick={() => openPublicItem(item.id)} type="button">
                  <div className="landing-item-media">
                    <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
                  </div>
                  <span className="landing-item-tag">{item.category?.name || formatCondition(item.item_condition)}</span>
                  <h3>{item.title}</h3>
                  <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                  <small className="landing-item-rating">{formatItemRating(item)}</small>
                  <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                  <small className="landing-item-meta-line"><b>Located at:</b> {getItemArea(item)}</small>
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
            {visibleTrendingItems.map(({ item, totalViews }) => (
              <button className="landing-trending-card" key={item.id} onClick={() => openPublicItem(item.id)} type="button">
                <div className="landing-item-media">
                  <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
                  <span className="landing-trending-tile-label">
                    <b>{item.title}</b>
                    <small>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</small>
                  </span>
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {getItemArea(item)}</small>
                <small>* {totalViews || 0} ({mostRentedItems.find((entry) => entry.item.id === item.id)?.rentalCount || 0})</small>
              </button>
            ))}
            {!loading && visibleTrendingItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>

          <button
            className="landing-load-more"
            onClick={() => {
              if (hasMoreTrendingItems) {
                setTrendingVisibleCount((current) => Math.min(current + 5, trendingItems.length));
                return;
              }
              openCatalogPage({ mode: 'most-viewed' });
            }}
            type="button"
          >
            {hasMoreTrendingItems ? 'Load More' : 'View all most viewed'}
          </button>
        </section>

        <section className="landing-trending landing-most-viewed landing-product-shelf">
          <div className="landing-section-head landing-lined-head">
            <div className="landing-shelf-heading">
              <h2>Most Viewed</h2>
            </div>
          </div>

          <div className="landing-trending-grid">
            {mostViewedItems.slice(0, 8).map(({ item, totalViews }) => (
              <button className="landing-trending-card" key={`most-viewed-${item.id}`} onClick={() => openPublicItem(item.id)} type="button">
                <div className="landing-item-media">
                  <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {getItemArea(item)}</small>
                <small>{totalViews || 0} view{Number(totalViews || 0) === 1 ? '' : 's'}</small>
              </button>
            ))}
            {!loading && mostViewedItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>
        </section>

        <section className="landing-trending landing-most-rented landing-product-shelf">
          <div className="landing-section-head landing-lined-head">
            <div className="landing-shelf-heading">
              <h2>Most Rented</h2>
            </div>
          </div>

          <div className="landing-trending-grid">
            {mostRentedItems.map(({ item, rentalCount }) => (
              <button className="landing-trending-card" key={`most-rented-${item.id}`} onClick={() => openPublicItem(item.id)} type="button">
                <div className="landing-item-media">
                  <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{rentalCount} rental{rentalCount === 1 ? '' : 's'}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {getItemArea(item)}</small>
              </button>
            ))}
            {!loading && mostRentedItems.length === 0 ? (
              <p className="landing-empty-note">No rental history yet.</p>
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
                  <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {getItemArea(item)}</small>
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
                  <ProductImage item={item} promoted={promotedItemIds.includes(item.id)} />
                </div>
                <h3>{item.title}</h3>
                <strong>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)} / day</strong>
                <small className="landing-item-rating">{formatItemRating(item)}</small>
                <small className="landing-item-meta-line"><b>Condition:</b> {formatCondition(item.item_condition)}</small>
                <small className="landing-item-meta-line"><b>Located at:</b> {getItemArea(item)}</small>
              </button>
            ))}
            {!loading && priciestItems.length === 0 ? (
              <p className="landing-empty-note">No listed items for rent.</p>
            ) : null}
          </div>
        </section>

      </main>

      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <div className="landing-footer-brand-lockup">
            <span className="landing-brand-mark">
              <LogoMark brandName={brandName} logoUrl={logoUrl} />
            </span>
            <h2>{brandName}</h2>
          </div>
          <p>{settings.system_tagline?.trim() || 'Borrow what you need. Share what you have.'}</p>
          <p className="landing-footer-description">A reusable-equipment marketplace for verified NU Baliwag students, wherever they are located.</p>
        </div>

        <nav aria-label="Browse all categories" className="landing-footer-categories">
          <h3>Browse all categories</h3>
          <div className="landing-footer-category-grid">
            {quickCategories.map((category) => {
              const subcategories = subcategoriesByParentId.get(category.id) || [];
              const isExpanded = expandedFooterCategoryId === category.id;
              return (
                <div className="landing-footer-category-group" key={`footer-category-${category.id}`}>
                  <button
                    aria-controls={subcategories.length ? `footer-subcategories-${category.id}` : undefined}
                    aria-expanded={subcategories.length ? isExpanded : undefined}
                    className="landing-footer-category-parent"
                    onClick={() => toggleCategoryExpansion(category.id, setExpandedFooterCategoryId)}
                    type="button"
                  >
                    <span>{category.name}</span>
                    {subcategories.length ? <svg aria-hidden="true" className={isExpanded ? 'expanded' : ''} viewBox="0 0 20 20"><path d="m5 7.5 5 5 5-5" /></svg> : null}
                  </button>
                  {isExpanded && subcategories.length ? (
                    <div className="landing-footer-subcategories" id={`footer-subcategories-${category.id}`}>
                      <button className="view-all" onClick={() => openCatalogPage({ categoryId: category.id, mode: 'all' })} type="button">View all {category.name}</button>
                      {subcategories.map((subcategory) => (
                        <button key={`footer-subcategory-${subcategory.id}`} onClick={() => openCatalogPage({ categoryId: subcategory.id, mode: 'all' })} type="button">
                          {subcategory.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </nav>

        <p className="landing-footer-note">© {new Date().getFullYear()} {brandName}. Built for the NU Baliwag student community.</p>
      </footer>

      <Modal
        actions={
          <>
            <Button onClick={dismissWelcome} variant="ghost">Maybe later</Button>
            <Button className="first-login-welcome-primary" onClick={openProfileFromWelcome}>Complete my profile</Button>
          </>
        }
        contentClassName="first-login-welcome-modal"
        onClose={dismissWelcome}
        open={showWelcome}
        size="compact"
        title="Welcome to Borrow Ko 'To!"
      >
        <div className="first-login-welcome-content">
          <div className="first-login-welcome-logo">
            {logoUrl ? <img alt="Borrow Ko 'To logo" src={logoUrl} /> : <span>{(settings.logo_icon || 'BK').slice(0, 3)}</span>}
          </div>
          <div>
            <h3>Let’s finish setting up your account.</h3>
            <p>Review your NUB registry details, then complete your contact information and address. You can also add a profile photo before borrowing or listing items.</p>
          </div>
        </div>
      </Modal>

    </div>
  );
}


