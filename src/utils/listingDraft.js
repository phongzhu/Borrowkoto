const LISTING_DRAFT_STORAGE_PREFIX = 'borrowkoto:listing-draft:v2';
const LEGACY_LISTING_DRAFT_STORAGE_KEY = 'borrowkoto:listing-draft:v1';

function getStorageKey(userId) {
  return `${LISTING_DRAFT_STORAGE_PREFIX}:${String(userId || 'anonymous')}`;
}

function serializeAddons(addons) {
  return (addons || []).map(({ imageFile, imagePreview, ...addon }) => ({
    ...addon,
    imageFile: null,
    imagePreview: '',
  }));
}

function parseDraft(raw, defaultForm) {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.form || typeof parsed.form !== 'object') return null;

  return {
    addons: Array.isArray(parsed.addons) ? serializeAddons(parsed.addons) : [],
    form: { ...defaultForm, ...parsed.form },
    savedAt: parsed.savedAt || '',
  };
}

export function readListingDraft(userId, defaultForm) {
  try {
    const currentDraft = parseDraft(window.localStorage.getItem(getStorageKey(userId)), defaultForm);
    if (currentDraft) return currentDraft;

    const legacyDraft = parseDraft(window.sessionStorage.getItem(LEGACY_LISTING_DRAFT_STORAGE_KEY), defaultForm);
    if (!legacyDraft) return null;

    window.localStorage.setItem(getStorageKey(userId), JSON.stringify({
      addons: legacyDraft.addons,
      form: legacyDraft.form,
      savedAt: legacyDraft.savedAt || new Date().toISOString(),
      version: 2,
    }));
    window.sessionStorage.removeItem(LEGACY_LISTING_DRAFT_STORAGE_KEY);
    return legacyDraft;
  } catch {
    return null;
  }
}

export function saveListingDraft(userId, form, addons = []) {
  try {
    const savedAt = new Date().toISOString();
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify({
      addons: serializeAddons(addons),
      form,
      savedAt,
      version: 2,
    }));
    return savedAt;
  } catch {
    return '';
  }
}

export function clearListingDraft(userId) {
  try {
    window.localStorage.removeItem(getStorageKey(userId));
    window.sessionStorage.removeItem(LEGACY_LISTING_DRAFT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function updateListingMainCategory(form, categoryId) {
  return {
    ...form,
    category_id: categoryId,
    subcategory_id: '',
  };
}

export function updateListingSubcategory(form, subcategoryId) {
  return {
    ...form,
    subcategory_id: subcategoryId,
  };
}
