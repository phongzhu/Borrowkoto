import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import termsPdf from '../../assets/Borrow_Ko_To_Terms_and_Conditions.pdf';
import { supabase } from '../../api/supabaseClient';
import { useUISettings } from '../../context/UISettingsContext';
import { useAuth } from '../../context/AuthContext';
import {
  isNubStudentEmail,
  isValidStudentPassword,
  normalizeEmail,
  NUB_STUDENT_EMAIL_DOMAIN,
  STUDENT_PASSWORD_REQUIREMENTS,
} from '../../utils/nubStudentAuth';
import { ArrowRightIcon, EyeIcon, EyeOffIcon, KeyIcon, LockIcon, MailIcon } from '../../ui/icons';
import { AuthLayout } from '../../ui/layouts';
import { AuthInput, Button, FormField, Modal, StatusMessage } from '../../ui/primitives';
import { theme } from '../../ui/theme';

const EMAIL_STEP = 'email';
const PASSWORD_STEP = 'password';
const OTP_STEP = 'otp';
const ACTIVATE_STEP = 'activate';
const DEV_STUDENT_OTP = '000000';
const DEV_STUDENT_OTP_BYPASS_ENABLED = process.env.NODE_ENV === 'development'
  && process.env.REACT_APP_ENABLE_DEV_STUDENT_OTP_BYPASS === 'true';

export default function UserLoginPage() {
  const { settings } = useUISettings();
  const { loading: authLoading, role: authenticatedRole, user: authenticatedUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(EMAIL_STEP);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsViewed, setTermsViewed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const accent = settings.primary_color?.trim() || theme.colors.teal;

  useEffect(() => {
    if (!authLoading && authenticatedUser && authenticatedRole === 'admin') {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [authLoading, authenticatedRole, authenticatedUser, navigate]);

  async function navigateAfterLogin(user, { completeProfile = false } = {}) {
    const { data: roleProfile, error: roleError } = user
      ? await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      : { data: null, error: null };

    if (roleError) {
      setError(roleError.message);
      return;
    }

    if (String(roleProfile?.role || '').toLowerCase() === 'admin') {
      navigate('/admin/dashboard', { replace: true });
      return;
    }

    const { data: studentProfile, error: studentProfileError } = user
      ? await supabase.from('profiles').select('account_status, nub_registry_managed').eq('id', user.id).maybeSingle()
      : { data: null, error: null };

    if (studentProfileError) {
      setError(studentProfileError.message);
      return;
    }

    if (!studentProfile?.nub_registry_managed || String(studentProfile?.account_status || '').toLowerCase() !== 'active') {
      await supabase.auth.signOut();
      setError('This account is not linked to an active NU Baliwag student registry record.');
      return;
    }

    if (completeProfile) {
      navigate('/user/profile', { replace: true, state: { completeProfile: true } });
      return;
    }

    const requestedPath = location.state?.from;
    navigate(requestedPath?.pathname ? `${requestedPath.pathname}${requestedPath.search || ''}` : '/user/dashboard', { replace: true });
  }

  async function sendActivationOtp(normalizedEmail) {
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { shouldCreateUser: false },
    });
    if (otpError) throw otpError;
  }

  async function handleEmailLookup(event) {
    event.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setError('Enter your email address.');
      return;
    }

    setLoading(true);
    setError('');
    setMessage('');

    try {
      if (!isNubStudentEmail(normalizedEmail)) {
        setEmail(normalizedEmail);
        setStep(PASSWORD_STEP);
        return;
      }

      const response = await fetch('/api/nub-student-auth', {
        body: JSON.stringify({ email: normalizedEmail }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Unable to check the NU Baliwag student registry.');

      setEmail(normalizedEmail);

      if (payload.activation_required) {
        if (!DEV_STUDENT_OTP_BYPASS_ENABLED) await sendActivationOtp(normalizedEmail);
        setStep(OTP_STEP);
        setMessage(DEV_STUDENT_OTP_BYPASS_ENABLED ? '' : `We sent a one-time code to ${normalizedEmail}.`);
      } else {
        setStep(PASSWORD_STEP);
      }
    } catch (lookupError) {
      setError(lookupError?.message || 'Unable to continue with this email.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordLogin(event) {
    event.preventDefault();
    const normalizedEmail = normalizeEmail(email);
    if (!password.trim()) {
      setError('Enter your password.');
      return;
    }

    setLoading(true);
    setError('');
    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    setLoading(false);

    if (loginError) {
      const messageText = String(loginError.message || '').toLowerCase();
      setError(messageText.includes('email not confirmed')
        ? 'This student record still needs first-time OTP activation. Return and continue with your NUB email.'
        : 'Invalid email or password.');
      return;
    }

    await navigateAfterLogin(data?.user);
  }

  async function handleVerifyOtp(event) {
    event.preventDefault();
    if (!otp.trim()) {
      setError('Enter the one-time code sent to your email.');
      return;
    }

    setError('');

    if (DEV_STUDENT_OTP_BYPASS_ENABLED) {
      if (otp.trim() !== DEV_STUDENT_OTP) {
        setError('Invalid activation code.');
        return;
      }
      setMessage('');
      setStep(ACTIVATE_STEP);
      return;
    }

    setLoading(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: normalizeEmail(email),
      token: otp.trim(),
      type: 'email',
    });
    setLoading(false);

    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    setMessage('Email verified. Create your Borrow Ko’To password to finish activation.');
    setStep(ACTIVATE_STEP);
  }

  async function handleResendOtp() {
    if (DEV_STUDENT_OTP_BYPASS_ENABLED) {
      setError('');
      setMessage('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await sendActivationOtp(normalizeEmail(email));
      setMessage(`A new one-time code was sent to ${normalizeEmail(email)}.`);
    } catch (otpError) {
      setError(otpError?.message || 'Unable to resend the code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleActivation(event) {
    event.preventDefault();
    if (!isValidStudentPassword(password)) {
      setError(STUDENT_PASSWORD_REQUIREMENTS);
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (!termsViewed || !termsAccepted) {
      setError('View and accept the Terms and Agreement before activating your account.');
      return;
    }

    setLoading(true);
    setError('');

    if (DEV_STUDENT_OTP_BYPASS_ENABLED) {
      try {
        const response = await fetch('/api/nub-student-auth', {
          body: JSON.stringify({
            action: 'dev-activate-student',
            email: normalizeEmail(email),
            otp: otp.trim(),
            password,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || 'Unable to activate this development account.');

        const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
          email: normalizeEmail(email),
          password,
        });
        if (loginError) throw loginError;
        setLoading(false);
        await navigateAfterLogin(loginData?.user, { completeProfile: true });
      } catch (activationError) {
        setLoading(false);
        setError(activationError?.message || 'Unable to activate this development account.');
      }
      return;
    }

    const { data: userData, error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      setLoading(false);
      setError(passwordError.message);
      return;
    }

    const { error: activationError } = await supabase.rpc('complete_nub_student_activation');
    setLoading(false);
    if (activationError) {
      setError(`Your email was verified, but activation could not be completed: ${activationError.message}`);
      return;
    }

    await navigateAfterLogin(userData?.user, { completeProfile: true });
  }

  function resetEmail() {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setOtp('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setError('');
    setMessage('');
    setStep(EMAIL_STEP);
  }

  const passwordAction = (
    <button
      aria-label={showPassword ? 'Hide password' : 'Show password'}
      onClick={() => setShowPassword((current) => !current)}
      style={{ background: 'transparent', color: theme.colors.muted, cursor: 'pointer', display: 'inline-flex', padding: 0 }}
      type="button"
    >
      {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
    </button>
  );

  const confirmPasswordAction = (
    <button
      aria-label={showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'}
      onClick={() => setShowConfirmPassword((current) => !current)}
      style={{ background: 'transparent', color: theme.colors.muted, cursor: 'pointer', display: 'inline-flex', padding: 0 }}
      type="button"
    >
      {showConfirmPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
    </button>
  );

  return (
    <AuthLayout
      accent={accent}
      badge={step === OTP_STEP || step === ACTIVATE_STEP ? 'First-time activation' : undefined}
      subtitle={step === EMAIL_STEP
        ? `Use your @${NUB_STUDENT_EMAIL_DOMAIN} account. Your student details come from the university registry.`
        : step === OTP_STEP
          ? 'Enter the one-time activation code for this student account.'
          : step === ACTIVATE_STEP
            ? 'Set the password you will use for future Borrow Ko’To logins.'
            : 'Enter your Borrow Ko’To password to open your account.'}
      title={step === OTP_STEP ? 'Enter your OTP' : step === ACTIVATE_STEP ? 'Activate your account' : 'Login Page'}
    >
      {step === EMAIL_STEP ? (
        <form onSubmit={handleEmailLookup} style={{ display: 'grid', gap: 20 }}>
          <FormField label="NU Baliwag student email">
            <AuthInput autoComplete="email" autoFocus icon={<MailIcon size={18} />} onChange={(event) => setEmail(event.target.value)} placeholder={`name@${NUB_STUDENT_EMAIL_DOMAIN}`} required type="email" value={email} />
          </FormField>
          {location.state?.authError ? <StatusMessage tone="danger">{location.state.authError}</StatusMessage> : null}
          {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}
          <div className="auth-email-actions">
            <Button disabled={loading} icon={<ArrowRightIcon size={18} />} style={{ background: `linear-gradient(90deg, ${theme.colors.ink}, ${accent})`, borderColor: 'transparent', boxShadow: 'none', width: '100%' }} type="submit">
              {loading ? 'Checking student registry...' : 'Continue'}
            </Button>
            <Button onClick={() => navigate('/')} style={{ width: '100%' }} type="button" variant="secondary">Return to public landing page</Button>
          </div>
        </form>
      ) : null}

      {step === PASSWORD_STEP ? (
        <form onSubmit={handlePasswordLogin} style={{ display: 'grid', gap: 20 }}>
          <FormField label="Email address"><AuthInput disabled icon={<MailIcon size={18} />} type="email" value={email} /></FormField>
          <FormField label="Password">
            <AuthInput action={passwordAction} autoComplete="current-password" icon={<LockIcon size={18} />} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? 'text' : 'password'} value={password} />
          </FormField>
          {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}
          <Button disabled={loading} icon={<ArrowRightIcon size={18} />} style={{ width: '100%' }} type="submit">{loading ? 'Signing in...' : 'Sign in'}</Button>
          <Button onClick={resetEmail} type="button" variant="secondary">Use a different email</Button>
        </form>
      ) : null}

      {step === OTP_STEP ? (
        <form onSubmit={handleVerifyOtp} style={{ display: 'grid', gap: 20 }}>
          <FormField label="One-time password">
            <AuthInput autoComplete="one-time-code" autoFocus icon={<KeyIcon size={18} />} inputMode="numeric" onChange={(event) => setOtp(event.target.value)} required type="text" value={otp} />
          </FormField>
          {message ? <StatusMessage tone="info">{message}</StatusMessage> : null}
          {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}
          <Button disabled={loading} icon={<ArrowRightIcon size={18} />} style={{ width: '100%' }} type="submit">{loading ? 'Verifying...' : 'Verify email'}</Button>
          {!DEV_STUDENT_OTP_BYPASS_ENABLED ? <Button disabled={loading} onClick={handleResendOtp} type="button" variant="secondary">Resend OTP</Button> : null}
          <Button disabled={loading} onClick={resetEmail} type="button" variant="ghost">Use a different email</Button>
        </form>
      ) : null}

      {step === ACTIVATE_STEP ? (
        <form onSubmit={handleActivation} style={{ display: 'grid', gap: 20 }}>
          <FormField hint="At least 8 characters, including 1 uppercase and 1 lowercase letter" label="Create password">
            <AuthInput action={passwordAction} autoComplete="new-password" icon={<LockIcon size={18} />} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? 'text' : 'password'} value={password} />
          </FormField>
          <FormField label="Confirm password">
            <AuthInput action={confirmPasswordAction} autoComplete="new-password" icon={<LockIcon size={18} />} onChange={(event) => setConfirmPassword(event.target.value)} required type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} />
          </FormField>
          <div style={{ alignItems: 'center', border: `1px solid ${termsViewed ? 'rgba(47, 111, 73, 0.24)' : 'rgba(23, 49, 59, 0.12)'}`, borderRadius: 18, display: 'flex', gap: 12, justifyContent: 'space-between', padding: '12px 14px' }}>
            <label style={{ alignItems: 'center', color: termsViewed ? theme.colors.ink : theme.colors.slate, cursor: termsViewed ? 'pointer' : 'not-allowed', display: 'flex', gap: 10, fontSize: 13, fontWeight: 700 }}>
              <input checked={termsAccepted} disabled={!termsViewed} onChange={(event) => setTermsAccepted(event.target.checked)} type="checkbox" />
              <span>I agree to the Terms and Agreement.</span>
            </label>
            <Button onClick={() => { setTermsViewed(true); setTermsOpen(true); }} type="button" variant="secondary">View terms</Button>
          </div>
          {message ? <StatusMessage tone="success">{message}</StatusMessage> : null}
          {error ? <StatusMessage tone="danger">{error}</StatusMessage> : null}
          <Button disabled={loading || !termsAccepted} icon={<ArrowRightIcon size={18} />} style={{ width: '100%' }} type="submit">{loading ? 'Activating...' : 'Activate and continue'}</Button>
        </form>
      ) : null}

      <Modal actions={<Button onClick={() => setTermsOpen(false)} type="button" variant="secondary">Close</Button>} contentStyle={{ width: 'min(900px, calc(100vw - 40px))' }} onClose={() => setTermsOpen(false)} open={termsOpen} title="Terms and Agreement">
        <iframe src={termsPdf} style={{ border: 0, display: 'block', height: '65vh', width: '100%' }} title="Borrow Ko To Terms and Agreement" />
      </Modal>
    </AuthLayout>
  );
}
