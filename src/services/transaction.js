const PAYMONGO_TEST_API_BASE_URL =
  process.env.NODE_ENV === 'development' ? '/api/paymongo/v1' : 'https://api.paymongo.com/v1';

const PAYMONGO_TEST_SECRET_KEY_ENV_KEYS = Object.freeze([
  'REACT_APP_PAYMONGO_TEST_SECRET_KEY',
  'REACT_APP_PAYMONGO_SECRET_KEY',
]);
const DEFAULT_CHECKOUT_PAYMENT_METHOD_TYPES = Object.freeze(['card', 'qrph']);

function readPayMongoTestSecretKey() {
  const secretKey = PAYMONGO_TEST_SECRET_KEY_ENV_KEYS.map((envKey) => process.env[envKey]).find(
    (value) => typeof value === 'string' && value.trim()
  );

  if (!secretKey) {
    throw new Error(
      'PayMongo test secret key is not configured. Set REACT_APP_PAYMONGO_TEST_SECRET_KEY to a PayMongo test key.'
    );
  }

  const trimmedKey = secretKey.trim();

  if (!trimmedKey.startsWith('sk_test_')) {
    throw new Error('Only PayMongo test keys are allowed in this project.');
  }

  return trimmedKey;
}

function toCentavos(amount) {
  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Amount must be a positive number.');
  }

  return Math.round(numericAmount * 100);
}

function toBase64(value) {
  if (typeof btoa === 'function') {
    return btoa(value);
  }

  return Buffer.from(value).toString('base64');
}

function buildPayMongoHeaders() {
  if (process.env.NODE_ENV === 'development') {
    return {
      'Content-Type': 'application/json',
    };
  }

  const secretKey = readPayMongoTestSecretKey();
  return {
    Authorization: `Basic ${toBase64(`${secretKey}:`)}`,
    'Content-Type': 'application/json',
  };
}

async function paymongoRequest(path, options = {}) {
  const { body, method = 'POST', signal } = options;

  const response = await fetch(`${PAYMONGO_TEST_API_BASE_URL}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: buildPayMongoHeaders(),
    method,
    signal,
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const firstError = payload?.errors?.[0];
    const apiMessage = firstError?.detail || firstError?.code || firstError?.title || '';
    const fallbackMessage = `PayMongo request failed (${response.status} ${response.statusText || 'unknown'})`;
    throw new Error(apiMessage ? `${apiMessage} (${response.status} ${response.statusText || 'unknown'})` : fallbackMessage);
  }

  return payload;
}

function normalizePaymentMethodTypes(paymentMethodTypes) {
  return Array.from(
    new Set(
      (Array.isArray(paymentMethodTypes) ? paymentMethodTypes : [])
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function extractMerchantPaymentMethodTypes(payload) {
  const candidateValues = [];

  if (Array.isArray(payload)) {
    candidateValues.push(...payload);
  }

  if (Array.isArray(payload?.value)) {
    candidateValues.push(...payload.value);
  }

  if (Array.isArray(payload?.data)) {
    payload.data.forEach((entry) => {
      if (typeof entry === 'string') {
        candidateValues.push(entry);
        return;
      }

      if (entry?.id) {
        candidateValues.push(entry.id);
      }

      if (entry?.attributes?.code) {
        candidateValues.push(entry.attributes.code);
      }

      if (entry?.attributes?.type) {
        candidateValues.push(entry.attributes.type);
      }

      if (entry?.attributes?.payment_method_type) {
        candidateValues.push(entry.attributes.payment_method_type);
      }
    });
  }

  return normalizePaymentMethodTypes(candidateValues);
}

export async function createTestPaymentIntent({
  amount,
  currency = 'PHP',
  description = '',
  metadata = {},
  paymentMethodTypes = ['card'],
  statementDescriptor = '',
} = {}) {
  const payload = {
    data: {
      attributes: {
        amount: toCentavos(amount),
        currency,
        description: description || undefined,
        metadata: metadata && Object.keys(metadata).length ? metadata : undefined,
        payment_method_allowed: paymentMethodTypes,
        statement_descriptor: statementDescriptor || undefined,
      },
    },
  };

  const response = await paymongoRequest('/payment_intents', {
    body: payload,
    method: 'POST',
  });

  return response.data;
}

export async function attachTestPaymentMethod({ paymentIntentId, paymentMethodId, returnUrl } = {}) {
  if (!paymentIntentId) {
    throw new Error('paymentIntentId is required.');
  }

  if (!paymentMethodId) {
    throw new Error('paymentMethodId is required.');
  }

  const response = await paymongoRequest(`/payment_intents/${paymentIntentId}/attach`, {
    body: {
      data: {
        attributes: {
          payment_method: paymentMethodId,
          return_url: returnUrl || undefined,
        },
      },
    },
    method: 'POST',
  });

  return response.data;
}

export async function createTestPaymentMethodCard({
  cardNumber,
  expMonth,
  expYear,
  cvc,
  billing = {},
} = {}) {
  const response = await paymongoRequest('/payment_methods', {
    body: {
      data: {
        attributes: {
          billing: billing && Object.keys(billing).length ? billing : undefined,
          details: {
            card_number: cardNumber,
            cvc,
            exp_month: expMonth,
            exp_year: expYear,
          },
          type: 'card',
        },
      },
    },
    method: 'POST',
  });

  return response.data;
}

export async function retrievePossibleMerchantPaymentMethods() {
  const response = await paymongoRequest('/merchants/capabilities/payment_methods', {
    method: 'GET',
  });

  return extractMerchantPaymentMethodTypes(response);
}

export async function createTestCheckoutSession({
  amount,
  cancelUrl,
  currency = 'PHP',
  description = '',
  lineItems = [],
  metadata = {},
  paymentMethodTypes = DEFAULT_CHECKOUT_PAYMENT_METHOD_TYPES,
  showDescription = true,
  showLineItems = false,
  successUrl,
} = {}) {
  if (!successUrl || !cancelUrl) {
    throw new Error('successUrl and cancelUrl are required.');
  }

  const normalizedLineItems = (lineItems.length ? lineItems : [{ amount, name: description || 'Rental booking', quantity: 1 }]).map(
    (item) => ({
      amount: toCentavos(item.amount),
      currency,
      description: item.description || undefined,
      name: item.name || 'Rental booking',
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
    })
  );

  const requestedPaymentMethodTypes = normalizePaymentMethodTypes(paymentMethodTypes);
  const primaryPaymentMethodTypes = requestedPaymentMethodTypes.length ? requestedPaymentMethodTypes : ['card'];

  const buildCheckoutAttributes = (resolvedPaymentMethodTypes) => ({
    cancel_url: cancelUrl,
    currency,
    line_items: normalizedLineItems,
    payment_method_types: resolvedPaymentMethodTypes,
    show_description: showDescription,
    show_line_items: showLineItems,
    success_url: successUrl,
  });

  const buildPreferredAttributes = (resolvedPaymentMethodTypes) => ({
    ...buildCheckoutAttributes(resolvedPaymentMethodTypes),
    description: description || undefined,
    metadata: metadata && Object.keys(metadata).length ? metadata : undefined,
  });

  const fallbackPaymentMethodSets = [];
  const pushFallbackPaymentMethods = (candidateTypes) => {
    const normalizedTypes = normalizePaymentMethodTypes(candidateTypes);

    if (!normalizedTypes.length) {
      return;
    }

    if (!fallbackPaymentMethodSets.some((existing) => existing.join('|') === normalizedTypes.join('|'))) {
      fallbackPaymentMethodSets.push(normalizedTypes);
    }
  };

  pushFallbackPaymentMethods(primaryPaymentMethodTypes);
  pushFallbackPaymentMethods(['card', 'qrph']);
  pushFallbackPaymentMethods(['card']);
  pushFallbackPaymentMethods(['qrph']);

  let response;
  let lastError = null;

  for (const resolvedPaymentMethodTypes of fallbackPaymentMethodSets) {
    try {
      response = await paymongoRequest('/checkout_sessions', {
        body: {
          data: {
            attributes: buildPreferredAttributes(resolvedPaymentMethodTypes),
          },
        },
        method: 'POST',
      });
      break;
    } catch (error) {
      lastError = error;

      // Retry with a smaller payload or alternate method set if the current combination is not supported.
      if (String(error?.message || '').includes('403') || String(error?.message || '').includes('400')) {
        try {
          response = await paymongoRequest('/checkout_sessions', {
            body: {
              data: {
                attributes: buildCheckoutAttributes(resolvedPaymentMethodTypes),
              },
            },
            method: 'POST',
          });
          break;
        } catch (retryError) {
          lastError = retryError;
          continue;
        }
      }

      throw error;
    }
  }

  if (!response) {
    throw lastError || new Error('Unable to create PayMongo checkout session.');
  }

  return response.data;
}

export function buildTransactionPayload({
  amount,
  bookingId = null,
  notes = '',
  payeeId = null,
  payerId = null,
  paymentMethod = 'card',
  referenceNumber = '',
  status = 'pending',
  transactionAt = new Date().toISOString(),
  transactionType = 'payment',
  proofUrl = '',
} = {}) {
  return {
    amount,
    booking_id: bookingId,
    notes: notes || null,
    payee_id: payeeId,
    payer_id: payerId,
    payment_method: paymentMethod,
    proof_url: proofUrl || null,
    reference_number: referenceNumber || null,
    status,
    transaction_at: transactionAt,
    transaction_type: transactionType,
  };
}

export function isPayMongoTestKeyConfigured() {
  try {
    return Boolean(readPayMongoTestSecretKey());
  } catch (error) {
    return false;
  }
}

const transactionService = {
  attachTestPaymentMethod,
  buildTransactionPayload,
  createTestCheckoutSession,
  createTestPaymentIntent,
  createTestPaymentMethodCard,
  isPayMongoTestKeyConfigured,
  retrievePossibleMerchantPaymentMethods,
};

export default transactionService;
