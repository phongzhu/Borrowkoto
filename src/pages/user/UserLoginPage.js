import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../api/supabaseClient';
import { useUISettings } from '../../context/UISettingsContext';
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '../../ui/icons';
import { AuthLayout } from '../../ui/layouts';
import { AuthInput, Button, FormField, StatusMessage } from '../../ui/primitives';
import { theme } from '../../ui/theme';

export default function UserLoginPage() {
  const { settings } = useUISettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const accent = settings.primary_color?.trim() || theme.colors.teal;

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setError('');

    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: trimmedPassword,
    });

    if (loginError) {
      setLoading(false);
      const message = String(loginError.message || '').toLowerCase();
      if (message.includes('email not confirmed')) {
        setError('This account is not verified yet. Complete OTP verification from the sign up page.');
        return;
      }

      setError('Invalid email or password.');
      return;
    }

    const user = loginData?.user;
    const { data: profile, error: profileError } = user
      ? await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      : { data: null, error: null };

    setLoading(false);

    if (profileError) {
      setError(profileError.message);
      return;
    }

    const userRole = String(profile?.role || user?.user_metadata?.user_role || user?.user_metadata?.role || '').toLowerCase();

    if (userRole === 'admin') {
      navigate('/admin/dashboard');
      return;
    }

    navigate('/');
  }

  return (
    <AuthLayout
      accent={accent}
      badge="Member access"
      subtitle="Enter your account details to open the member workspace."
      title="Sign in"
    >
      <form onSubmit={handleLogin} style={{ display: 'grid', gap: 20 }}>
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
            autoComplete="current-password"
            icon={<LockIcon size={18} />}
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </FormField>

        {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}

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
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>

          <Button onClick={() => navigate('/')} type="button" variant="secondary">
            Return to public landing page
          </Button>

          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            <span style={{ color: theme.colors.slate }}>Need an account?</span>
            <button
              onClick={() => navigate('/signup')}
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
              Create one now
            </button>
          </div>
        </div>
      </form>
    </AuthLayout>
  );
}
