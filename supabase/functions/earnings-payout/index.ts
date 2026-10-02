import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Origin': '*',
};

class PayMongoRequestError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status });
}

async function paymongoRequest(path: string, secret: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.paymongo.com${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`${secret}:`)}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PayMongoRequestError(payload?.errors?.[0]?.detail || payload?.errors?.[0]?.code || `PayMongo request failed (${response.status}).`, response.status);
  }
  return payload?.data;
}

function internalStatus(providerStatus: string) {
  const status = String(providerStatus || '').toLowerCase();
  if (status === 'succeeded') return 'paid';
  if (status === 'failed') return 'failed';
  return 'processing';
}

function normalizePhilippineMobile(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('63')) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('9')) return `0${digits}`;
  return digits;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const authorization = request.headers.get('Authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json({ error: 'Authentication required.' }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile, error: profileError } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (profileError) throw profileError;
    const isAdmin = String(profile?.role || '').toLowerCase() === 'admin';

    const body = await request.json();
    const withdrawalId = String(body.withdrawal_id || '').trim();
    if (!withdrawalId) return json({ error: 'Withdrawal request is required.' }, 400);

    const { data: withdrawal, error: withdrawalError } = await admin
      .from('earnings_withdrawals')
      .select('*')
      .eq('id', withdrawalId)
      .maybeSingle();
    if (withdrawalError) throw withdrawalError;
    if (!withdrawal) return json({ error: 'Withdrawal request was not found.' }, 404);

    if (['process', 'refresh'].includes(body.action) && !isAdmin && withdrawal.owner_id !== user.id) {
      return json({ error: 'You can only process your own withdrawal request.' }, 403);
    }
    if (!['process', 'refresh'].includes(body.action) && !isAdmin) {
      return json({ error: 'Only admins can manage withdrawal requests.' }, 403);
    }

    if (body.action === 'reject') {
      if (!['requested', 'failed'].includes(withdrawal.status)) return json({ error: 'Only new or failed requests can be rejected.' }, 409);
      const { data, error } = await admin.from('earnings_withdrawals').update({
        admin_note: String(body.note || '').trim() || null,
        processed_at: new Date().toISOString(),
        processed_by: user.id,
        status: 'rejected',
        updated_at: new Date().toISOString(),
      }).eq('id', withdrawalId).in('status', ['requested', 'failed']).select('id,status').maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'This request changed before it could be rejected.' }, 409);
      return json({ withdrawal: data });
    }

    if (body.action === 'process') {
      const canResumeUncertainTransfer = withdrawal.status === 'processing' && !withdrawal.paymongo_transfer_id;
      if (!['requested', 'failed'].includes(withdrawal.status) && !canResumeUncertainTransfer) return json({ error: 'This request is already being processed or has been completed.' }, 409);
      const secret = Deno.env.get('PAYMONGO_SECRET_KEY') || '';
      if (!secret.startsWith('sk_live_')) {
        return json({ error: 'Live payouts are not configured. Set PAYMONGO_SECRET_KEY to the PayMongo live secret in Supabase Edge Function secrets.' }, 503);
      }
      const sourceNumber = Deno.env.get('PAYMONGO_SOURCE_ACCOUNT_NUMBER') || '';
      const sourceName = Deno.env.get('PAYMONGO_SOURCE_ACCOUNT_NAME') || '';
      if (!sourceNumber || !sourceName) {
        const message = 'PayMongo live wallet source details are missing. Configure PAYMONGO_SOURCE_ACCOUNT_NUMBER and PAYMONGO_SOURCE_ACCOUNT_NAME in Supabase Edge Function secrets.';
        return json({ error: message, status: 'not_configured' }, 503);
      }

      let lockedWithdrawal = withdrawal;
      let idempotencyKey = withdrawal.paymongo_idempotency_key || '';
      if (!canResumeUncertainTransfer) {
        idempotencyKey = crypto.randomUUID();
        const { data, error: lockError } = await admin.from('earnings_withdrawals').update({
          admin_note: null,
          paymongo_batch_transfer_id: null,
          paymongo_idempotency_key: idempotencyKey,
          paymongo_status: null,
          paymongo_transfer_id: null,
          processed_by: user.id,
          processed_at: null,
          status: 'processing',
          updated_at: new Date().toISOString(),
        }).eq('id', withdrawalId).in('status', ['requested', 'failed']).select('*').maybeSingle();
        if (lockError) throw lockError;
        if (!data) return json({ error: 'This withdrawal has already been picked up for processing.' }, 409);
        lockedWithdrawal = data;
      } else if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        const { data, error: lockError } = await admin.from('earnings_withdrawals').update({
          paymongo_idempotency_key: idempotencyKey,
          updated_at: new Date().toISOString(),
        }).eq('id', withdrawalId).eq('status', 'processing').is('paymongo_transfer_id', null).is('paymongo_idempotency_key', null).select('*').maybeSingle();
        if (lockError) throw lockError;
        if (!data) return json({ error: 'This withdrawal is already being submitted. Refresh its status before retrying.' }, 409);
        lockedWithdrawal = data;
      }

      let createdTransferId = '';
      try {
        const batch = await paymongoRequest('/v2/batch_transfers', secret, {
          method: 'POST',
          headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({
            transfers: [{
              amount: Math.round(Number(lockedWithdrawal.amount) * 100),
              currency: 'PHP',
              description: `Borrow Ko 'To owner earnings withdrawal ${withdrawalId}`,
              destination_account: {
                bic: lockedWithdrawal.destination_bic,
                name: lockedWithdrawal.destination_account_name,
                number: normalizePhilippineMobile(lockedWithdrawal.destination_account_number),
              },
              metadata: { owner_id: lockedWithdrawal.owner_id, withdrawal_id: withdrawalId },
              provider: 'instapay',
              purpose: 'Earnings withdrawal',
              reference_number: `bkto-${withdrawalId}-${idempotencyKey.slice(0, 8)}`,
              source_account: {
                bic: 'PAEYPHM2XXX',
                name: sourceName,
                number: sourceNumber,
              },
            }],
          }),
        });
        const transfer = Array.isArray(batch?.transfers) ? batch.transfers[0] : null;
        if (!transfer?.id) throw new Error('PayMongo did not return a transfer reference.');
        createdTransferId = transfer.id;
        const status = internalStatus(transfer.status);
        const { error: updateError } = await admin.from('earnings_withdrawals').update({
          paymongo_batch_transfer_id: batch.id || null,
          paymongo_status: transfer.status || 'pending',
          paymongo_transfer_id: transfer.id,
          processed_at: status === 'paid' || status === 'failed' ? new Date().toISOString() : null,
          status,
          updated_at: new Date().toISOString(),
        }).eq('id', withdrawalId);
        if (updateError) throw updateError;
        return json({ status, transfer_id: transfer.id, provider_reference_number: transfer.provider_reference_number || null, reference_number: transfer.reference_number || null });
      } catch (error) {
        const isDefinitiveFailure = error instanceof PayMongoRequestError
          && error.statusCode >= 400
          && error.statusCode < 500
          && error.statusCode !== 409;
        await admin.from('earnings_withdrawals').update(createdTransferId || !isDefinitiveFailure ? {
          admin_note: error instanceof Error ? error.message : 'Transfer status is being confirmed. Retry safely with the same transfer key.',
          ...(createdTransferId ? { paymongo_transfer_id: createdTransferId } : {}),
          status: 'processing',
          updated_at: new Date().toISOString(),
        } : {
          admin_note: error instanceof Error ? error.message : 'PayMongo transfer failed.',
          paymongo_status: 'failed',
          processed_at: new Date().toISOString(),
          status: 'failed',
          updated_at: new Date().toISOString(),
        }).eq('id', withdrawalId);
        throw error;
      }
    }

    if (body.action === 'refresh') {
      if (withdrawal.status !== 'processing' || !withdrawal.paymongo_transfer_id) {
        return json({ error: 'This withdrawal has no pending PayMongo transfer to refresh.' }, 409);
      }
      const secret = Deno.env.get('PAYMONGO_SECRET_KEY') || '';
      if (!secret.startsWith('sk_live_')) {
        return json({ error: 'Live payouts are not configured. Set PAYMONGO_SECRET_KEY to the PayMongo live secret in Supabase Edge Function secrets.' }, 503);
      }
      const transfer = await paymongoRequest(`/v2/transfers/${encodeURIComponent(withdrawal.paymongo_transfer_id)}`, secret, { method: 'GET' });
      const providerStatus = String(transfer?.status || 'pending').toLowerCase();
      const status = internalStatus(providerStatus);
      const { error: updateError } = await admin.from('earnings_withdrawals').update({
        paymongo_status: providerStatus,
        processed_at: status === 'paid' || status === 'failed' ? new Date().toISOString() : withdrawal.processed_at,
        status,
        updated_at: new Date().toISOString(),
      }).eq('id', withdrawalId).eq('status', 'processing');
      if (updateError) throw updateError;
      return json({ status, transfer_id: withdrawal.paymongo_transfer_id });
    }

    return json({ error: 'Unsupported withdrawal action.' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unable to process this withdrawal.' }, 400);
  }
});
