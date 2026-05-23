// Auth state — token + user profile (with roles + permissions).
//
// We keep the JWT in localStorage. Yes, that's vulnerable to XSS; for
// a hackathon demo it's the right trade-off. When we add SSO / refresh
// tokens (post-v1), we'll move to httpOnly cookies.
//
//   <AuthProvider>
//      <App />
//   </AuthProvider>
//
//   const { user, token, login, logout, refresh } = useAuth();

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface AuthRole {
  code: string;
  name: string;
}

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  locale: 'ru' | 'en' | 'uz';
  status: 'active' | 'blocked' | 'invited';
  roles: AuthRole[];
  permissions: Record<string, string[]>; // code -> scopes[]
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPerm: (code: string, scope?: 'own' | 'team' | 'org') => boolean;
}

const LS_TOKEN = 'feynmap.token.v1';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(LS_TOKEN));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState<boolean>(!!token);

  const refresh = useCallback(async () => {
    const t = localStorage.getItem(LS_TOKEN);
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const r = await fetch('/api/auth/me', {
        headers: { authorization: `Bearer ${t}` },
      });
      if (!r.ok) {
        // expired or invalid
        localStorage.removeItem(LS_TOKEN);
        setToken(null);
        setUser(null);
      } else {
        const j = await r.json();
        setUser(j.user as AuthUser);
      }
    } catch (e) {
      console.error('[auth/refresh]', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) refresh();
    else setLoading(false);
  }, [token, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || `login failed (${r.status})`);
    }
    const j = await r.json();
    localStorage.setItem(LS_TOKEN, j.token);
    setToken(j.token);
    setUser(j.user as AuthUser);
  }, []);

  const logout = useCallback(async () => {
    const t = localStorage.getItem(LS_TOKEN);
    if (t) {
      // best effort — audit log entry
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { authorization: `Bearer ${t}` },
        });
      } catch {}
    }
    localStorage.removeItem(LS_TOKEN);
    setToken(null);
    setUser(null);
  }, []);

  const hasPerm = useCallback(
    (code: string, scope: 'own' | 'team' | 'org' = 'org') => {
      if (!user) return false;
      const have = user.permissions?.[code];
      if (!have || have.length === 0) return false;
      const tier: Record<string, number> = { own: 0, team: 1, org: 2 };
      const need = tier[scope];
      return have.some((s) => (tier[s] ?? -1) >= need);
    },
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, logout, refresh, hasPerm }),
    [user, token, loading, login, logout, refresh, hasPerm],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Fetch helper that attaches Bearer auth and parses JSON. Throws on !ok. */
export async function adminFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const t = localStorage.getItem(LS_TOKEN);
  const headers = new Headers(init.headers || {});
  if (t) headers.set('authorization', `Bearer ${t}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const r = await fetch(`/api${path}`, { ...init, headers });
  if (!r.ok) {
    const txt = await r.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(txt);
    } catch {}
    throw new Error(parsed?.error || `${path} failed (${r.status})`);
  }
  return (await r.json()) as T;
}
