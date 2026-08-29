function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

export const PURCHASE_COMMISSION_RATE = 0.15;

export function clampPurchaseQuantity(value, maxAvailable = 1) {
  const safeMaximum = Math.max(1, Math.floor(Number(maxAvailable) || 1));
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return 1;
  return Math.min(safeMaximum, Math.max(1, Math.floor(parsed)));
}

export function buildPurchaseAddonState(addons = []) {
  return addons.reduce((state, addon) => {
    state[addon.id] = {
      quantity: 1,
      selected: Boolean(addon.is_required),
    };
    return state;
  }, {});
}

export function selectPurchaseAddons(addons = [], addonSelection = {}) {
  return addons
    .map((addon) => ({
      addon,
      selection: addonSelection[addon.id] || { quantity: 1, selected: false },
    }))
    .filter(({ addon, selection }) => Boolean(addon.is_required || selection.selected))
    .map(({ addon, selection }) => {
      const availableQuantity = Math.max(1, Number(addon.quantity) || 1);
      const quantity = clampPurchaseQuantity(selection.quantity, availableQuantity);
      const unitPrice = roundMoney(addon.price);

      return {
        availableQuantity,
        description: addon.description || '',
        id: addon.id,
        imageUrl: addon.image_url || '',
        isRequired: Boolean(addon.is_required),
        lineTotal: roundMoney(unitPrice * quantity),
        name: addon.addon_name,
        quantity,
        unitPrice,
      };
    });
}

export function calculatePurchaseTotals({ addonRows = [], itemQuantity = 1, salePrice = 0 } = {}) {
  const mainTotal = roundMoney((Number(salePrice) || 0) * (Number(itemQuantity) || 1));
  const addonTotal = roundMoney(addonRows.reduce((sum, addon) => sum + (Number(addon.lineTotal) || 0), 0));
  const subtotalBeforeCommission = roundMoney(mainTotal + addonTotal);
  const commissionFee = roundMoney(subtotalBeforeCommission * PURCHASE_COMMISSION_RATE);

  return {
    addonTotal,
    commissionFee,
    grandTotal: roundMoney(subtotalBeforeCommission + commissionFee),
    mainTotal,
    salePrice: roundMoney(salePrice),
    subtotalBeforeCommission,
  };
}
