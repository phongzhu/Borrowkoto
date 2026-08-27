import { itemMatchesAcademicFilters } from '../data/nubAcademicData';

export function isMarketplaceOwnerActive(profile) {
  return String(profile?.account_status || '').trim().toLowerCase() === 'active';
}

export function filterListingsByActiveOwners(items, ownerProfiles) {
  const activeOwnerIds = new Set(
    (ownerProfiles || [])
      .filter(isMarketplaceOwnerActive)
      .map((profile) => profile?.id)
      .filter(Boolean)
  );

  return (items || []).filter((item) => activeOwnerIds.has(item?.owner_id));
}

export function selectPromotedMarketplaceItems(
  promotedItemIds,
  items,
  { limit = 8, programCodes = [], schoolCodes = [] } = {}
) {
  const itemsById = new Map((items || []).map((item) => [item?.id, item]));

  return [...new Set(promotedItemIds || [])]
    .map((itemId) => itemsById.get(itemId))
    .filter((item) => item && itemMatchesAcademicFilters(item, schoolCodes, programCodes))
    .slice(0, limit);
}
