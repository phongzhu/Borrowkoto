import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import DataLoadingScreen from '../../ui/DataLoadingScreen';
import AdminShell from './AdminShell';
import { CatalogIcon, CheckIcon, ShieldIcon, UsersIcon } from '../../ui/icons';
import { SectionGrid } from '../../ui/layouts';
import { Badge, Button, FormField, Input, MetricCard, Modal, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';
import CategoryIcon, { CATEGORY_ICON_OPTIONS } from '../../ui/CategoryIcon';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const CATEGORY_ICONS_BUCKET = 'category-icons';
const CATEGORY_ICON_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
const MAX_CATEGORY_ICON_SIZE = 1024 * 1024;

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

function buildOwnerName(profile) {
  return [profile?.first_name, profile?.middle_name, profile?.last_name, profile?.suffix].filter(Boolean).join(' ');
}

function buildItemLocation(item) {
  return [item.pickup_barangay, item.pickup_city, item.pickup_province, item.pickup_country].filter(Boolean).join(', ');
}

function formatDate(value) {
  if (!value) {
    return 'Not set';
  }

  const nextDate = new Date(value);

  if (Number.isNaN(nextDate.getTime())) {
    return 'Not set';
  }

  return dateFormatter.format(nextDate);
}

function formatDateTime(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}

function itemStatusTone(status) {
  if (!status) {
    return 'info';
  }

  const normalized = status.toLowerCase();

  if (normalized === 'available') {
    return 'success';
  }

  if (['archived', 'unavailable'].includes(normalized)) {
    return 'danger';
  }

  if (['draft', 'on_loan', 'reserved'].includes(normalized)) {
    return 'warning';
  }

  return 'info';
}

function activeTone(isActive) {
  return isActive ? 'success' : 'warning';
}

function normalizeCategoryName(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function validateCategoryIcon(file) {
  if (!CATEGORY_ICON_TYPES.includes(file?.type)) {
    return 'Choose a PNG, JPEG, WebP, or SVG icon.';
  }

  if (file.size > MAX_CATEGORY_ICON_SIZE) {
    return 'Category icons must be 1 MB or smaller.';
  }

  return '';
}

async function uploadCategoryIcon(file) {
  const extension = String(file.name || '').split('.').pop()?.toLowerCase() || 'png';
  const filePath = `categories/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(CATEGORY_ICONS_BUCKET).upload(filePath, file, {
    contentType: file.type,
  });

  if (uploadError) {
    throw new Error(`Icon upload failed: ${uploadError.message}`);
  }

  return supabase.storage.from(CATEGORY_ICONS_BUCKET).getPublicUrl(filePath).data.publicUrl;
}

export default function ManageCatalog() {
  const [activeCatalogTab, setActiveCatalogTab] = useState('items');
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [categoryTypeFilter, setCategoryTypeFilter] = useState('all');
  const [categoryStatusFilter, setCategoryStatusFilter] = useState('active');
  const [categoryForm, setCategoryForm] = useState({
    description: '',
    icon_key: 'box',
    name: '',
    parent_category_id: '',
  });
  const [categoryIconFile, setCategoryIconFile] = useState(null);
  const [categoryIconPreview, setCategoryIconPreview] = useState('');
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemStatusFilter, setItemStatusFilter] = useState('active');
  const [viewingItem, setViewingItem] = useState(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingCategoryForm, setEditingCategoryForm] = useState({
    description: '',
    icon_key: 'box',
    is_active: true,
    name: '',
    parent_category_id: '',
  });
  const [editingCategoryIconFile, setEditingCategoryIconFile] = useState(null);
  const [editingCategoryIconPreview, setEditingCategoryIconPreview] = useState('');
  const [updatingCategory, setUpdatingCategory] = useState(false);

  async function loadCatalog(showLoader = true) {
    if (showLoader) {
      setLoading(true);
    }

    const [categoriesResult, itemsResult] = await Promise.all([
      supabase.from('categories').select('id, name, description, icon_key, icon_url, parent_category_id, is_active, created_at, updated_at').order('name', { ascending: true }),
      supabase
        .from('items')
        .select(
          'id, owner_id, category_id, title, description, item_condition, rental_price_per_day, security_deposit, estimated_value, min_rental_days, max_rental_days, quantity, pickup_barangay, pickup_city, pickup_province, pickup_country, meetup_notes, status, is_active, created_at, updated_at'
        )
        .order('created_at', { ascending: false }),
    ]);

    const nextErrors = [];
    const nextCategories = categoriesResult.data || [];
    const rawItems = itemsResult.data || [];

    if (categoriesResult.error) {
      nextErrors.push(`categories: ${categoriesResult.error.message}`);
    }

    if (itemsResult.error) {
      nextErrors.push(`items: ${itemsResult.error.message}`);
    }

    const categoryMap = new Map(nextCategories.map((category) => [category.id, category]));
    const ownerIds = Array.from(new Set(rawItems.map((item) => item.owner_id).filter(Boolean)));
    const itemIds = rawItems.map((item) => item.id);

    const [ownersResult, imagesResult, blocksResult, itemSubcategoriesResult] = await Promise.all([
      ownerIds.length
        ? supabase.from('profiles').select('id, first_name, middle_name, last_name, suffix, username').in('id', ownerIds)
        : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? supabase.from('item_images').select('id, item_id, image_url, is_primary, sort_order').in('item_id', itemIds).order('sort_order', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? supabase
            .from('item_availability_blocks')
            .select('id, item_id, start_datetime, end_datetime, reason, block_type')
            .in('item_id', itemIds)
            .order('start_datetime', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      itemIds.length
        ? supabase
            .from('item_subcategories')
            .select('item_id, subcategory_id, categories!item_subcategories_subcategory_id_fkey(id, name, parent_category_id, is_active)')
            .in('item_id', itemIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (ownersResult.error) {
      nextErrors.push(`profiles: ${ownersResult.error.message}`);
    }

    if (imagesResult.error) {
      nextErrors.push(`item_images: ${imagesResult.error.message}`);
    }

    if (blocksResult.error) {
      nextErrors.push(`item_availability_blocks: ${blocksResult.error.message}`);
    }
    if (itemSubcategoriesResult.error) {
      nextErrors.push(`item_subcategories: ${itemSubcategoriesResult.error.message}`);
    }

    const ownerMap = new Map((ownersResult.data || []).map((profile) => [profile.id, profile]));
    const imagesByItemId = new Map();
    const blocksByItemId = new Map();
    const subcategoriesByItemId = new Map();

    (imagesResult.data || []).forEach((image) => {
      const current = imagesByItemId.get(image.item_id) || [];
      current.push(image);
      imagesByItemId.set(image.item_id, current);
    });

    (blocksResult.data || []).forEach((block) => {
      const current = blocksByItemId.get(block.item_id) || [];
      current.push(block);
      blocksByItemId.set(block.item_id, current);
    });
    (itemSubcategoriesResult.data || []).forEach((row) => {
      const current = subcategoriesByItemId.get(row.item_id) || [];
      if (row.categories) {
        current.push(row.categories);
      }
      subcategoriesByItemId.set(row.item_id, current);
    });

    const nextItems = rawItems.map((item) => {
      const images = (imagesByItemId.get(item.id) || []).slice().sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || left.sort_order - right.sort_order);
      const blocks = blocksByItemId.get(item.id) || [];

      return {
        ...item,
        availabilityBlocks: blocks,
        category: categoryMap.get(item.category_id) || null,
        images,
        owner: ownerMap.get(item.owner_id) || null,
        subcategories: subcategoriesByItemId.get(item.id) || [],
        subcategory_ids: (subcategoriesByItemId.get(item.id) || []).map((subcategory) => subcategory.id),
      };
    });

    setCategories(nextCategories);
    setItems(nextItems);
    setError(nextErrors.join(' '));
    setLoading(false);
  }

  useEffect(() => {
    loadCatalog();
  }, []);

  const categoryCountMap = useMemo(() => {
    const counts = new Map();

    items.forEach((item) => {
      counts.set(item.category_id, (counts.get(item.category_id) || 0) + 1);
      (item.subcategory_ids || []).forEach((subcategoryId) => {
        counts.set(subcategoryId, (counts.get(subcategoryId) || 0) + 1);
      });
    });

    return counts;
  }, [items]);

  const totalCategories = categories.length;
  const activeCategories = useMemo(() => categories.filter((category) => category.is_active).length, [categories]);
  const totalItems = items.length;
  const activeItems = useMemo(() => items.filter((item) => item.is_active).length, [items]);
  const filteredCategories = useMemo(() => {
    const statusFilteredCategories = categoryStatusFilter === 'all'
      ? categories
      : categories.filter((category) => categoryStatusFilter === 'active' ? category.is_active : !category.is_active);

    if (categoryTypeFilter === 'main') {
      return statusFilteredCategories.filter((category) => !category.parent_category_id);
    }

    if (categoryTypeFilter === 'sub') {
      return statusFilteredCategories.filter((category) => Boolean(category.parent_category_id));
    }

    return statusFilteredCategories;
  }, [categories, categoryStatusFilter, categoryTypeFilter]);
  const showParentCategoryColumn = filteredCategories.some((category) => Boolean(category.parent_category_id));
  const editingSubcategories = useMemo(() => {
    if (!editingCategory) {
      return [];
    }

    return categories.filter((category) => category.parent_category_id === editingCategory.id);
  }, [categories, editingCategory]);

  const categoryOptions = useMemo(
    () =>
      categories
        .filter((category) => !category.parent_category_id)
        .map((category) => ({
        label: category.name,
        value: category.id,
      })),
    [categories]
  );

  const itemStatusOptions = [
    { label: 'Active listings', value: 'active' },
    { label: 'Inactive listings', value: 'inactive' },
    { label: 'All listings', value: 'all' },
  ];

  const filteredItems = useMemo(() => {
    const normalizedSearch = itemSearch.trim().toLowerCase();

    return items.filter((item) => {
      if (itemStatusFilter === 'active' && !item.is_active) {
        return false;
      }

      if (itemStatusFilter === 'inactive' && item.is_active) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        item.title,
        item.description,
        item.status,
        item.item_condition,
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
  }, [itemSearch, itemStatusFilter, items]);

  function handleCategoryFormChange(event) {
    setCategoryForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  function openAddCategory() {
    setCategoryForm({
      description: '',
      icon_key: 'box',
      name: '',
      parent_category_id: '',
    });
    setCategoryIconFile(null);
    setCategoryIconPreview('');
    setShowAddCategory(true);
  }

  function closeAddCategory() {
    setShowAddCategory(false);
    setSavingCategory(false);
    setCategoryIconFile(null);
    setCategoryIconPreview('');
  }

  function handleCategoryIconChange(event, editing = false) {
    const file = event.target.files?.[0];
    if (!file) return;

    const validationError = validateCategoryIcon(file);
    if (validationError) {
      setMessage(validationError);
      setMessageTone('warning');
      event.target.value = '';
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    if (editing) {
      setEditingCategoryIconFile(file);
      setEditingCategoryIconPreview(previewUrl);
    } else {
      setCategoryIconFile(file);
      setCategoryIconPreview(previewUrl);
    }
    setMessage('');
  }

  async function handleCreateCategory(event) {
    event.preventDefault();
    setMessage('');

    const trimmedName = categoryForm.name.trim();

    if (!trimmedName) {
      setMessage('Category name is required.');
      setMessageTone('warning');
      return;
    }

    const normalizedName = normalizeCategoryName(trimmedName);
    const selectedParentId = categoryForm.parent_category_id || null;
    const duplicateCategory = categories.find(
      (category) => normalizeCategoryName(category.name || '') === normalizedName
        && (category.parent_category_id || null) === selectedParentId
    );

    if (duplicateCategory) {
      setMessage('Category name already exists under the selected parent.');
      setMessageTone('warning');
      return;
    }

    setSavingCategory(true);

    let iconUrl = null;
    try {
      iconUrl = categoryIconFile ? await uploadCategoryIcon(categoryIconFile) : null;
    } catch (iconError) {
      setMessage(iconError.message);
      setMessageTone('warning');
      setSavingCategory(false);
      return;
    }

    const { error: insertError } = await supabase.from('categories').insert([
      {
        description: categoryForm.description.trim() || null,
        icon_key: categoryForm.icon_key || 'box',
        icon_url: iconUrl,
        is_active: true,
        name: trimmedName,
        parent_category_id: categoryForm.parent_category_id || null,
      },
    ]);

    if (insertError) {
      setMessage(`Unable to save category: ${insertError.message}`);
      setMessageTone('warning');
      setSavingCategory(false);
      return;
    }

    setCategoryForm({
      description: '',
      icon_key: 'box',
      name: '',
      parent_category_id: '',
    });
    setCategoryIconFile(null);
    setCategoryIconPreview('');
    setMessage('Category saved.');
    setMessageTone('success');
    setSavingCategory(false);
    setShowAddCategory(false);
    await loadCatalog(false);
  }

  function openEditCategory(category) {
    setEditingCategory(category);
    setEditingCategoryForm({
      description: category.description || '',
      icon_key: category.icon_key || 'box',
      is_active: category.is_active,
      name: category.name || '',
      parent_category_id: category.parent_category_id || '',
    });
    setEditingCategoryIconFile(null);
    setEditingCategoryIconPreview(category.icon_url || '');
  }

  function closeEditCategory() {
    setEditingCategory(null);
    setUpdatingCategory(false);
    setEditingCategoryIconFile(null);
    setEditingCategoryIconPreview('');
  }

  function handleEditCategoryChange(event) {
    const { name, type, checked, value } = event.target;

    setEditingCategoryForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  async function handleUpdateCategory(event) {
    event.preventDefault();

    if (!editingCategory) {
      return;
    }

    const trimmedName = editingCategoryForm.name.trim();

    if (!trimmedName) {
      setMessage('Category name is required.');
      setMessageTone('warning');
      return;
    }

    const normalizedName = normalizeCategoryName(trimmedName);
    const selectedParentId = editingCategoryForm.parent_category_id || null;
    const duplicateCategory = categories.find(
      (category) => category.id !== editingCategory.id
        && normalizeCategoryName(category.name || '') === normalizedName
        && (category.parent_category_id || null) === selectedParentId
    );

    if (duplicateCategory) {
      setMessage('Category name already exists under the selected parent.');
      setMessageTone('warning');
      return;
    }

    setUpdatingCategory(true);
    setMessage('');

    let iconUrl = editingCategory.icon_url || null;
    try {
      if (editingCategoryIconFile) {
        iconUrl = await uploadCategoryIcon(editingCategoryIconFile);
      }
    } catch (iconError) {
      setMessage(iconError.message);
      setMessageTone('warning');
      setUpdatingCategory(false);
      return;
    }

    const { error: updateError } = await supabase
      .from('categories')
      .update({
        description: editingCategoryForm.description.trim() || null,
        icon_key: editingCategoryForm.icon_key || 'box',
        icon_url: iconUrl,
        is_active: Boolean(editingCategoryForm.is_active),
        name: trimmedName,
        parent_category_id: editingCategoryForm.parent_category_id || null,
      })
      .eq('id', editingCategory.id);

    if (updateError) {
      setMessage(`Unable to update category: ${updateError.message}`);
      setMessageTone('warning');
      setUpdatingCategory(false);
      return;
    }

    setMessage('Category updated.');
    setMessageTone('success');
    setUpdatingCategory(false);
    closeEditCategory();
    await loadCatalog(false);
  }

  if (loading) {
    return (
      <AdminShell subtitle="" title="">
        <DataLoadingScreen label="Loading catalog" message="Loading categories and listings from the database." title="Getting the catalog" />
      </AdminShell>
    );
  }

  return (
    <AdminShell subtitle="" title="">
      {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}

      <SectionGrid columns={4}>
        <MetricCard
          detail="Rows currently loaded from the categories table."
          icon={<CatalogIcon size={18} />}
          label="Categories"
          tone={theme.colors.coral}
          value={loading ? 'Loading...' : `${totalCategories}`}
        />
        <MetricCard
          detail="Categories that are currently marked active."
          icon={<CheckIcon size={18} />}
          label="Active categories"
          tone={theme.colors.success}
          value={loading ? 'Loading...' : `${activeCategories}`}
        />
        <MetricCard
          detail="All item records currently returned from the catalog."
          icon={<UsersIcon size={18} />}
          label="Items"
          tone={theme.colors.sky}
          value={loading ? 'Loading...' : `${totalItems}`}
        />
        <MetricCard
          detail="Listings that are still marked active in the items table."
          icon={<ShieldIcon size={18} />}
          label="Active listings"
          tone={theme.colors.amber}
          value={loading ? 'Loading...' : `${activeItems}`}
        />
      </SectionGrid>

      <div aria-label="Catalog sections" className="admin-inner-tabs" role="tablist">
        <button
          aria-selected={activeCatalogTab === 'categories'}
          className={activeCatalogTab === 'categories' ? 'active' : ''}
          onClick={() => setActiveCatalogTab('categories')}
          role="tab"
          type="button"
        >
          Categories
        </button>
        <button
          aria-selected={activeCatalogTab === 'items'}
          className={activeCatalogTab === 'items' ? 'active' : ''}
          onClick={() => setActiveCatalogTab('items')}
          role="tab"
          type="button"
        >
          Items
        </button>
      </div>

      {activeCatalogTab === 'categories' ? (
      <Panel className="catalog-categories-panel">
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
            <div style={{ display: 'grid', gap: 4 }}>
              <strong
                style={{
                  color: theme.colors.ink,
                  fontFamily: theme.fonts.display,
                  fontSize: 22,
                  letterSpacing: '-0.05em',
                }}
              >
                Categories
              </strong>
              <span style={{ color: theme.colors.slate, lineHeight: 1.6 }}>
                Manage parent categories and subcategories from one table.
              </span>
            </div>
            <div className="admin-category-toolbar" style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <label style={{ display: 'grid', gap: 8, minWidth: 220 }}>
                <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Category type</span>
                <select
                  name="category_type_filter"
                  onChange={(event) => setCategoryTypeFilter(event.target.value)}
                  style={{
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
                  }}
                  value={categoryTypeFilter}
                >
                  <option value="all">All categories</option>
                  <option value="main">Main categories</option>
                  <option value="sub">Subcategories</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 8, minWidth: 220 }}>
                <span style={{ color: theme.colors.ink, fontSize: 14, fontWeight: 600 }}>Category status</span>
                <select
                  name="category_status_filter"
                  onChange={(event) => setCategoryStatusFilter(event.target.value)}
                  style={{
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
                  }}
                  value={categoryStatusFilter}
                >
                  <option value="active">Active categories</option>
                  <option value="inactive">Inactive categories</option>
                  <option value="all">All categories</option>
                </select>
              </label>
              <Badge style={{ alignSelf: 'flex-end', marginBottom: 2 }} tone="info">
                {loading ? 'Loading categories' : `${filteredCategories.length} shown`}
              </Badge>
              <Button onClick={openAddCategory} type="button">
                Add category
              </Button>
            </div>
          </div>

          {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
          {loading ? <DataLoadingScreen label="Loading categories" message="Loading catalog categories from the database." title="Getting categories" /> : null}
          {!loading && !filteredCategories.length ? <StatusMessage tone="info">No categories match the current type and status filters.</StatusMessage> : null}

          {!loading && filteredCategories.length ? (
            <div
              className="catalog-category-table-wrap"
              style={{
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                maxHeight: 640,
                overflowX: 'auto',
                overflowY: 'auto',
              }}
            >
              <table className={`catalog-category-table${showParentCategoryColumn ? '' : ' is-main-only'}`} style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: showParentCategoryColumn ? 980 : 840, width: '100%' }}>
                <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                  <tr>
                    <th style={headerCellStyle}>Category</th>
                    {showParentCategoryColumn ? <th style={headerCellStyle}>Parent</th> : null}
                    <th style={headerCellStyle}>Description</th>
                    <th style={headerCellStyle}>Items</th>
                    <th style={headerCellStyle}>Status</th>
                    <th style={headerCellStyle}>Updated</th>
                    <th style={headerCellStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCategories.map((category) => {
                    const parentCategory = categories.find((item) => item.id === category.parent_category_id);

                    return (
                      <tr key={category.id}>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span className="catalog-category-table-title">{category.name}</span>
                          </div>
                        </td>
                        {showParentCategoryColumn ? (
                          <td style={bodyCellStyle}>
                            <span style={{ color: theme.colors.ink }}>{parentCategory?.name || '—'}</span>
                          </td>
                        ) : null}
                        <td style={bodyCellStyle}>
                          <span style={{ color: theme.colors.ink, lineHeight: 1.65 }}>{category.description || 'No description'}</span>
                        </td>
                        <td style={bodyCellStyle}>
                          <span style={{ color: theme.colors.ink }}>{categoryCountMap.get(category.id) || 0}</span>
                        </td>
                        <td style={bodyCellStyle}>
                          <Badge tone={activeTone(category.is_active)}>{category.is_active ? 'Active' : 'Inactive'}</Badge>
                        </td>
                        <td style={bodyCellStyle}>
                          <span style={{ color: theme.colors.ink }}>{formatDate(category.updated_at)}</span>
                        </td>
                        <td style={bodyCellStyle}>
                          <Button onClick={() => openEditCategory(category)} type="button" variant="secondary">
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Panel>
      ) : null}

      {activeCatalogTab === 'items' ? (
      <Panel className="catalog-items-panel">
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="form-grid admin-filter-toolbar catalog-item-toolbar" style={{ alignItems: 'end', display: 'grid', gap: 14 }}>
            <FormField label="Search items">
              <Input name="item_search" onChange={(event) => setItemSearch(event.target.value)} value={itemSearch} />
            </FormField>

            <FormField label="Listing status">
              <select
                name="item_status"
                onChange={(event) => setItemStatusFilter(event.target.value)}
                style={{
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
                }}
                value={itemStatusFilter}
              >
                {itemStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>

            <Badge style={{ alignSelf: 'center', justifySelf: 'flex-start', marginBottom: 2 }} tone="info">
              {loading ? 'Loading catalog' : `${filteredItems.length} shown`}
            </Badge>
          </div>

          {loading ? <DataLoadingScreen label="Loading item catalog" message="Loading catalog items from the database." title="Getting catalog items" /> : null}
          {!loading && !filteredItems.length ? <StatusMessage tone="info">No items found for the current search and listing status filter.</StatusMessage> : null}

          {!loading && filteredItems.length ? (
            <div
              className="catalog-item-table-wrap"
              style={{
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: 14,
                maxHeight: 'min(620px, 65vh)',
                overscrollBehavior: 'contain',
                overflowX: 'auto',
                overflowY: 'auto',
              }}
            >
              <table className="catalog-item-table" style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1180, width: '100%' }}>
                <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                  <tr>
                    <th style={headerCellStyle}>Item</th>
                    <th style={headerCellStyle}>Owner</th>
                    <th style={headerCellStyle}>Category</th>
                    <th style={headerCellStyle}>Rental</th>
                    <th style={headerCellStyle}>Status</th>
                    <th style={headerCellStyle}>View item</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const ownerName = buildOwnerName(item.owner);

                    return (
                      <tr key={item.id}>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span className="catalog-item-table-title">{item.title}</span>
                          </div>
                        </td>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span style={{ color: theme.colors.ink }}>{ownerName || 'No name saved'}</span>
                            <span style={{ color: theme.colors.slate }}>{item.owner?.username ? `@${item.owner.username}` : 'No username'}</span>
                          </div>
                        </td>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span style={{ color: theme.colors.ink }}>{item.category?.name || 'No category'}</span>
                            <span style={{ color: theme.colors.slate }}>{item.item_condition || 'No condition'}</span>
                          </div>
                        </td>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span style={{ color: theme.colors.ink }}>{currencyFormatter.format(Number(item.rental_price_per_day) || 0)}/day</span>
                            <span style={{ color: theme.colors.slate }}>Deposit: {currencyFormatter.format(Number(item.security_deposit) || 0)}</span>
                          </div>
                        </td>
                        <td style={bodyCellStyle}>
                          <Badge tone={item.is_active ? itemStatusTone(item.status) : 'neutral'}>
                            {item.is_active ? item.status || 'Unknown' : 'Inactive'}
                          </Badge>
                        </td>
                        <td style={bodyCellStyle}>
                          <Button onClick={() => setViewingItem(item)} type="button" variant="secondary">View item</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Panel>
      ) : null}

      <Modal
        actions={<Button onClick={() => setViewingItem(null)} type="button" variant="secondary">Close</Button>}
        contentClassName="catalog-item-detail-modal"
        onClose={() => setViewingItem(null)}
        open={Boolean(viewingItem)}
        title={viewingItem?.title || 'Item details'}
      >
        {viewingItem ? (
          <div className="catalog-item-detail-content">
            <div className="catalog-item-detail-heading">
              <div className="catalog-item-detail-badges">
                <Badge tone={itemStatusTone(viewingItem.status)}>{viewingItem.status || 'Unknown'}</Badge>
                <Badge tone={activeTone(viewingItem.is_active)}>{viewingItem.is_active ? 'Active listing' : 'Inactive listing'}</Badge>
              </div>
              <p>{viewingItem.description || 'No description provided.'}</p>
            </div>

            <section className="catalog-item-detail-section">
              <h4>Item information</h4>
              <dl className="catalog-item-detail-grid">
                <div><dt>Owner</dt><dd>{buildOwnerName(viewingItem.owner) || 'No name saved'}{viewingItem.owner?.username ? ` (@${viewingItem.owner.username})` : ''}</dd></div>
                <div><dt>Category</dt><dd>{viewingItem.category?.name || 'No category'}</dd></div>
                <div><dt>Subcategories</dt><dd>{viewingItem.subcategories?.length ? viewingItem.subcategories.map((category) => category.name).join(', ') : 'None'}</dd></div>
                <div><dt>Condition</dt><dd>{viewingItem.item_condition || 'Not specified'}</dd></div>
                <div><dt>Rental price</dt><dd>{currencyFormatter.format(Number(viewingItem.rental_price_per_day) || 0)} per day</dd></div>
                <div><dt>Security deposit</dt><dd>{currencyFormatter.format(Number(viewingItem.security_deposit) || 0)}</dd></div>
                <div><dt>Estimated value</dt><dd>{viewingItem.estimated_value == null ? 'Not set' : currencyFormatter.format(Number(viewingItem.estimated_value) || 0)}</dd></div>
                <div><dt>Quantity</dt><dd>{viewingItem.quantity ?? 'Not set'}</dd></div>
                <div><dt>Rental period</dt><dd>{viewingItem.min_rental_days ?? '—'} to {viewingItem.max_rental_days ?? '—'} days</dd></div>
                <div><dt>Location</dt><dd>{buildItemLocation(viewingItem) || 'Not set'}</dd></div>
                <div><dt>Created</dt><dd>{formatDate(viewingItem.created_at)}</dd></div>
                <div><dt>Last updated</dt><dd>{formatDate(viewingItem.updated_at)}</dd></div>
              </dl>
              {viewingItem.meetup_notes ? <div className="catalog-item-detail-notes"><strong>Pickup / meetup notes</strong><p>{viewingItem.meetup_notes}</p></div> : null}
            </section>

            <section className="catalog-item-detail-section">
              <h4>Item images <span>{viewingItem.images?.length || 0}</span></h4>
              {viewingItem.images?.length ? (
                <div className="catalog-item-detail-images">
                  {viewingItem.images.map((image, index) => (
                    <a href={image.image_url} key={image.id || image.image_url} rel="noreferrer" target="_blank">
                      <img alt={`${viewingItem.title}, view ${index + 1}`} loading="lazy" src={image.image_url} />
                      {image.is_primary ? <span>Primary</span> : null}
                    </a>
                  ))}
                </div>
              ) : <p className="catalog-item-detail-muted">No images have been added.</p>}
            </section>

            <section className="catalog-item-detail-section">
              <h4>Availability blocks <span>{viewingItem.availabilityBlocks?.length || 0}</span></h4>
              {viewingItem.availabilityBlocks?.length ? (
                <div className="catalog-item-block-list">
                  {viewingItem.availabilityBlocks.map((block) => (
                    <article key={block.id}>
                      <div><strong>{block.block_type || 'Unavailable'}</strong><Badge tone="info">{block.reason || 'No reason provided'}</Badge></div>
                      <span>{formatDateTime(block.start_datetime)} – {formatDateTime(block.end_datetime)}</span>
                    </article>
                  ))}
                </div>
              ) : <p className="catalog-item-detail-muted">No availability blocks.</p>}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        actions={
          <>
            <Button onClick={closeAddCategory} variant="ghost">
              Cancel
            </Button>
            <Button disabled={savingCategory} onClick={handleCreateCategory} type="submit">
              {savingCategory ? 'Saving...' : 'Add category'}
            </Button>
          </>
        }
        onClose={closeAddCategory}
        open={showAddCategory}
        title="Add category"
        contentClassName="category-editor-modal"
        contentStyle={{ width: 'min(920px, calc(100vw - 32px))' }}
      >
        <form className="category-editor-form" id="add-category-form" onSubmit={handleCreateCategory}>
          <div className="category-editor-fields">
          <FormField label="Category name" required>
            <Input name="name" onChange={handleCategoryFormChange} required value={categoryForm.name} />
          </FormField>

          <FormField label="Parent category">
            <select
              name="parent_category_id"
              onChange={handleCategoryFormChange}
              style={{
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
              }}
              value={categoryForm.parent_category_id}
            >
              <option value="">No parent</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Description">
            <Textarea name="description" onChange={handleCategoryFormChange} value={categoryForm.description} />
          </FormField>
          </div>

          <section className="category-icon-studio">
            <div className="category-icon-studio-heading"><div className="category-icon-live-preview"><CategoryIcon iconKey={categoryForm.icon_key} iconUrl={categoryIconPreview} size={34} /></div><div><strong>Choose an icon</strong><small>Preview updates instantly</small></div></div>
            <div className="category-vector-grid">
              {CATEGORY_ICON_OPTIONS.map((option) => <button aria-label={option.label} aria-pressed={!categoryIconPreview && categoryForm.icon_key === option.key} className={!categoryIconPreview && categoryForm.icon_key === option.key ? 'active' : ''} key={option.key} onClick={() => { setCategoryForm((current) => ({ ...current, icon_key: option.key })); setCategoryIconFile(null); setCategoryIconPreview(''); }} title={option.label} type="button"><CategoryIcon iconKey={option.key} size={22}/><span>{option.label}</span></button>)}
            </div>
            <FormField label="Or upload your own">
              <div className="admin-category-icon-field">
              <label className="admin-category-icon-upload">
                <input accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => handleCategoryIconChange(event)} type="file" />
                <span>{categoryIconFile ? 'Choose a different icon' : 'Upload icon'}</span>
              </label>
              {categoryIconPreview ? <img alt="New category icon preview" src={categoryIconPreview} /> : null}
              <small>PNG, JPEG, WebP, or SVG. Maximum 1 MB.</small>
              </div>
            </FormField>
          </section>
        </form>
      </Modal>

      <Modal
        actions={
          <>
            <Button onClick={closeEditCategory} variant="ghost">
              Cancel
            </Button>
            <Button disabled={updatingCategory} onClick={handleUpdateCategory} type="submit">
              {updatingCategory ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        }
        onClose={closeEditCategory}
        open={Boolean(editingCategory)}
        title={editingCategory ? `Edit ${editingCategory.name}` : 'Edit category'}
        contentClassName="category-editor-modal"
        contentStyle={{ width: 'min(1040px, calc(100vw - 32px))' }}
      >
        <form
          id="edit-category-form"
          className="responsive-modal-grid responsive-scroll-form"
          onSubmit={handleUpdateCategory}
          style={{
            display: 'grid',
            gap: 18,
            gridTemplateColumns: 'minmax(340px, 1.05fr) minmax(380px, 1fr)',
            maxHeight: '70vh',
            overflowY: 'auto',
            paddingRight: 6,
          }}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <FormField label="Category name" required>
              <Input name="name" onChange={handleEditCategoryChange} required value={editingCategoryForm.name} />
            </FormField>

            <FormField label="Parent category">
              <select
                name="parent_category_id"
                onChange={handleEditCategoryChange}
                style={{
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
                }}
                value={editingCategoryForm.parent_category_id}
              >
                <option value="">No parent</option>
                {categoryOptions
                  .filter((option) => option.value !== editingCategory?.id)
                  .map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
              </select>
            </FormField>

            <FormField label="Description">
              <Textarea name="description" onChange={handleEditCategoryChange} value={editingCategoryForm.description} />
            </FormField>

            <FormField label="Category icon">
              <div className="category-icon-studio-heading"><div className="category-icon-live-preview"><CategoryIcon iconKey={editingCategoryForm.icon_key} iconUrl={editingCategoryIconPreview} size={34} /></div><div><strong>Live preview</strong><small>Shown across the marketplace</small></div></div>
              <div className="category-vector-grid compact">
                {CATEGORY_ICON_OPTIONS.map((option) => <button aria-label={option.label} aria-pressed={!editingCategoryIconPreview && editingCategoryForm.icon_key === option.key} className={!editingCategoryIconPreview && editingCategoryForm.icon_key === option.key ? 'active' : ''} key={option.key} onClick={() => { setEditingCategoryForm((current) => ({ ...current, icon_key: option.key })); setEditingCategoryIconFile(null); setEditingCategoryIconPreview(''); }} title={option.label} type="button"><CategoryIcon iconKey={option.key} size={20}/></button>)}
              </div>
              <div className="admin-category-icon-field">
                <label className="admin-category-icon-upload">
                  <input accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => handleCategoryIconChange(event, true)} type="file" />
                  <span>{editingCategoryIconPreview ? 'Replace icon' : 'Upload icon'}</span>
                </label>
                {editingCategoryIconPreview ? <img alt={`${editingCategory?.name || 'Category'} icon preview`} src={editingCategoryIconPreview} /> : null}
                <small>Custom icons appear on the landing page and category filters.</small>
              </div>
            </FormField>

            <label style={{ alignItems: 'center', color: theme.colors.ink, display: 'flex', gap: 10, fontWeight: 600 }}>
              <input checked={editingCategoryForm.is_active} name="is_active" onChange={handleEditCategoryChange} type="checkbox" />
              Category is active
            </label>
          </div>

          <div
            style={{
              background: alpha(theme.colors.panel, 0.7),
              border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
              borderRadius: 12,
              display: 'grid',
              alignContent: 'start',
              gap: 12,
              maxHeight: 'calc(70vh - 12px)',
              overflow: 'hidden',
              padding: 16,
            }}
          >
            <div style={{ display: 'grid', gap: 4 }}>
              <strong
                style={{
                  color: theme.colors.ink,
                  fontFamily: theme.fonts.display,
                  fontSize: 18,
                  letterSpacing: '-0.04em',
                }}
              >
                Subcategories
              </strong>
              <span style={{ color: theme.colors.slate, lineHeight: 1.6 }}>
                View the child categories currently linked to this category.
              </span>
            </div>

            {editingSubcategories.length ? (
              <div
                style={{
                  border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                  maxHeight: '100%',
                  overflowY: 'auto',
                }}
              >
                <table style={{ background: alpha(theme.colors.panel, 0.84), borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
                  <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                    <tr>
                      <th style={{ ...headerCellStyle, padding: '0 14px 12px' }}>Name</th>
                      <th style={{ ...headerCellStyle, padding: '0 14px 12px' }}>Items</th>
                      <th style={{ ...headerCellStyle, padding: '0 14px 12px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editingSubcategories.map((subcategory) => (
                      <tr key={subcategory.id}>
                        <td style={{ ...bodyCellStyle, padding: '14px' }}>
                          <div style={{ display: 'grid', gap: 3 }}>
                            <strong style={{ color: theme.colors.ink, fontSize: 15 }}>{subcategory.name}</strong>
                            <span style={{ color: theme.colors.slate, fontFamily: theme.fonts.mono, fontSize: 11 }}>{subcategory.id}</span>
                          </div>
                        </td>
                        <td style={{ ...bodyCellStyle, padding: '14px' }}>
                          <span style={{ color: theme.colors.ink }}>{categoryCountMap.get(subcategory.id) || 0}</span>
                        </td>
                        <td style={{ ...bodyCellStyle, padding: '14px' }}>
                          <Badge tone={activeTone(subcategory.is_active)}>{subcategory.is_active ? 'Active' : 'Inactive'}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <span style={{ color: theme.colors.slate, lineHeight: 1.6 }}>No subcategories are linked to this category.</span>
            )}
          </div>
        </form>
      </Modal>
    </AdminShell>
  );
}
