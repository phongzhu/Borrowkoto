import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

async function getCheckoutSession(sessionId: string, secret: string) {
  const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(sessionId)}`, {
    headers: {
      Authorization: `Basic ${btoa(`${secret}:`)}`,
      'Content-Type': 'application/json',
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.errors?.[0]?.detail || `Unable to verify the PayMongo checkout (${response.status}).`);
  }
  return payload?.data;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const paymongoSecret = Deno.env.get('PAYMONGO_SECRET_KEY') || Deno.env.get('PAYMONGO_TEST_SECRET_KEY') || '';
    if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Payment verification is not configured.');
    if (!paymongoSecret) throw new Error('PayMongo verification is not configured.');

    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Authentication required.' }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) return json({ error: 'Authentication required.' }, 401);

    const { purchase_request_id: purchaseRequestId } = await request.json();
    if (typeof purchaseRequestId !== 'string' || !purchaseRequestId.trim()) {
      return json({ error: 'A purchase request is required.' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: purchase, error: purchaseError } = await admin
      .from('item_purchase_requests')
      .select('id,buyer_id,seller_id,buyer_requested_quantity,seller_approved_quantity,sale_price_snapshot,sale_total_amount_snapshot,commission_fee_snapshot,status,payment_transaction_id,paymongo_checkout_session_id,paid_at')
      .eq('id', purchaseRequestId)
      .eq('buyer_id', user.id)
      .maybeSingle();
    if (purchaseError) throw purchaseError;
    if (!purchase) return json({ error: 'Purchase request was not found for this account.' }, 404);
    if (!['pending', 'approved', 'awaiting_payment', 'paid'].includes(String(purchase.status).toLowerCase())) {
      return json({ error: 'This purchase request is no longer payable.' }, 409);
    }

    const sessionId = String(purchase.paymongo_checkout_session_id || '');
    if (!sessionId) return json({ error: 'No PayMongo checkout is linked to this purchase. Reopen checkout to continue.' }, 409);

    const session = await getCheckoutSession(sessionId, paymongoSecret);
    const attributes = session?.attributes || {};
    if (session?.id !== sessionId) return json({ error: 'PayMongo checkout reference mismatch.' }, 409);
    if (attributes.reference_number && attributes.reference_number !== purchase.id) {
      return json({ error: 'This PayMongo checkout belongs to a different purchase.' }, 409);
    }
    if (attributes.metadata?.purchase_request_id && attributes.metadata.purchase_request_id !== purchase.id) {
      return json({ error: 'This PayMongo checkout belongs to a different purchase.' }, 409);
    }

    const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
    const paidPayment = payments.find((payment: any) => String(payment?.attributes?.status || '').toLowerCase() === 'paid');
    const paymentStatus = String(
      paidPayment?.attributes?.status || attributes.payment_intent?.attributes?.status || attributes.status || '',
    ).toLowerCase();
    if (!['paid', 'succeeded', 'completed'].includes(paymentStatus)) {
      return json({ error: 'PayMongo has not confirmed this payment yet.' }, 409);
    }

    const expectedTotal = Number(purchase.sale_total_amount_snapshot || purchase.sale_price_snapshot || 0);
    const lineItems = Array.isArray(attributes.line_items) ? attributes.line_items : [];
    if (lineItems.length) {
      const sessionTotal = lineItems.reduce((total: number, item: any) => {
        return total + Number(item?.amount || 0) * Number(item?.quantity || 1);
      }, 0) / 100;
      if (!Number.isFinite(expectedTotal) || Math.abs(sessionTotal - expectedTotal) > 0.01) {
        return json({ error: 'The PayMongo checkout amount does not match this purchase.' }, 409);
      }
    }

    const quantity = Number(purchase.seller_approved_quantity || purchase.buyer_requested_quantity || 1);
    const purchaseTotal = Number((Number(purchase.sale_total_amount_snapshot || (Number(purchase.sale_price_snapshot) || 0) * quantity)).toFixed(2));
    const commission = Number((Number(purchase.commission_fee_snapshot || 0)).toFixed(2));
    const sellerAmount = Number(Math.max(0, purchaseTotal - commission).toFixed(2));
    const paidAt = paidPayment?.attributes?.paid_at
      ? new Date(Number(paidPayment.attributes.paid_at) * 1000).toISOString()
      : new Date().toISOString();
    const { data: adminProfile, error: adminProfileError } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'admin')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (adminProfileError) throw adminProfileError;

    const baseTransaction = {
      booking_id: null,
      payer_id: purchase.buyer_id,
      payment_method: 'paymongo',
      purchase_request_id: purchase.id,
      status: 'recorded',
      transaction_at: paidAt,
    };
    const transactions = [
      {
        ...baseTransaction,
        amount: sellerAmount,
        notes: `Purchase payment for item request ${purchase.id}.`,
        payee_id: purchase.seller_id,
        reference_number: `paymongo:purchase:${purchase.id}`,
        transaction_type: 'purchase_payment',
      },
      ...(commission > 0 ? [{
        ...baseTransaction,
        amount: commission,
        notes: `Platform commission fee for item purchase request ${purchase.id}.`,
        payee_id: adminProfile?.id || null,
        reference_number: `paymongo:purchase:platform_fee:${purchase.id}`,
        transaction_type: 'platform_fee',
      }] : []),
    ];

    const transactionIds: Record<string, string> = {};
    for (const transaction of transactions) {
      const { error: transactionError } = await admin
        .from('payment_transactions')
        .upsert(transaction, { onConflict: 'purchase_request_id,transaction_type', ignoreDuplicates: true });
      if (transactionError) throw transactionError;

      const { data: savedTransaction, error: savedTransactionError } = await admin
        .from('payment_transactions')
        .select('id')
        .eq('purchase_request_id', purchase.id)
        .eq('transaction_type', transaction.transaction_type)
        .single();
      if (savedTransactionError) throw savedTransactionError;
      transactionIds[transaction.transaction_type] = savedTransaction.id;
    }

    const { error: updateError } = await admin
      .from('item_purchase_requests')
      .update({
        paid_at: purchase.paid_at || paidAt,
        payment_transaction_id: transactionIds.purchase_payment,
        status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', purchase.id)
      .eq('buyer_id', user.id);
    if (updateError) throw updateError;

    return json({ paid: true, purchase_request_id: purchase.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to verify purchase payment.';
    return json({ error: message }, 400);
  }
});
