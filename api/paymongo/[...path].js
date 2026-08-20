const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fndvviirhvqrocuycpfr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuZHZ2aWlyaHZxcm9jdXljcGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjM2NDksImV4cCI6MjA5MTczOTY0OX0.FnSt0xhlEIiYur5ye4S1xm9SueGQm5lsArsJlHkX08M';

const allowedRequests = [
  { method: 'POST', path: /^v1\/payment_intents$/ },
  { method: 'POST', path: /^v1\/payment_intents\/[^/]+\/attach$/ },
  { method: 'POST', path: /^v1\/payment_methods$/ },
  { method: 'GET', path: /^v1\/merchants\/capabilities\/payment_methods$/ },
  { method: 'POST', path: /^v1\/checkout_sessions$/ },
];

module.exports = async function handler(request, response) {
  const pathParts = Array.isArray(request.query.path) ? request.query.path : [request.query.path].filter(Boolean);
  const path = pathParts.join('/');
  const method = String(request.method || '').toUpperCase();

  if (!allowedRequests.some((entry) => entry.method === method && entry.path.test(path))) {
    return response.status(405).json({ error: 'Unsupported PayMongo request.' });
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
    const paymongoResponse = await fetch(`https://api.paymongo.com/${path}`, {
      body: method === 'GET' ? undefined : JSON.stringify(request.body),
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      method,
    });
    const payload = await paymongoResponse.json().catch(() => null);
    return response.status(paymongoResponse.status).json(payload || { error: 'PayMongo returned an empty response.' });
  } catch (error) {
    return response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to reach PayMongo.' });
  }
};
