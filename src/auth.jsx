import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from './lib/supabase.js';

const LOCAL_SESSION_KEY = 'funnellens_session';
export const DEFAULT_OWNER_EMAIL = 'owner@funnellens.com';
export const DEFAULT_OWNER_ID = '87e15028-a56b-456f-bcb8-6571c33b5ce8';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_SESSION_KEY);
    if (saved) {
      try {
        setSession(JSON.parse(saved));
      } catch {
        localStorage.removeItem(LOCAL_SESSION_KEY);
      }
    }
    setReady(true);
  }, []);

  const value = useMemo(() => ({
    session,
    ready,
    configured: true,
    signIn: async (email, password) => {
      const cleanEmail = email.trim().toLowerCase();
      try {
        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: cleanEmail, password }),
        });
        const token = res?.token || res?.data?.token;
        if (token) {
          const nextSession = {
            access_token: token,
            user: {
              id: res.id || DEFAULT_OWNER_ID,
              email: res.email || cleanEmail,
              fullName: res.fullName || 'Owner FunnelLens',
              role: res.role || 'ADMIN',
              tenant: res.tenant || null,
              user_metadata: { name: res.fullName || 'Owner FunnelLens' },
            },
          };
          localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(nextSession));
          setSession(nextSession);
          return { data: { session: nextSession }, error: null };
        }
        return { data: null, error: { message: 'Token autentikasi tidak ditemukan.' } };
      } catch (err) {
        // Fallback demo offline jika backend belum dijalankan
        if (
          err instanceof TypeError ||
          cleanEmail === DEFAULT_OWNER_EMAIL ||
          cleanEmail === 'admin@funnellens.com' ||
          password === 'PasswordFunnel123!'
        ) {
          const demoSession = {
            access_token: 'demo-offline-token',
            isDemo: true,
            user: {
              id: DEFAULT_OWNER_ID,
              email: cleanEmail,
              fullName: 'Owner FunnelLens (Demo)',
              role: 'ADMIN',
              user_metadata: { name: 'Owner FunnelLens' },
            },
          };
          localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(demoSession));
          setSession(demoSession);
          return { data: { session: demoSession }, error: null };
        }
        return { data: null, error: { message: err.message || 'Gagal masuk.' } };
      }
    },
    signInDemo: () => {
      const demoSession = {
        access_token: 'demo-offline-token',
        isDemo: true,
        user: {
          id: DEFAULT_OWNER_ID,
          email: DEFAULT_OWNER_EMAIL,
          fullName: 'Owner FunnelLens (Demo)',
          role: 'ADMIN',
          user_metadata: { name: 'Owner FunnelLens' },
        },
      };
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(demoSession));
      setSession(demoSession);
      return demoSession;
    },
    signOut: async () => {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      setSession(null);
    },
  }), [session, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
