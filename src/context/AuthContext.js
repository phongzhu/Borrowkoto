import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../api/supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const userId = session?.user?.id;

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.warn('Unable to restore the Supabase session:', error.message);
      if (!active) return;
      setSession(data?.session || null);
      setLoading(Boolean(data?.session?.user));
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setLoading(Boolean(nextSession?.user));
      setSession(nextSession);
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!userId) {
      setRole(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.warn('Unable to load the signed-in user role:', error.message);
        setRole(String(data?.role || '').toLowerCase() || null);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId]);

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
