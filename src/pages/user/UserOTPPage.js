import { useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import { useUISettings } from '../../context/UISettingsContext';
import { CheckIcon, ShieldIcon, SparkIcon, UsersIcon } from '../../ui/icons';
import { AuthLayout } from '../../ui/layouts';
import { Button, FormField, Input, StatusMessage } from '../../ui/primitives';
import { theme } from '../../ui/theme';

const highlights = [
  {
    icon: <ShieldIcon size={20} />,
    title: 'Verify safely',
    description: 'OTP verification confirms the email identity used to create the account.',
  },
  {
    icon: <UsersIcon size={20} />,
    title: 'Unlock member access',
    description: 'Once verified, the account can move into the member workspace.',
  },
  {
    icon: <SparkIcon size={20} />,
    title: 'Shared UI system',
    description: 'This page also uses the same modular auth shell as the other entry flows.',
  },
  {
    icon: <CheckIcon size={20} />,
    title: 'Immediate confirmation',
    description: 'Successful verification is surfaced inline without relying on legacy page CSS.',
  },
];

export default function UserOTPPage({ email }) {
  const { settings } = useUISettings();
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const brandName = settings.system_name?.trim();

  async function handleVerify(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess(false);

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

    setSuccess(true);
  }

  return (
    <AuthLayout
      accent={settings.primary_color?.trim() || theme.colors.teal}
      badge="OTP verification"
      highlights={highlights}
      subtitle="Enter the one-time password sent to your email to complete the signup process."
      title="Confirm your account."
    >
      <form onSubmit={handleVerify} style={{ display: 'grid', gap: 18 }}>
        <FormField label="One-time password">
          <Input
            type="text"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            required
          />
        </FormField>

        {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}
        {success ? <StatusMessage tone="success">{brandName ? `${brandName} account verified.` : 'Account verified.'}</StatusMessage> : null}

        <Button disabled={loading} style={{ width: '100%' }} type="submit">
          {loading ? 'Verifying...' : 'Verify'}
        </Button>
      </form>
    </AuthLayout>
  );
}
