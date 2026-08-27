import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../api/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [resolvedAccess, setResolvedAccess] = useState({
    accountStatus: null,
    nubRegistryManaged: false,
    role: null,
    userId: null,
  });
  const userId = session?.user?.id;

  useEffect(() => {
    let active = true;

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) console.warn('Unable to restore the Supabase session:', error.message);
        if (!active) return;
        setSession(data?.session || null);
      })
      .catch((error) => {
        console.warn('Unable to restore the Supabase session:', error?.message || error);
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setSessionInitialized(true);
      });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionInitialized(true);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!userId) {
      setResolvedAccess({ accountStatus: null, nubRegistryManaged: false, role: null, userId: null });
      return undefined;
    }

    async function resolveSignedInAccess() {
      try {
        const { data: roleProfile, error: roleError } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();

        if (!active) return;
        if (roleError) throw roleError;

        const role = String(roleProfile?.role || '').toLowerCase() || null;
        if (role === 'admin') {
          setResolvedAccess({ accountStatus: null, nubRegistryManaged: false, role: 'admin', userId });
          return;
        }

        const { data: studentProfile, error: studentError } = await supabase
          .from('profiles')
          .select('account_status, nub_registry_managed')
          .eq('id', userId)
          .maybeSingle();

        if (!active) return;
        if (studentError) throw studentError;

        setResolvedAccess({
          accountStatus: String(studentProfile?.account_status || '').toLowerCase() || null,
          nubRegistryManaged: Boolean(studentProfile?.nub_registry_managed),
          role,
          userId,
        });
      } catch (error) {
        if (!active) return;
        console.warn('Unable to load the signed-in user access:', error?.message || error);
        setResolvedAccess({ accountStatus: null, nubRegistryManaged: false, role: null, userId });
      }
    }

    resolveSignedInAccess();

    return () => {
      active = false;
    };
  }, [userId]);

  const access = resolvedAccess.userId === userId ? resolvedAccess : null;
  const role = access?.role || null;
  const studentAccess = role === 'admin' || Boolean(access?.nubRegistryManaged && access?.accountStatus === 'active');
  const loading = !sessionInitialized || Boolean(userId && resolvedAccess.userId !== userId);

  const value = useMemo(() => ({
    loading,
    role,
    session,
    studentAccess,
    user: session?.user || null,
  }), [loading, role, session, studentAccess]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
