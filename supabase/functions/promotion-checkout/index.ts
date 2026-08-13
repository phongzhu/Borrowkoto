import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });
}

async function paymongo(path: string, secret: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.paymongo.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Basic ${btoa(`${secret}:`)}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.errors?.[0]?.detail || `PayMongo request failed (${response.status}).`);
  return payload?.data;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const paymongoSecret = Deno.env.get('PAYMONGO_SECRET_KEY') || '';
    if (!paymongoSecret) throw new Error('PayMongo is not configured.');

    const authorization = request.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json({ error: 'Authentication required.' }, 401);
    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await request.json();

    if (body.action === 'create') {
      const { data: item } = await admin.from('items').select('id,title,owner_id,is_active').eq('id', body.item_id).eq('owner_id', user.id).eq('is_active', true).maybeSingle();
      const { data: plan } = await admin.from('promotion_plans').select('*').eq('id', body.plan_id).eq('is_active', true).maybeSingle();
      if (!item || !plan) return json({ error: 'Choose a valid listing and promotion plan.' }, 400);

      const now = new Date();
      const { data: openPromotions, error: openPromotionError } = await admin.from('item_promotions')
        .select('id,status,ends_at')
        .eq('item_id', item.id)
        .in('status', ['pending_payment', 'payment_review', 'active']);
      if (openPromotionError) throw openPromotionError;

      const staleActiveIds = (openPromotions || [])
        .filter((entry) => entry.status === 'active' && entry.ends_at && new Date(entry.ends_at) <= now)
        .map((entry) => entry.id);
      if (staleActiveIds.length) {
        const { error: expireError } = await admin.from('item_promotions')
          .update({ status: 'expired', updated_at: now.toISOString() })
          .in('id', staleActiveIds);
        if (expireError) throw expireError;
      }

      const hasOpenPromotion = (openPromotions || []).some((entry) =>
        !staleActiveIds.includes(entry.id) && (
          ['pending_payment', 'payment_review'].includes(entry.status) ||
          (entry.status === 'active' && (!entry.ends_at || new Date(entry.ends_at) > now))
        )
      );
      if (hasOpenPromotion) return json({ error: 'This item already has an active or pending promotion.' }, 409);

      const [{ data: settings }, { count: activeCount }] = await Promise.all([
        admin.from('promotion_settings').select('banner_slot_limit').eq('id', true).single(),
        admin.from('item_promotions').select('id', { count: 'exact', head: true }).eq('status', 'active').gt('ends_at', new Date().toISOString()),
      ]);
      if ((activeCount || 0) >= Number(settings?.banner_slot_limit || 1)) return json({ error: 'All promotion banner slots are currently occupied. Please try again later.' }, 409);

      const { data: promotion, error: insertError } = await admin.from('item_promotions').insert({
        duration_days_snapshot: plan.duration_days,
        fee_snapshot: plan.fee,
        item_id: item.id,
        lender_id: user.id,
        plan_id: plan.id,
        status: 'pending_payment',
      }).select('id').single();
      if (insertError?.code === '23505') return json({ error: 'This item already has an active or pending promotion.' }, 409);
      if (insertError) throw insertError;

      const returnUrl = String(body.return_url || '').replace(/\/$/, '');
      if (!/^https?:\/\//i.test(returnUrl)) throw new Error('A valid return URL is required.');
      const separator = returnUrl.includes('?') ? '&' : '?';
      try {
        const session = await paymongo('/checkout_sessions', paymongoSecret, {
          method: 'POST',
          body: JSON.stringify({ data: { attributes: {
            cancel_url: `${returnUrl}${separator}promotion_payment=cancelled`,
            description: `Borrow Ko 'To banner promotion for ${item.title}`,
            line_items: [{ amount: Math.round(Number(plan.fee) * 100), currency: 'PHP', description: `${plan.duration_days}-day promoted listing`, name: plan.name, quantity: 1 }],
            metadata: { item_id: item.id, lender_id: user.id, promotion_id: promotion.id },
            payment_method_types: ['card', 'qrph'],
            reference_number: promotion.id,
            send_email_receipt: true,
            show_description: true,
            show_line_items: true,
            success_url: `${returnUrl}${separator}promotion_payment=success&promotion_id=${promotion.id}`,
          } } }),
        });
        await admin.from('item_promotions').update({ paymongo_checkout_session_id: session.id, payment_reference: session.id, updated_at: new Date().toISOString() }).eq('id', promotion.id);
        return json({ checkout_url: session.attributes?.checkout_url, promotion_id: promotion.id });
      } catch (error) {
        await admin.from('item_promotions').delete().eq('id', promotion.id);
        throw error;
      }
    }

    if (body.action === 'verify') {
      const { data: promotion } = await admin.from('item_promotions').select('*').eq('id', body.promotion_id).eq('lender_id', user.id).maybeSingle();
      if (!promotion?.paymongo_checkout_session_id) return json({ error: 'Promotion payment was not found.' }, 404);
      if (promotion.status === 'active') return json({ active: true, promotion_id: promotion.id });

      const session = await paymongo(`/checkout_sessions/${promotion.paymongo_checkout_session_id}`, paymongoSecret, { method: 'GET' });
      const attributes = session.attributes || {};
      const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
      const payment = payments.find((entry: any) => entry?.attributes?.status === 'paid') || payments[0];
      const paymentStatus = payment?.attributes?.status || attributes.payment_intent?.attributes?.status || attributes.status;
      if (!['paid', 'succeeded', 'completed'].includes(String(paymentStatus || '').toLowerCase())) return json({ error: 'PayMongo has not confirmed this payment yet.' }, 409);
      if (attributes.metadata?.promotion_id && attributes.metadata.promotion_id !== promotion.id) return json({ error: 'Payment reference mismatch.' }, 400);

      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + Number(promotion.duration_days_snapshot) * 86400000);
      const paidAt = payment?.attributes?.paid_at ? new Date(Number(payment.attributes.paid_at) * 1000) : startsAt;
      const { error: updateError } = await admin.from('item_promotions').update({
        ends_at: endsAt.toISOString(), paid_at: paidAt.toISOString(), starts_at: startsAt.toISOString(), status: 'active', updated_at: startsAt.toISOString(),
      }).eq('id', promotion.id).eq('status', 'pending_payment');
      if (updateError) throw updateError;

      const { error: paymentError } = await admin.from('promotion_payments').upsert({
        amount: promotion.fee_snapshot, currency: 'PHP', item_id: promotion.item_id, lender_id: user.id,
        paid_at: paidAt.toISOString(), paymongo_checkout_session_id: promotion.paymongo_checkout_session_id,
        paymongo_payment_id: payment?.id || null, promotion_id: promotion.id, status: 'paid',
      }, { onConflict: 'promotion_id' });
      if (paymentError) throw paymentError;
      return json({ active: true, promotion_id: promotion.id });
    }

    if (body.action === 'cancel') {
      const { data: promotion } = await admin.from('item_promotions').select('id,status,paid_at').eq('id', body.promotion_id).eq('lender_id', user.id).maybeSingle();
      if (!promotion) return json({ error: 'Promotion was not found.' }, 404);
      if (!['pending_payment', 'active'].includes(promotion.status)) return json({ error: 'This promotion can no longer be cancelled.' }, 409);
      const { error: cancelError } = await admin.from('item_promotions').update({
        ends_at: promotion.status === 'active' ? new Date().toISOString() : undefined,
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      }).eq('id', promotion.id).eq('lender_id', user.id);
      if (cancelError) throw cancelError;
      return json({ cancelled: true, paid: Boolean(promotion.paid_at) });
    }

    return json({ error: 'Unsupported action.' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected payment error.' }, 400);
  }
});
