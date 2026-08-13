import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../api/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const [resolvedRole, setResolvedRole] = useState({ userId: null, role: null });
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
      setResolvedRole({ userId: null, role: null });
      return undefined;
    }

    supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.warn('Unable to load the signed-in user role:', error.message);
        setResolvedRole({
          userId,
          role: String(data?.role || '').toLowerCase() || null,
        });
      })
      .catch((error) => {
        if (!active) return;
        console.warn('Unable to load the signed-in user role:', error?.message || error);
        setResolvedRole({ userId, role: null });
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const role = resolvedRole.userId === userId ? resolvedRole.role : null;
  const loading = !sessionInitialized || Boolean(userId && resolvedRole.userId !== userId);

  const value = useMemo(() => ({
    loading,
    role,
    session,
    user: session?.user || null,
  }), [loading, role, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
