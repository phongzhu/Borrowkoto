import { supabase } from '../api/supabaseClient';

export const TERMS_BUCKET = 'terms-documents';
export const TERMS_CONTEXT = Object.freeze({
  ACTIVATION: 'activation',
  CHECKOUT: 'checkout',
});

const ACTIVE_TERMS_FIELDS = 'id, title, version, file_name, storage_path, extracted_text, content_hash, published_at';

export async function loadActiveTerms() {
  const { data, error } = await supabase
    .from('terms_documents')
    .select(ACTIVE_TERMS_FIELDS)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

export async function recordTermsAcceptance({ bookingId = null, context, itemId = null, termsDocumentId }) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) throw userError || new Error('Sign in before accepting the Terms and Conditions.');
  if (!Object.values(TERMS_CONTEXT).includes(context)) throw new Error('Invalid Terms and Conditions acceptance context.');
  if (!termsDocumentId) throw new Error('The active Terms and Conditions could not be identified.');

  const { error } = await supabase.from('terms_acceptances').insert({
    acceptance_context: context,
    booking_id: bookingId,
    item_id: itemId,
    terms_document_id: termsDocumentId,
    user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent,
    user_id: user.id,
  });

  if (error) throw error;
}

function joinPdfLineItems(items) {
  return items
    .sort((left, right) => Number(left.transform?.[4] || 0) - Number(right.transform?.[4] || 0))
    .map((item) => String(item.str || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function pageTextFromContent(content) {
  const lines = [];

  (content?.items || []).forEach((item) => {
    const y = Number(item.transform?.[5] || 0);
    const existing = lines.find((line) => Math.abs(line.y - y) <= 2);
    if (existing) {
      existing.items.push(item);
    } else {
      lines.push({ items: [item], y });
    }
  });

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => joinPdfLineItems(line.items))
    .filter(Boolean)
    .join('\n');
}

export function normalizeExtractedTermsText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTermsTextFromPdf(file) {
  if (!file || file.type !== 'application/pdf') throw new Error('Choose a PDF document.');
  if (file.size > 10 * 1024 * 1024) throw new Error('The Terms and Conditions PDF must be 10 MB or smaller.');

  const pdfjs = await import('pdfjs-dist/webpack.mjs');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    enableScripting: false,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = pageTextFromContent(content);
      if (pageText) pages.push(pageText);
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  const text = normalizeExtractedTermsText(pages.join('\n\n'));
  if (text.length < 50) {
    throw new Error('No readable text was found. Upload a text-based PDF instead of a scanned image-only document.');
  }

  return { pageCount, text };
}

export async function hashFile(file) {
  const browserCrypto = typeof window === 'undefined' ? null : window.crypto;
  if (!browserCrypto?.subtle) return '';
  const digest = await browserCrypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function safeTermsStoragePath(fileName) {
  const browserCrypto = typeof window === 'undefined' ? null : window.crypto;
  const safeName = String(fileName || 'terms.pdf')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-120) || 'terms.pdf';
  const uniquePart = browserCrypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${new Date().toISOString().slice(0, 10)}/${uniquePart}-${safeName}`;
}
