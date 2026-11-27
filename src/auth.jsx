import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from './lib/supabase.js';

const LOCAL_SESSION_KEY = 'funnellens_session';

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
        if (!token) {
          return { data: null, error: { message: 'Token autentikasi tidak diterima dari server.' } };
        }
        const nextSession = {
          access_token: token,
          user: {
            id: res.id,
            email: res.email || cleanEmail,
            fullName: res.fullName || cleanEmail,
            role: res.role || 'ADMIN',
            tenant: res.tenant || null,
            user_metadata: { name: res.fullName || cleanEmail },
          },
        };
        localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(nextSession));
        setSession(nextSession);
        return { data: { session: nextSession }, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message || 'Gagal masuk ke server.' } };
      }
    },
    register: async ({ fullName, email, password, confirmPassword, tenantName, tenantAddress }) => {
      try {
        const res = await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            fullName,
            email: email.trim().toLowerCase(),
            password,
            confirmPassword,
            tenant: {
              name: tenantName,
              address: tenantAddress || '-',
            },
          }),
        });
        return { data: res, error: null };
      } catch (err) {
        return { data: null, error: { message: err.message || 'Gagal mendaftar.' } };
      }
    },
    signOut: async () => {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      setSession(null);
    },
  }), [session, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
