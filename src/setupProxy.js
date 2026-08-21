const { createProxyMiddleware } = require('http-proxy-middleware');
const crypto = require('crypto');
const express = require('express');

const diditSessionOwners = new Map();

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getDiditVerificationAssets(decision) {
  const idVerification = decision?.id_verifications?.[0] || decision?.id_verification || {};
  const liveness = decision?.liveness_checks?.[0] || decision?.liveness || {};

  return {
    back: idVerification.full_back_image || idVerification.back_document_image || idVerification.back_image || '',
    front: idVerification.full_front_image || idVerification.front_document_image || idVerification.front_image || '',
    idVerification,
    selfie: liveness.reference_image || idVerification.portrait_image || '',
  };
}

function maskDocumentNumber(value) {
  const normalized = String(value || '').trim();
  return normalized ? `****${normalized.slice(-4)}` : null;
}

async function importDiditAsset(supabase, userId, sessionId, label, url) {
  if (!url) return null;

  const assetResponse = await fetch(url);
  if (!assetResponse.ok) {
    throw new Error(`Unable to download the Didit ${label} document (${assetResponse.status}).`);
  }

  const contentType = assetResponse.headers.get('content-type') || 'image/jpeg';
  const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `public/${userId}/didit_${sessionId}_${label}.${extension}`;
  const { error } = await supabase.storage
    .from('id-verifications')
    .upload(storagePath, await assetResponse.arrayBuffer(), { contentType, upsert: true });

  if (error) throw new Error(error.message);
  return supabase.storage.from('id-verifications').getPublicUrl(storagePath).data.publicUrl;
}

async function persistDiditDocuments(supabase, userId, sessionId, decision) {
  const { back, front, idVerification, selfie } = getDiditVerificationAssets(decision);
  if (!front) return { error: 'Didit returned no front document image.', verification: null };

  try {
    const [idFrontUrl, idBackUrl, selfieUrl] = await Promise.all([
      importDiditAsset(supabase, userId, sessionId, 'front', front),
      importDiditAsset(supabase, userId, sessionId, 'back', back),
      importDiditAsset(supabase, userId, sessionId, 'selfie', selfie),
    ]);
    const { data: existingVerification } = await supabase
      .from('identity_verifications')
      .select('*')
      .eq('user_id', userId)
      .eq('id_front_url', idFrontUrl)
      .limit(1)
      .maybeSingle();

    if (existingVerification) return { error: '', verification: existingVerification };

    const { data: verification, error } = await supabase
      .from('identity_verifications')
      .insert([{
        id_back_url: idBackUrl,
        id_front_url: idFrontUrl,
        id_number_masked: maskDocumentNumber(idVerification.document_number),
        id_type: idVerification.document_type || 'Didit ID document',
        selfie_url: selfieUrl,
        status: 'verified',
        user_id: userId,
      }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    return { error: '', verification };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to save Didit documents.', verification: null };
  }
}

const PAYMONGO_TEST_SECRET_KEY_ENV_KEYS = Object.freeze([
  'PAYMONGO_SECRET_KEY',
  'PAYMONGO_TEST_SECRET_KEY',
  'REACT_APP_PAYMONGO_TEST_SECRET_KEY',
  'REACT_APP_PAYMONGO_SECRET_KEY',
]);

function readPayMongoTestSecretKey() {
  const secretKey = PAYMONGO_TEST_SECRET_KEY_ENV_KEYS.map((envKey) => process.env[envKey]).find(
    (value) => typeof value === 'string' && value.trim()
  );

  if (!secretKey) {
    return '';
  }

  const trimmedKey = secretKey.trim();
  return trimmedKey.startsWith('sk_test_') ? trimmedKey : '';
}

module.exports = function setupPayMongoProxy(app) {
  app.use('/api/didit', express.json({ limit: '10mb' }));

  app.post('/api/didit', async (request, response) => {
    const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) {
      response.status(401).json({ error: 'Authentication required.' });
      return;
    }

    const supabaseUrl = 'https://fndvviirhvqrocuycpfr.supabase.co';
    const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuZHZ2aWlyaHZxcm9jdXljcGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjM2NDksImV4cCI6MjA5MTczOTY0OX0.FnSt0xhlEIiYur5ye4S1xm9SueGQm5lsArsJlHkX08M';
    const diditApiKey = String(process.env.DIDIT_API_KEY || process.env.REACT_APP_DIDIT_API_KEY || '').trim();

    if (!diditApiKey) {
      response.status(503).json({ error: 'Didit is not configured locally. Add DIDIT_API_KEY to .env.local, then restart the development server.' });
      return;
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    try {
      const body = request.body || {};
      let user = null;

      if (body.action === 'session-decision') {
        const sessionId = String(body.session_id || '').trim();
        const owner = diditSessionOwners.get(sessionId);

        if (owner?.tokenFingerprint === tokenFingerprint(token)) {
          user = { id: owner.userId };
        }
      }

      if (!user) {
        const { data, error: userError } = await supabase.auth.getUser(token);
        user = data?.user || null;

        if (userError || !user) {
          response.status(401).json({ error: 'Your login session could not be validated. Please sign in again.' });
          return;
        }
      }

      if (body.action === 'create-session') {
        const workflowId = String(body.workflow_id || '').trim();
        if (!workflowId) {
          response.status(400).json({ error: 'Workflow ID is required.' });
          return;
        }

        const sessionResponse = await fetch('https://verification.didit.me/v3/session/', {
          body: JSON.stringify({
            workflow_id: workflowId,
            vendor_data: user.id,
          }),
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': diditApiKey,
          },
          method: 'POST',
        });

        const sessionPayload = await sessionResponse.json().catch(() => null);
        const sessionId = sessionPayload?.session_id || null;
        if (sessionResponse.ok && sessionId) {
          diditSessionOwners.set(sessionId, {
            tokenFingerprint: tokenFingerprint(token),
            userId: user.id,
          });
        }

        response.status(sessionResponse.status).json(sessionResponse.ok ? {
          session_id: sessionId,
          url: sessionPayload?.url || sessionPayload?.verification_url || sessionPayload?.link || null,
          verification_session: sessionPayload,
        } : {
          error: sessionPayload?.message || sessionPayload?.detail || 'Unable to create Didit session.',
        });
        return;
      }

      if (body.action === 'session-decision') {
        const sessionId = String(body.session_id || '').trim();
        if (!sessionId) {
          response.status(400).json({ error: 'Session ID is required.' });
          return;
        }

        const decisionResponse = await fetch(`https://verification.didit.me/v3/session/${sessionId}/decision/`, {
          headers: {
            'x-api-key': diditApiKey,
          },
          method: 'GET',
        });

        const decisionPayload = await decisionResponse.json().catch(() => null);
        const decision = decisionPayload?.data || decisionPayload || {};
        const verified = ['approved', 'verified', 'success', 'completed'].includes(
          String(decision?.status || '').toLowerCase()
        );
        const documents = verified
          ? await persistDiditDocuments(supabase, user.id, sessionId, decision)
          : { error: '', verification: null };

        if (verified) {
          const { error: profileVerificationError } = await supabase
            .from('profiles')
            .update({ is_verified: true, verification_status: 'verified' })
            .eq('id', user.id);

          if (profileVerificationError) {
            documents.error = [documents.error, profileVerificationError.message].filter(Boolean).join(' ');
          }
        }

        response.status(decisionResponse.status).json(decisionResponse.ok ? {
          decision,
          document_import_error: documents.error,
          verification: documents.verification,
          verified,
        } : {
          error: decisionResponse.status === 403
            ? 'Didit denied access to this verification result. The API key must belong to the same Didit application as the workflow and include permission to retrieve session decisions.'
            : decisionPayload?.message || decisionPayload?.detail || 'Unable to fetch Didit decision.',
          didit_status: decisionResponse.status,
        });
        return;
      }

      const diditResponse = await fetch('https://verification.didit.me/v3/id-verification/', {
        body: (() => {
          const formData = new FormData();
          if (body.id_front_url) formData.append('front_image', body.id_front_url);
          if (body.id_back_url) formData.append('back_image', body.id_back_url);
          return formData;
        })(),
        headers: { 'x-api-key': diditApiKey },
        method: 'POST',
      });

      const payload = await diditResponse.json().catch(() => null);
      response.status(diditResponse.status).json(payload || { error: 'Didit returned an empty response.' });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected Didit error.' });
    }
  });

  app.use('/api/paymongo', (request, response, next) => {
    if (!readPayMongoTestSecretKey()) {
      response.status(503).json({
        error: 'PayMongo is not configured locally. Add PAYMONGO_SECRET_KEY=sk_test_... to .env.local, then restart the development server.',
      });
      return;
    }

    next();
  });

  app.use(
    '/api/paymongo',
    createProxyMiddleware({
      changeOrigin: true,
      on: {
        proxyReq: (proxyReq) => {
          const secretKey = readPayMongoTestSecretKey();

          // PayMongo server-to-server endpoints can reject browser-originated headers.
          proxyReq.removeHeader('origin');
          proxyReq.removeHeader('referer');

          if (secretKey) {
            proxyReq.setHeader('Authorization', `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`);
          }
        },
      },
      pathRewrite: {
        '^/api/paymongo': '',
      },
      target: 'https://api.paymongo.com',
    })
  );
};
