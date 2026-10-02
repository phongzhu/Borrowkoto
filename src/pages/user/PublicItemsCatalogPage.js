import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import { useUISettings } from '../../context/UISettingsContext';
import { getNubProgramsForSchool, itemMatchesAcademicFilters, NUB_PROGRAMS, NUB_SCHOOLS } from '../../data/nubAcademicData';
import { RENTABLE_ITEM_STATUSES } from '../../utils/bookingEnums';
import { filterListingsByActiveOwners } from '../../utils/marketplaceVisibility';
import SearchableSelect from '../../ui/SearchableSelect';
import '../../App.css';

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

function formatItemRating(item) {
  const ratingValue = Number(item?.itemAverageRating);
  const reviewCount = Number(item?.itemTotalReviews || 0);

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
  const fields = [
    { text: item.title, weight: 5 },
    { text: [item.category?.name, ...(item.subcategories || []).map((subcategory) => subcategory.name)].join(' '), weight: 4 },
    { text: item.searchTags?.join(' '), weight: 3 },
    { text: [item.description, item.item_condition, getLocation(item)].join(' '), weight: 1 },
  ].map(({ text, weight }) => ({ text: String(text || '').toLowerCase(), weight }));
  return keywords.reduce((score, keyword) => {
    const field = fields.find(({ text }) => text.split(/[^\p{L}\p{N}]+/u).includes(keyword))
      || fields.find(({ text }) => text.includes(keyword));
    return score + (field?.weight || 0);
  }, 0);
}

function searchKeywords(query) {
  return String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
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
  if (imageUrl) return <><img alt={item.title} src={imageUrl} />{item.isPromoted ? <span className="item-promotion-badge">Promoted</span> : null}</>;
  return (
    <><div className="market-product-placeholder">
      <span>{item.title?.slice(0, 1)?.toUpperCase() || 'I'}</span>
    </div>{item.isPromoted ? <span className="item-promotion-badge">Promoted</span> : null}</>
  );
}

export default function PublicItemsCatalogPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings } = useUISettings();

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [mostViewedCounts, setMostViewedCounts] = useState([]);
  const [mostRentedCounts, setMostRentedCounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [savedItemIds, setSavedItemIds] = useState(() => new Set());
  const [savingItemId, setSavingItemId] = useState('');

  const initialQ = searchParams.get('q') || '';
  const initialSchoolCodes = useMemo(() => searchParams.getAll('school').filter(Boolean), [searchParams]);
  const initialProgramCodes = useMemo(() => searchParams.getAll('program').filter(Boolean), [searchParams]);
  const initialSchool = initialSchoolCodes[0] || 'all';
  const initialProgram = initialProgramCodes[0] || 'all';
  const initialFilterCategories = useMemo(() => searchParams.getAll('filterCategory').filter(Boolean), [searchParams]);
  const initialFilterConditions = useMemo(() => searchParams.getAll('condition').filter(Boolean), [searchParams]);
  const initialMinPrice = searchParams.get('minPrice') || '';
  const initialMaxPrice = searchParams.get('maxPrice') || '';
  const initialMinRating = searchParams.get('minRating') || '0';
  const categoryId = searchParams.get('categoryId') || '';
  const requestedMode = searchParams.get('mode') || '';
  const mode = requestedMode || (categoryId ? 'category' : 'all');
  // The general All Rentals catalog shares the same structured browsing UI as
  // category and search results. Curated collection modes keep their simpler
  // presentation when opened directly from the marketplace homepage.
  const isRefinedCatalog = mode === 'all' || mode === 'category' || Boolean(initialQ.trim());

  const [search, setSearch] = useState(initialQ);
  const [schoolFilter, setSchoolFilter] = useState(initialSchool);
  const [programFilter, setProgramFilter] = useState(initialProgram);
  const [categoryMinPrice, setCategoryMinPrice] = useState(initialMinPrice);
  const [categoryMaxPrice, setCategoryMaxPrice] = useState(initialMaxPrice);
  const [categoryMinRating, setCategoryMinRating] = useState(initialMinRating);
  const [categoryConditions, setCategoryConditions] = useState(initialFilterConditions);
  const [filterCategoryIds, setFilterCategoryIds] = useState(initialFilterCategories);
  const [categorySubcategory, setCategorySubcategory] = useState('all');
  const [categoryRefineSearch, setCategoryRefineSearch] = useState('');
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
    setSchoolFilter(initialSchool);
    setProgramFilter(initialProgram);
  }, [initialProgram, initialQ, initialSchool]);

  useEffect(() => {
    setCategoryMinPrice(initialMinPrice);
    setCategoryMaxPrice(initialMaxPrice);
    setCategoryMinRating(initialMinRating);
    setCategoryConditions(initialFilterConditions);
    setFilterCategoryIds(initialFilterCategories);
  }, [initialFilterCategories, initialFilterConditions, initialMaxPrice, initialMinPrice, initialMinRating]);

  useEffect(() => {
    let mounted = true;

    async function loadMarketplace() {
      setLoading(true);
      setError('');

      const [categoriesResult, itemsResult, viewCountsResult, promotionsResult] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name, parent_category_id')
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
          .limit(300),
        supabase
          .from('item_daily_view_counts')
          .select('item_id, total_views')
          .order('total_views', { ascending: false })
          .limit(500),
        supabase
          .from('active_item_promotions')
          .select('item_id'),
      ]);

      if (!mounted) return;

      const nextErrors = [];
      const nextCategories = categoriesResult.data || [];
      const rawItems = itemsResult.data || [];

      if (categoriesResult.error) nextErrors.push(`categories: ${categoriesResult.error.message}`);
      if (itemsResult.error) nextErrors.push(`items: ${itemsResult.error.message}`);
      if (viewCountsResult.error) nextErrors.push(`item_daily_view_counts: ${viewCountsResult.error.message}`);
      if (promotionsResult.error) nextErrors.push(`active_item_promotions: ${promotionsResult.error.message}`);

      const promotedItemIds = new Set((promotionsResult.data || []).map((row) => row.item_id));

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
              .select('id, average_rating, total_reviews, street, barangay, city, province, region, account_status')
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
              .select('item_id, subcategory_id, categories!item_subcategories_subcategory_id_fkey(id, name, parent_category_id)')
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
              .select('item_id, status, total_due')
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
          isPromoted: promotedItemIds.has(item.id),
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

  const totalViewsByItemId = useMemo(() => {
    const map = new Map();

    mostViewedCounts.forEach((row) => {
      const itemId = row?.item_id;
      if (!itemId) return;
      map.set(itemId, (map.get(itemId) || 0) + (Number(row.total_views) || 0));
    });

    return map;
  }, [mostViewedCounts]);

  const rentalStatsByItemId = useMemo(() => {
    const map = new Map();

    mostRentedCounts.forEach((booking) => {
      const itemId = booking?.item_id;
      if (!itemId) return;

      const current = map.get(itemId) || { completedCount: 0, rentalCount: 0, totalDue: 0 };
      const status = String(booking.status || '').toLowerCase();
      map.set(itemId, {
        completedCount: current.completedCount + (status === 'completed' ? 1 : 0),
        rentalCount: current.rentalCount + 1,
        totalDue: current.totalDue + (Number(booking.total_due) || 0),
      });
    });

    return map;
  }, [mostRentedCounts]);

  const baseFilteredItems = useMemo(() => {
    const keywords = searchKeywords(initialQ);
    const schoolCodes = initialSchoolCodes;
    const programCodes = initialProgramCodes;
    let scoped = items
      .filter((item) => itemMatchesAcademicFilters(item, schoolCodes, programCodes))
      .map((item) => ({
        barangay: getLocation(item),
        item,
        totalViews: totalViewsByItemId.get(item.id) || 0,
        ...(rentalStatsByItemId.get(item.id) || { completedCount: 0, rentalCount: 0, totalDue: 0 }),
      }));

    if (keywords.length) {
      scoped = scoped
        .map((entry) => ({ ...entry, relevance: keywordMatchScore(entry.item, keywords) }))
        .filter((entry) => entry.relevance > 0);
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

    if (mode === 'most-rented') {
      return scoped
        .filter((entry) => entry.rentalCount > 0)
        .slice()
        .sort(
          (left, right) =>
            right.rentalCount - left.rentalCount ||
            right.completedCount - left.completedCount ||
            right.totalDue - left.totalDue ||
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
          (right.relevance || 0) - (left.relevance || 0) ||
          new Date(right.item.created_at || 0).getTime() - new Date(left.item.created_at || 0).getTime() ||
          String(left.item.title || '').localeCompare(String(right.item.title || ''))
      );
  }, [categoryId, categories, initialProgramCodes, initialQ, initialSchoolCodes, items, mode, rentalStatsByItemId, totalViewsByItemId]);

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
  const filteredCategorySubcategories = useMemo(() => {
    const query = categoryRefineSearch.trim().toLowerCase();
    if (!query) return categorySubcategories;
    return categorySubcategories.filter((category) => category.name.toLowerCase().includes(query));
  }, [categoryRefineSearch, categorySubcategories]);

  const filteredItems = useMemo(() => {
    if (!isRefinedCatalog) return baseFilteredItems;

    let next = baseFilteredItems.filter(({ item }) => {
      const price = Number(item.rental_price_per_day) || 0;
      const rating = Number(item.itemAverageRating) || 0;
      const normalizedCondition = String(item.item_condition || '').toLowerCase();
      if (filterCategoryIds.length) {
        const matchesFilterCategory = filterCategoryIds.some((id) => {
          const selectedIds = buildDescendantIds(id, categories);
          return selectedIds.has(item.category_id) || (item.subcategoryIds || []).some((subcategoryId) => selectedIds.has(subcategoryId));
        });
        if (!matchesFilterCategory) return false;
      }
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
    if (categorySort === 'rating') next = next.slice().sort((a, b) => Number(b.item.itemAverageRating || 0) - Number(a.item.itemAverageRating || 0));
    if (categorySort === 'newest') next = next.slice().sort((a, b) => new Date(b.item.created_at || 0) - new Date(a.item.created_at || 0));
    return next;
  }, [baseFilteredItems, categories, categoryConditions, categoryMaxPrice, categoryMinPrice, categoryMinRating, categorySort, categorySubcategory, filterCategoryIds, isRefinedCatalog]);

  const activeFilterCount = (schoolFilter !== 'all' ? 1 : 0) +
    (programFilter !== 'all' ? 1 : 0) +
    filterCategoryIds.length +
    (categorySubcategory !== 'all' ? 1 : 0) +
    (categoryMinPrice !== '' ? 1 : 0) +
    (categoryMaxPrice !== '' ? 1 : 0) +
    (Number(categoryMinRating) > 0 ? 1 : 0) +
    categoryConditions.length;

  function toggleCategoryCondition(condition) {
    setCategoryConditions((current) => current.includes(condition) ? current.filter((value) => value !== condition) : [...current, condition]);
  }

  function handleFilterTrigger() {
    if (!isRefinedCatalog) {
      navigate('/?filters=open');
      return;
    }

    document.querySelector('.category-refine')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    if (mode === 'most-rented') return 'Most Rented Rentals';
    if (mode === 'cheapest') return 'Cheapest Rentals';
    if (mode === 'priciest') return 'Priciest Rentals';
    if (mode === 'category') return selectedCategory?.name ? `${selectedCategory.name} Rentals` : 'Category Rentals';
    if (initialQ.trim()) return `Search results for “${initialQ.trim()}”`;
    return 'All Rentals';
  }, [initialQ, mode, selectedCategory]);

  const recommendationHighlights = useMemo(() => {
    const keywords = searchKeywords(initialQ);
    if (!keywords.length || !items.length) return [];

    const schoolCodes = initialSchoolCodes;
    const programCodes = initialProgramCodes;
    let candidates = items
      .filter((item) => itemMatchesAcademicFilters(item, schoolCodes, programCodes))
      .map((item) => ({ barangay: getLocation(item), item }));
    if (categoryId) {
      const categoryIds = buildDescendantIds(categoryId, categories);
      candidates = candidates.filter(({ item }) => categoryIds.has(item.category_id) || (item.subcategoryIds || []).some((id) => categoryIds.has(id)));
    }

    const scored = candidates.map(({ item, barangay }) => {
      const price = Number(item.rental_price_per_day) || 0;
      const rating = Number(item.itemAverageRating) || 0;
      const reviews = Number(item.itemTotalReviews) || 0;
      const quality = rating + conditionScore(item.item_condition) * .35 + Math.min(reviews, 10) * .03;
      return { barangay, item, match: keywordMatchScore(item, keywords), price, quality };
    });
    const matched = scored.filter((entry) => entry.match > 0);
    if (!matched.length) return [];

    const best = matched.slice().sort((a, b) => b.match - a.match || b.quality - a.quality || a.price - b.price)[0];
    const cheapest = matched.slice().sort((a, b) => a.price - b.price || b.match - a.match || b.quality - a.quality)[0];
    const priciest = matched.slice().sort((a, b) => b.price - a.price || b.match - a.match || b.quality - a.quality)[0];

    return [
      { ...best, description: 'Strongest balance of search relevance, condition, reviews, and price.', label: 'Best match', tone: 'best' },
      { ...cheapest, description: 'Lowest daily rental price among the available recommendations.', label: 'Cheapest', tone: 'budget' },
      { ...priciest, description: 'Premium-priced option currently available in this result set.', label: 'Priciest', tone: 'premium' },
    ].filter((entry, index, list) => list.findIndex((candidate) => candidate.item.id === entry.item.id) === index);
  }, [categories, categoryId, initialProgramCodes, initialQ, initialSchoolCodes, items]);

  function updateQuery(next = {}) {
    const params = new URLSearchParams(searchParams);
    const nextQ = typeof next.q === 'string' ? next.q.trim() : search.trim();
    const nextSchool = next.school ?? schoolFilter;
    const nextProgram = next.program ?? programFilter;

    if (nextQ) params.set('q', nextQ);
    else params.delete('q');

    if (nextSchool && nextSchool !== 'all') params.set('school', nextSchool);
    else params.delete('school');
    if (nextProgram && nextProgram !== 'all') params.set('program', nextProgram);
    else params.delete('program');

    setSearchParams(params, { replace: true });
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    updateQuery({ q: search });
  }

  function handleSchoolChange(value) {
    const programStillValid = value === 'all' || getNubProgramsForSchool(value).some((program) => program.code === programFilter);
    const nextProgram = programStillValid ? programFilter : 'all';
    setSchoolFilter(value);
    setProgramFilter(nextProgram);
    updateQuery({ program: nextProgram, school: value });
  }

  function handleProgramChange(value) {
    setProgramFilter(value);
    updateQuery({ program: value });
  }

  if (loading) {
    return <DataLoadingScreen label="Loading marketplace listings" message="Loading available items from the database." title="Finding items to borrow" />;
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
                onChange={handleSchoolChange}
                options={[
                  { label: 'All schools', value: 'all' },
                  ...NUB_SCHOOLS.map((school) => ({ label: school.code, value: school.code })),
                ]}
                placeholder="All schools"
                searchPlaceholder="Search school"
                value={schoolFilter}
              />
              <SearchableSelect
                ariaLabel="Filter by NU Baliwag course"
                onChange={handleProgramChange}
                options={[
                  { label: 'All courses', value: 'all' },
                  ...(schoolFilter === 'all' ? NUB_PROGRAMS : getNubProgramsForSchool(schoolFilter))
                    .map((program) => ({ label: program.displayCode, value: program.code })),
                ]}
                placeholder="All courses"
                searchPlaceholder="Search course"
                value={programFilter}
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
          <button aria-label={activeFilterCount ? `Filters (${activeFilterCount} active)` : 'Filters'} className="landing-filter-trigger" onClick={handleFilterTrigger} type="button">
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
              <div className="category-refine-title"><span>Refine by</span><button onClick={() => { setCategoryMinPrice(''); setCategoryMaxPrice(''); setCategoryMinRating('0'); setCategoryConditions([]); setFilterCategoryIds([]); setCategorySubcategory('all'); }} type="button">Clear</button></div>
              <fieldset><legend>School</legend><select onChange={(event) => handleSchoolChange(event.target.value)} value={schoolFilter}><option value="all">All NU Baliwag schools</option>{NUB_SCHOOLS.map((school) => <option key={school.code} value={school.code}>{school.code} — {school.name}</option>)}</select></fieldset>
              <fieldset><legend>Course</legend><select onChange={(event) => handleProgramChange(event.target.value)} value={programFilter}><option value="all">All undergraduate courses</option>{(schoolFilter === 'all' ? NUB_PROGRAMS : getNubProgramsForSchool(schoolFilter)).map((program) => <option key={program.code} value={program.code}>{program.displayCode} — {program.name}</option>)}</select></fieldset>
              {categorySubcategories.length ? <fieldset><legend>{mode === 'category' ? 'Type' : 'Category'}</legend><input aria-label={`Search ${mode === 'category' ? 'types' : 'categories'}`} className="category-refine-search" onChange={(event) => setCategoryRefineSearch(event.target.value)} placeholder={`Search ${mode === 'category' ? 'type' : 'category'}`} type="search" value={categoryRefineSearch} /><label><input checked={categorySubcategory === 'all'} name="subcategory" onChange={() => setCategorySubcategory('all')} type="radio" /> {mode === 'category' ? `All ${selectedCategory?.name || 'items'}` : 'All categories'}</label>{filteredCategorySubcategories.map((subcategory) => <label key={subcategory.id}><input checked={categorySubcategory === subcategory.id} name="subcategory" onChange={() => setCategorySubcategory(subcategory.id)} type="radio" /> {subcategory.name}</label>)}</fieldset> : null}
              <fieldset><legend>Daily price</legend><div className="category-price-fields"><label><span>Minimum</span><input min="0" onChange={(event) => setCategoryMinPrice(event.target.value)} placeholder="₱ 0" type="number" value={categoryMinPrice} /></label><label><span>Maximum</span><input min="0" onChange={(event) => setCategoryMaxPrice(event.target.value)} placeholder="₱ Any" type="number" value={categoryMaxPrice} /></label></div></fieldset>
              <fieldset><legend>Minimum review</legend><select onChange={(event) => setCategoryMinRating(event.target.value)} value={categoryMinRating}><option value="0">Any rating</option><option value="3">3+ stars</option><option value="4">4+ stars</option><option value="4.5">4.5+ stars</option></select></fieldset>
              <fieldset><legend>Condition</legend><div className="category-condition-grid">{[['new','New'],['like_new','Like New'],['good','Good'],['fair','Fair']].map(([value,label]) => <label key={value}><input checked={categoryConditions.includes(value)} onChange={() => toggleCategoryCondition(value)} type="checkbox" /> {label}</label>)}</div></fieldset>
            </aside>
          ) : null}
          <div className={isRefinedCatalog ? 'category-results' : undefined}>
          {isRefinedCatalog ? <div className="category-results-toolbar"><label>Sort by <select onChange={(event) => setCategorySort(event.target.value)} value={categorySort}><option value="relevance">Relevance</option><option value="newest">Newest</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="rating">Highest rated</option></select></label><span>{loading ? 'Loading…' : `${filteredItems.length} rental${filteredItems.length === 1 ? '' : 's'}`}</span></div> : null}
          <div className={`landing-catalog-grid ${isRefinedCatalog ? 'category-product-grid' : ''}`}>
            {filteredItems.map(({ item, barangay, totalViews, rentalCount }) => (
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
                <small className="landing-item-views">
                  {mode === 'most-rented'
                    ? `${rentalCount} rental${rentalCount === 1 ? '' : 's'}`
                    : `${totalViews} view${totalViews === 1 ? '' : 's'}`}
                </small>
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
