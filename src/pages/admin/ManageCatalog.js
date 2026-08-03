import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import AdminShell from './AdminShell';
import { CatalogIcon, CheckIcon, ShieldIcon, UsersIcon } from '../../ui/icons';
import { SectionGrid } from '../../ui/layouts';
import { Badge, Button, FormField, Input, MetricCard, Modal, Panel, StatusMessage, Textarea } from '../../ui/primitives';
import { alpha, theme } from '../../ui/theme';

const currencyFormatter = new Intl.NumberFormat('en-PH', {
  currency: 'PHP',
  style: 'currency',
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
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

export default function ManageCatalog() {
  const [categories, setCategories] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('success');
  const [categoryTypeFilter, setCategoryTypeFilter] = useState('all');
  const [categoryForm, setCategoryForm] = useState({
    description: '',
    name: '',
    parent_category_id: '',
  });
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [itemStatusFilter, setItemStatusFilter] = useState('all');
  const [savingCategory, setSavingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingCategoryForm, setEditingCategoryForm] = useState({
    description: '',
    is_active: true,
    name: '',
    parent_category_id: '',
  });
  const [updatingCategory, setUpdatingCategory] = useState(false);

  async function loadCatalog(showLoader = true) {
    if (showLoader) {
      setLoading(true);
    }

    const [categoriesResult, itemsResult] = await Promise.all([
      supabase.from('categories').select('id, name, description, parent_category_id, is_active, created_at, updated_at').order('name', { ascending: true }),
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
        blockCount: blocks.length,
        category: categoryMap.get(item.category_id) || null,
        owner: ownerMap.get(item.owner_id) || null,
        primaryImage: images[0] || null,
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
    if (categoryTypeFilter === 'main') {
      return categories.filter((category) => !category.parent_category_id);
    }

    if (categoryTypeFilter === 'sub') {
      return categories.filter((category) => Boolean(category.parent_category_id));
    }

    return categories;
  }, [categories, categoryTypeFilter]);
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

  const itemStatusOptions = useMemo(() => ['all', ...Array.from(new Set(items.map((item) => item.status).filter(Boolean))).sort()], [items]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = itemSearch.trim().toLowerCase();

    return items.filter((item) => {
      if (itemStatusFilter !== 'all' && item.status !== itemStatusFilter) {
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
      name: '',
      parent_category_id: '',
    });
    setShowAddCategory(true);
  }

  function closeAddCategory() {
    setShowAddCategory(false);
    setSavingCategory(false);
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
    const duplicateCategory = categories.find((category) => normalizeCategoryName(category.name || '') === normalizedName);

    if (duplicateCategory) {
      setMessage('Category name already exists.');
      setMessageTone('warning');
      return;
    }

    setSavingCategory(true);

    const { error: insertError } = await supabase.from('categories').insert([
      {
        description: categoryForm.description.trim() || null,
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
      name: '',
      parent_category_id: '',
    });
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
      is_active: category.is_active,
      name: category.name || '',
      parent_category_id: category.parent_category_id || '',
    });
  }

  function closeEditCategory() {
    setEditingCategory(null);
    setUpdatingCategory(false);
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
    const duplicateCategory = categories.find(
      (category) => category.id !== editingCategory.id && normalizeCategoryName(category.name || '') === normalizedName
    );

    if (duplicateCategory) {
      setMessage('Category name already exists.');
      setMessageTone('warning');
      return;
    }

    setUpdatingCategory(true);
    setMessage('');

    const { error: updateError } = await supabase
      .from('categories')
      .update({
        description: editingCategoryForm.description.trim() || null,
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

      <Panel>
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
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
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
              <Badge style={{ alignSelf: 'flex-end', marginBottom: 2 }} tone="info">
                {loading ? 'Loading categories' : `${filteredCategories.length} shown`}
              </Badge>
              <Button onClick={openAddCategory} type="button">
                Add category
              </Button>
            </div>
          </div>

          {message ? <StatusMessage tone={messageTone}>{message}</StatusMessage> : null}
          {loading ? <StatusMessage tone="info">Loading categories.</StatusMessage> : null}
          {!loading && !filteredCategories.length ? <StatusMessage tone="info">No categories match the current category type filter.</StatusMessage> : null}

          {!loading && filteredCategories.length ? (
            <div
              style={{
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: 12,
                overflow: 'hidden',
                maxHeight: 640,
                overflowX: 'auto',
                overflowY: 'auto',
              }}
            >
              <table style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 980, width: '100%' }}>
                <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                  <tr>
                    <th style={headerCellStyle}>Category</th>
                    <th style={headerCellStyle}>Parent</th>
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
                            <strong
                              style={{
                                color: theme.colors.ink,
                                fontFamily: theme.fonts.display,
                                fontSize: 18,
                                letterSpacing: '-0.04em',
                              }}
                            >
                              {category.name}
                            </strong>
                            <span style={{ color: theme.colors.slate, fontFamily: theme.fonts.mono, fontSize: 12 }}>{category.id}</span>
                          </div>
                        </td>
                        <td style={bodyCellStyle}>
                          <span style={{ color: theme.colors.ink }}>{parentCategory?.name || 'None'}</span>
                        </td>
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

      <Panel>
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="form-grid" style={{ alignItems: 'end', display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr) 220px auto' }}>
            <FormField label="Search items">
              <Input name="item_search" onChange={(event) => setItemSearch(event.target.value)} value={itemSearch} />
            </FormField>

            <FormField label="Status">
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
                {itemStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === 'all' ? 'All statuses' : status}
                  </option>
                ))}
              </select>
            </FormField>

            <Badge style={{ alignSelf: 'center', justifySelf: 'flex-start', marginBottom: 2 }} tone="info">
              {loading ? 'Loading catalog' : `${filteredItems.length} shown`}
            </Badge>
          </div>

          {loading ? <StatusMessage tone="info">Loading item catalog.</StatusMessage> : null}
          {!loading && !filteredItems.length ? <StatusMessage tone="info">No items found for the current search and status filter.</StatusMessage> : null}

          {!loading && filteredItems.length ? (
            <div
              style={{
                border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
                borderRadius: 12,
                overflow: 'hidden',
                overflowX: 'auto',
              }}
            >
              <table style={{ background: alpha(theme.colors.panel, 0.74), borderCollapse: 'separate', borderSpacing: 0, minWidth: 1320, width: '100%' }}>
                <thead style={{ background: alpha(theme.colors.ink, 0.02) }}>
                  <tr>
                    <th style={headerCellStyle}>Item</th>
                    <th style={headerCellStyle}>Owner</th>
                    <th style={headerCellStyle}>Category</th>
                    <th style={headerCellStyle}>Rental</th>
                    <th style={headerCellStyle}>Location</th>
                    <th style={headerCellStyle}>Status</th>
                    <th style={headerCellStyle}>Media</th>
                    <th style={headerCellStyle}>Blocks</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const ownerName = buildOwnerName(item.owner);

                    return (
                      <tr key={item.id}>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <strong
                              style={{
                                color: theme.colors.ink,
                                fontFamily: theme.fonts.display,
                                fontSize: 18,
                                letterSpacing: '-0.04em',
                              }}
                            >
                              {item.title}
                            </strong>
                            <span style={{ color: theme.colors.slate, lineHeight: 1.55 }}>{item.description}</span>
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
                          <span style={{ color: theme.colors.ink, lineHeight: 1.6 }}>{buildItemLocation(item) || 'Not set'}</span>
                        </td>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            <Badge tone={itemStatusTone(item.status)}>{item.status || 'Unknown'}</Badge>
                            <Badge tone={activeTone(item.is_active)}>{item.is_active ? 'Active' : 'Inactive'}</Badge>
                          </div>
                        </td>
                        <td style={bodyCellStyle}>
                          {item.primaryImage?.image_url ? (
                            <Button as="a" href={item.primaryImage.image_url} rel="noreferrer" target="_blank" variant="secondary">
                              View image
                            </Button>
                          ) : (
                            <span style={{ color: theme.colors.slate }}>No image</span>
                          )}
                        </td>
                        <td style={bodyCellStyle}>
                          <div style={{ display: 'grid', gap: 4 }}>
                            <span style={{ color: theme.colors.ink }}>{item.blockCount} blocks</span>
                            <span style={{ color: theme.colors.slate }}>Updated {formatDate(item.updated_at)}</span>
                          </div>
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
      >
        <form id="add-category-form" onSubmit={handleCreateCategory} style={{ display: 'grid', gap: 14 }}>
          <FormField label="Category name">
            <Input name="name" onChange={handleCategoryFormChange} value={categoryForm.name} />
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
            <FormField label="Category name">
              <Input name="name" onChange={handleEditCategoryChange} value={editingCategoryForm.name} />
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
