import React, { useEffect, useState } from 'react';
import { createTestPaymentIntent, isPayMongoTestKeyConfigured } from './transaction';
import { Badge, Button, FormField, Input, Panel, SectionHeading, StatusMessage, Textarea } from '../ui/primitives';
import { CheckIcon, HomeIcon, SparkIcon } from '../ui/icons';
import { theme } from '../ui/theme';

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

export default function TransactionsTesting() {
  const [amount, setAmount] = useState('50');
  const [currency, setCurrency] = useState('PHP');
  const [description, setDescription] = useState('Borrow Ko To PayMongo test');
  const [statementDescriptor, setStatementDescriptor] = useState('BORROWKOTO TEST');
  const [metadata, setMetadata] = useState('{\n  "source": "borrowkoto",\n  "mode": "testing"\n}');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    setIsConfigured(isPayMongoTestKeyConfigured());
  }, []);

  async function handleCreateIntent(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage('');
    setResult(null);

    try {
      const parsedMetadata = metadata.trim() ? JSON.parse(metadata) : {};

      const payload = await createTestPaymentIntent({
        amount,
        currency: currency.trim().toUpperCase(),
        description,
        metadata: parsedMetadata,
        paymentMethodTypes: ['card'],
        statementDescriptor,
      });

      setResult(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to create the test intent.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const statusTone = errorMessage ? 'danger' : result ? 'success' : 'info';

  return (
    <div
      style={{
        background: 'linear-gradient(180deg, rgba(31, 111, 99, 0.08) 0%, #f4efe6 34%, #f0ebe1 100%)',
        minHeight: '100vh',
        padding: '28px 20px 48px',
      }}
    >
      <div style={{ margin: '0 auto', maxWidth: 1280 }}>
        <Panel
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.96), rgba(244,239,230,0.94))',
            border: `1px solid rgba(24, 33, 46, 0.08)`,
            boxShadow: theme.shadows.panel,
          }}
        >
          <div style={{ display: 'grid', gap: 18 }}>
            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' }}>
              <SectionHeading
                eyebrow="PayMongo test harness"
                title="Transaction Testing"
                description="Use this page to verify that the test PayMongo key can create intents from the current Borrow Ko To interface."
              />
              <Badge tone={isConfigured ? 'success' : 'warning'}>
                {isConfigured ? 'Test key detected' : 'Configure PAYMONGO_TEST_SECRET_KEY'}
              </Badge>
            </div>

            <StatusMessage tone={statusTone}>
              {errorMessage ? (
                errorMessage
              ) : result ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                  <CheckIcon size={16} />
                  Payment intent created successfully. Inspect the payload on the right.
                </span>
              ) : (
                'Fill the form, then create a test payment intent to confirm the API handshake.'
              )}
            </StatusMessage>

            <div
              style={{
                display: 'grid',
                gap: 20,
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 0.95fr)',
              }}
            >
              <Panel
                interactive
                style={{
                  background: 'rgba(255,255,255,0.9)',
                  border: '1px solid rgba(24,33,46,0.08)',
                }}
                title="Create test intent"
                subtitle="This keeps the flow intentionally small: one request, one response, no production side effects."
              >
                <form onSubmit={handleCreateIntent} style={{ display: 'grid', gap: 16 }}>
                  <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                    <FormField label="Amount in PHP" hint="Use a small test amount like 50 or 100.">
                      <Input
                        inputMode="decimal"
                        min="1"
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="50"
                        type="number"
                        value={amount}
                      />
                    </FormField>

                    <FormField label="Currency">
                      <Input
                        maxLength={3}
                        onChange={(event) => setCurrency(event.target.value)}
                        placeholder="PHP"
                        value={currency}
                      />
                    </FormField>
                  </div>

                  <FormField label="Description">
                    <Input
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Borrow Ko To PayMongo test"
                      value={description}
                    />
                  </FormField>

                  <FormField label="Statement descriptor" hint="Optional, shown in the intent payload. Keep it short.">
                    <Input
                      onChange={(event) => setStatementDescriptor(event.target.value)}
                      placeholder="BORROWKOTO TEST"
                      value={statementDescriptor}
                    />
                  </FormField>

                  <FormField label="Metadata" hint="Valid JSON only. Use this to tag the test request.">
                    <Textarea
                      onChange={(event) => setMetadata(event.target.value)}
                      spellCheck="false"
                      value={metadata}
                    />
                  </FormField>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', marginTop: 4 }}>
                    <Button disabled={isSubmitting} icon={<SparkIcon size={16} />} type="submit">
                      {isSubmitting ? 'Creating intent...' : 'Create test intent'}
                    </Button>

                    <Button
                      as="a"
                      href="/"
                      icon={<HomeIcon size={16} />}
                      variant="secondary"
                    >
                      Back to home
                    </Button>
                  </div>
                </form>
              </Panel>

              <Panel
                interactive
                style={{
                  background: 'rgba(11, 17, 32, 0.96)',
                  color: '#f8fafc',
                }}
                title="Latest response"
                subtitle="A successful request should return a `data` object from PayMongo."
              >
                <div style={{ display: 'grid', gap: 12 }}>
                  <div
                    style={{
                      display: 'grid',
                      gap: 12,
                      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    }}
                  >
                    <MetricTile label="Status" value={result ? 'Created' : errorMessage ? 'Error' : 'Idle'} />
                    <MetricTile label="Key" value={isConfigured ? 'Configured' : 'Missing'} />
                  </div>

                  <pre
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 20,
                      color: '#e5eef7',
                      fontFamily: theme.fonts.mono,
                      fontSize: 12,
                      lineHeight: 1.65,
                      margin: 0,
                      maxHeight: 520,
                      overflow: 'auto',
                      padding: 18,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {result
                      ? formatJson(result)
                      : errorMessage
                        ? formatJson({ error: errorMessage })
                        : formatJson({
                            data: {
                              type: 'payment_intent',
                              attributes: {
                                amount: 5000,
                                currency: 'PHP',
                                description: 'PayMongo test intent preview',
                                payment_method_allowed: ['card'],
                              },
                            },
                          })}
                  </pre>

                  <StatusMessage tone={isConfigured ? 'success' : 'warning'}>
                    {isConfigured
                      ? 'The test secret key is available. If the request fails, the browser console or PayMongo response will show the exact issue.'
                      : 'Add PAYMONGO_TEST_SECRET_KEY to your .env file, then restart the dev server before testing.'}
                  </StatusMessage>
                </div>
              </Panel>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function MetricTile({ label, value }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 18,
        display: 'grid',
        gap: 8,
        padding: 16,
      }}
    >
      <span style={{ color: 'rgba(248,250,252,0.66)', fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <strong style={{ color: '#ffffff', fontFamily: theme.fonts.display, fontSize: 18, letterSpacing: '-0.05em' }}>
        {value}
      </strong>
    </div>
  );
}
