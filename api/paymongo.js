const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fndvviirhvqrocuycpfr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuZHZ2aWlyaHZxcm9jdXljcGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjM2NDksImV4cCI6MjA5MTczOTY0OX0.FnSt0xhlEIiYur5ye4S1xm9SueGQm5lsArsJlHkX08M';

const allowedRequests = [
  { method: 'POST', path: /^\/payment_intents$/ },
  { method: 'POST', path: /^\/payment_intents\/[^/]+\/attach$/ },
  { method: 'POST', path: /^\/payment_methods$/ },
  { method: 'GET', path: /^\/merchants\/capabilities\/payment_methods$/ },
  { method: 'POST', path: /^\/checkout_sessions$/ },
];

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });

  const upstreamMethod = String(request.body?.method || 'POST').toUpperCase();
  const upstreamPath = String(request.body?.path || '');
  if (!allowedRequests.some((entry) => entry.method === upstreamMethod && entry.path.test(upstreamPath))) {
    return response.status(400).json({ error: 'Unsupported PayMongo request.' });
  }

  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return response.status(401).json({ error: 'Authentication required.' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return response.status(401).json({ error: 'Authentication required.' });

  const secretKey = String(process.env.PAYMONGO_SECRET_KEY || process.env.PAYMONGO_TEST_SECRET_KEY || '').trim();
  if (!secretKey) return response.status(503).json({ error: 'PayMongo is not configured on Vercel.' });

  try {
    const paymongoResponse = await fetch(`https://api.paymongo.com/v1${upstreamPath}`, {
      body: upstreamMethod === 'GET' ? undefined : JSON.stringify(request.body?.body),
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      method: upstreamMethod,
    });
    const payload = await paymongoResponse.json().catch(() => null);
    return response.status(paymongoResponse.status).json(payload || { error: 'PayMongo returned an empty response.' });
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to reach PayMongo.' });
  }
};
