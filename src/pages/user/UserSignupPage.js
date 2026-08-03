import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { useUISettings } from '../../context/UISettingsContext';
import { ArrowRightIcon, EyeIcon, EyeOffIcon, KeyIcon, LockIcon, MailIcon } from '../../ui/icons';
import { AuthLayout } from '../../ui/layouts';
import { AuthInput, Button, FormField, StatusMessage } from '../../ui/primitives';
import { theme } from '../../ui/theme';
import termsPdf from '../../assets/Borrow_Ko_To_Terms_and_Conditions.pdf';

export default function UserSignupPage() {
  const { settings } = useUISettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [termsViewed, setTermsViewed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const navigate = useNavigate();
  const accent = settings.primary_color?.trim() || theme.colors.teal;

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  useEffect(() => {
    if (!otpSuccess) {
      return undefined;
    }

    const timer = setTimeout(() => {
      navigate('/login');
    }, 4000);

    return () => clearTimeout(timer);
  }, [navigate, otpSuccess]);

  async function handleSignup(event) {
    event.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      setError('Email and password are required.');
      return;
    }

    if (!termsViewed || !termsAccepted) {
      setError('Please view and accept the Terms and Agreement before creating an account.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess(false);

    const { data: existingCredential, error: existingCredentialError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: trimmedPassword,
    });

    if (existingCredential?.session) {
      await supabase.auth.signOut();
      setLoading(false);
      setError('An account with these credentials already exists. Please sign in instead.');
      return;
    }

    if (existingCredentialError && String(existingCredentialError.message || '').toLowerCase().includes('email not confirmed')) {
      setLoading(false);
      setError('This account already exists but is still awaiting email verification.');
      return;
    }

    const { error: signupError } = await supabase.auth.signUp({
      email: normalizedEmail,
      password: trimmedPassword,
    });

    setLoading(false);

    if (signupError) {
      const message = String(signupError.message || '').toLowerCase();
      if (message.includes('already') || message.includes('exists') || message.includes('registered')) {
        setError('This email is already registered. Please sign in.');
        return;
      }

      setError(signupError.message);
      return;
    }

    setEmail(normalizedEmail);
    setSuccess(true);
  }

  function handleViewTerms() {
    setTermsViewed(true);
    window.open(termsPdf, '_blank', 'noopener,noreferrer');
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setOtpSuccess(false);

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'signup',
    });

    setLoading(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    setOtpSuccess(true);
  }

  return (
    <AuthLayout
      accent={accent}
      badge={success ? 'Email verification' : 'Create account'}
      subtitle={success ? 'Enter the one-time code sent to your email to finish account creation.' : 'Set your credentials first. The system will then send a one-time verification code to your email.'}
      title={success ? 'Verify account' : 'Create account'}
    >
      {success ? (
        <form onSubmit={handleVerifyOtp} style={{ display: 'grid', gap: 20 }}>
          <StatusMessage tone="info">Enter the verification code sent to {email}.</StatusMessage>

          <FormField label="One-time password">
            <AuthInput
              icon={<KeyIcon size={18} />}
              type="text"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              required
            />
          </FormField>

          {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}
          {otpSuccess ? (
            <StatusMessage tone="success">
              OTP verified. Redirecting you to the user login page.
            </StatusMessage>
          ) : null}

          <div style={{ display: 'grid', gap: 14 }}>
            <Button
              disabled={loading}
              icon={<ArrowRightIcon size={18} />}
              style={{
                background: `linear-gradient(90deg, ${theme.colors.ink}, ${accent})`,
                borderColor: 'transparent',
                boxShadow: 'none',
                width: '100%',
              }}
              type="submit"
            >
              {loading ? 'Verifying...' : 'Verify account'}
            </Button>

            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <span style={{ color: theme.colors.slate }}>Already confirmed?</span>
              <button
                onClick={() => navigate('/login')}
                style={{
                  background: 'transparent',
                  color: accent,
                  cursor: 'pointer',
                  fontFamily: theme.fonts.body,
                  fontSize: 14,
                  fontWeight: 700,
                  padding: 0,
                }}
                type="button"
              >
                Go to sign in
              </button>
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSignup} style={{ display: 'grid', gap: 20 }}>
          <FormField label="Email address">
            <AuthInput
              autoComplete="email"
              icon={<MailIcon size={18} />}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </FormField>

          <FormField label="Password">
            <AuthInput
              action={
                <button
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword((current) => !current)}
                  style={{
                    background: 'transparent',
                    color: theme.colors.muted,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    padding: 0,
                  }}
                  type="button"
                >
                  {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
                </button>
              }
              autoComplete="new-password"
              icon={<LockIcon size={18} />}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </FormField>

          <div
            style={{
              alignItems: 'center',
              border: `1px solid ${termsViewed ? 'rgba(47, 111, 73, 0.24)' : 'rgba(23, 49, 59, 0.12)'}`,
              borderRadius: 999,
              display: 'flex',
              gap: 12,
              justifyContent: 'space-between',
              padding: '10px 12px',
            }}
          >
            <label
              style={{
                alignItems: 'center',
                color: termsViewed ? theme.colors.ink : theme.colors.slate,
                cursor: termsViewed ? 'pointer' : 'not-allowed',
                display: 'flex',
                gap: 10,
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              <input
                checked={termsAccepted}
                disabled={!termsViewed}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                type="checkbox"
              />
              <span>I agree to the Terms and Agreement.</span>
            </label>
            <button
              onClick={handleViewTerms}
              style={{
                background: termsViewed ? 'rgba(47, 111, 73, 0.08)' : 'transparent',
                border: `1px solid ${accent}`,
                borderRadius: 999,
                color: accent,
                cursor: 'pointer',
                flex: '0 0 auto',
                fontFamily: theme.fonts.body,
                fontSize: 12,
                fontWeight: 900,
                minHeight: 34,
                padding: '0 14px',
                whiteSpace: 'nowrap',
              }}
              type="button"
            >
              View terms
            </button>
          </div>

          {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}

          <div style={{ display: 'grid', gap: 14 }}>
            <Button
              disabled={loading || !termsAccepted}
              icon={<ArrowRightIcon size={18} />}
              style={{
                background: `linear-gradient(90deg, ${theme.colors.ink}, ${accent})`,
                borderColor: 'transparent',
                boxShadow: 'none',
                width: '100%',
              }}
              type="submit"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </Button>

            <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              <span style={{ color: theme.colors.slate }}>Already have an account?</span>
              <button
                onClick={() => navigate('/login')}
                style={{
                  background: 'transparent',
                  color: accent,
                  cursor: 'pointer',
                  fontFamily: theme.fonts.body,
                  fontSize: 14,
                  fontWeight: 700,
                  padding: 0,
                }}
                type="button"
              >
                Sign in
              </button>
            </div>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
