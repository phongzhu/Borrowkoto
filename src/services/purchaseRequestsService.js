import { supabase } from '../api/supabaseClient';

export async function approveItemPurchaseRequest({
  requestId,
  approvedQuantity,
  agreedPickupAt = null,
  pickupLocationText = null,
  sellerNotes = null,
}) {
  const normalizedQuantity = Number(approvedQuantity);

  if (!requestId) {
    throw new Error('Purchase request ID is required.');
  }

  if (!Number.isInteger(normalizedQuantity) || normalizedQuantity < 1) {
    throw new Error('Approved quantity must be at least 1.');
  }

  const { error } = await supabase.rpc('approve_item_purchase_request', {
    p_request_id: requestId,
    p_approved_quantity: normalizedQuantity,
    p_agreed_pickup_at: agreedPickupAt,
    p_pickup_location_text: pickupLocationText,
    p_seller_notes: sellerNotes,
  });

  if (error) {
    throw new Error(error.message || 'Unable to approve purchase request.');
  }
}
