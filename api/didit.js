const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://fndvviirhvqrocuycpfr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZuZHZ2aWlyaHZxcm9jdXljcGZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNjM2NDksImV4cCI6MjA5MTczOTY0OX0.FnSt0xhlEIiYur5ye4S1xm9SueGQm5lsArsJlHkX08M';

function normalizeText(value) {
  return String(value || '').trim();
}

function buildProfileUpdates(result) {
  const idVerification = result?.id_verification || {};
  const updates = {};

  if (normalizeText(idVerification.first_name)) updates.first_name = normalizeText(idVerification.first_name);
  if (normalizeText(idVerification.middle_name)) updates.middle_name = normalizeText(idVerification.middle_name);
  if (normalizeText(idVerification.last_name)) updates.last_name = normalizeText(idVerification.last_name);
  if (normalizeText(idVerification.date_of_birth)) updates.date_of_birth = normalizeText(idVerification.date_of_birth);

  return updates;
}

async function fetchImageBlob(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to fetch verification image (${response.status}).`);
  }

  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  return { blob: await response.blob(), contentType };
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
  const normalized = normalizeText(value);
  return normalized ? `****${normalized.slice(-4)}` : null;
}

async function importDiditAsset(supabase, userId, sessionId, label, url) {
  if (!url) return null;
  const asset = await fetchImageBlob(url);
  const extension = asset.contentType.includes('png') ? 'png' : asset.contentType.includes('webp') ? 'webp' : 'jpg';
  const storagePath = `public/${userId}/didit_${sessionId}_${label}.${extension}`;
  const { error } = await supabase.storage
    .from('id-verifications')
    .upload(storagePath, await asset.blob.arrayBuffer(), { contentType: asset.contentType, upsert: true });

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

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return response.status(401).json({ error: 'Authentication required.' });
  }

  const diditApiKey = String(process.env.DIDIT_API_KEY || '').trim();
  if (!diditApiKey) {
    return response.status(503).json({ error: 'Didit is not configured on this environment.' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return response.status(401).json({ error: 'Authentication required.' });
    }

    const body = request.body || {};
    if (body.action === 'create-session') {
      const workflowId = normalizeText(body.workflow_id);
      const callbackUrl = normalizeText(body.callback_url);

      if (!workflowId) {
        return response.status(400).json({ error: 'Workflow ID is required.' });
      }

      const payload = {
        workflow_id: workflowId,
        vendor_data: user.id,
      };

      if (callbackUrl) {
        payload.callback = callbackUrl;
      }

      const diditResponse = await fetch('https://verification.didit.me/v3/session/', {
        body: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': diditApiKey,
        },
        method: 'POST',
      });

      const sessionPayload = await diditResponse.json().catch(() => null);
      if (!diditResponse.ok) {
        return response.status(diditResponse.status).json({
          error: sessionPayload?.message || sessionPayload?.detail || 'Unable to create Didit session.',
        });
      }

      return response.status(200).json({
        session_id: sessionPayload?.session_id || null,
        url: sessionPayload?.url || sessionPayload?.verification_url || sessionPayload?.link || null,
        verification_session: sessionPayload,
      });
    }

    if (body.action === 'session-decision') {
      const sessionId = normalizeText(body.session_id);

      if (!sessionId) {
        return response.status(400).json({ error: 'Session ID is required.' });
      }

      const decisionResponse = await fetch(`https://verification.didit.me/v3/session/${sessionId}/decision/`, {
        headers: {
          'x-api-key': diditApiKey,
        },
        method: 'GET',
      });

      const decisionPayload = await decisionResponse.json().catch(() => null);
      if (!decisionResponse.ok) {
        return response.status(decisionResponse.status).json({
          error: decisionPayload?.message || decisionPayload?.detail || 'Unable to fetch Didit decision.',
        });
      }

      const decision = decisionPayload?.data || decisionPayload || {};
      const idVerification = decision?.id_verifications?.[0] || decision?.id_verification || decision?.verification || decision?.result || {};
      const status = String(idVerification?.status || decision?.status || '').toLowerCase();
      const verified = ['approved', 'verified', 'success', 'completed'].includes(status);
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

      return response.status(200).json({
        decision,
        document_import_error: documents.error,
        verification: documents.verification,
        verified,
      });
    }

    const idFrontUrl = normalizeText(body.id_front_url);
    const idBackUrl = normalizeText(body.id_back_url);
    const selfieUrl = normalizeText(body.selfie_url);
    const idType = normalizeText(body.id_type);
    const idNumberMasked = normalizeText(body.id_number_masked);

    if (!idFrontUrl) {
      return response.status(400).json({ error: 'Front ID image is required.' });
    }

    const [frontAsset, backAsset] = await Promise.all([
      fetchImageBlob(idFrontUrl),
      idBackUrl ? fetchImageBlob(idBackUrl) : Promise.resolve(null),
    ]);

    const formData = new FormData();
    formData.append('front_image', frontAsset.blob, 'front-image');
    if (backAsset) {
      formData.append('back_image', backAsset.blob, 'back-image');
    }

    const diditResponse = await fetch('https://verification.didit.me/v3/id-verification/', {
      body: formData,
      headers: { 'x-api-key': diditApiKey },
      method: 'POST',
    });

    const payload = await diditResponse.json().catch(() => null);
    if (!diditResponse.ok) {
      return response.status(diditResponse.status).json({
        error: payload?.message || payload?.detail || 'Didit verification failed.',
      });
    }

    const status = String(payload?.id_verification?.status || '').toLowerCase();
    const verified = ['approved', 'verified'].includes(status);
    const profileUpdates = buildProfileUpdates(payload);

    const verificationRecord = {
      id_back_url: idBackUrl || null,
      id_front_url: idFrontUrl,
      id_number_masked: idNumberMasked || null,
      id_type: idType || null,
      selfie_url: selfieUrl || null,
      status: verified ? 'verified' : 'pending',
      user_id: user.id,
    };

    if (verified && Object.keys(profileUpdates).length) {
      const { error: profileError } = await supabase.from('profiles').update(profileUpdates).eq('id', user.id);
      if (profileError) {
        return response.status(500).json({ error: profileError.message });
      }
    }

    const { data: verification, error: verificationError } = await supabase
      .from('identity_verifications')
      .insert([verificationRecord])
      .select()
      .single();

    if (verificationError) {
      return response.status(500).json({ error: verificationError.message });
    }

    return response.status(200).json({
      profile_updates: profileUpdates,
      selfie_url: selfieUrl || null,
      status: verification.status,
      verification,
      verification_result: payload,
    });
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : 'Unexpected Didit error.' });
  }
};
