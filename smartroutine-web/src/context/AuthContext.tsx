import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { AuthSession } from '../lib/types';
import { SESSION_KEY } from '../lib/constants';
import {
  getStoreVault,
  loginWithStore,
  portalPath,
  sessionMatchesStore,
} from '../lib/store';
import { api, clearToken, getToken, AUTH_REQUIRED_EVENT } from '../lib/api';
import { useData } from './DataContext';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthSession>;
  logout: () => void;
  updateSession: (patch: Partial<AuthSession>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const { mode, ready, refresh, applySessionScope } = useData();

  useEffect(() => {
    if (!ready) return;

    let cancelled = false;
    async function restore() {
      const saved = localStorage.getItem(SESSION_KEY);
      const parsed = saved ? (JSON.parse(saved) as AuthSession) : null;

      if (mode === 'api') {
        if (!getToken()) {
          localStorage.removeItem(SESSION_KEY);
          if (!cancelled) {
            setSession(null);
            applySessionScope(null);
          }
        } else {
          try {
            // Always refresh from the server so role fields like batchId stay current.
            const { session: remote } = await api.me();
            localStorage.setItem(SESSION_KEY, JSON.stringify(remote));
            if (!cancelled) {
              setSession(remote);
              applySessionScope(remote);
            }
          } catch {
            clearToken();
            localStorage.removeItem(SESSION_KEY);
            if (!cancelled) {
              setSession(null);
              applySessionScope(null);
            }
          }
        }
      } else {
        const vault = getStoreVault();
        if (parsed && vault && sessionMatchesStore(vault, parsed)) {
          if (!cancelled) {
            setSession(parsed);
            applySessionScope(parsed);
          }
        } else {
          localStorage.removeItem(SESSION_KEY);
          if (!cancelled) {
            setSession(null);
            applySessionScope(null);
          }
        }
      }

      if (!cancelled) setLoading(false);
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [ready, mode, applySessionScope]);

  // API restart / expired JWT → kick back to login instead of leaving a dead session.
  useEffect(() => {
    function onAuthRequired() {
      localStorage.removeItem(SESSION_KEY);
      clearToken();
      setSession(null);
      applySessionScope(null);
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, [applySessionScope]);

  const login = useCallback(
    async (username: string, password: string) => {
      let result: AuthSession | null = null;

      if (mode === 'api') {
        result = await api.login(username, password);
      } else {
        const vault = getStoreVault();
        if (!vault) throw new Error('Data not loaded');
        result = loginWithStore(vault, username, password);
      }

      if (!result) throw new Error('Invalid username or password');
      localStorage.setItem(SESSION_KEY, JSON.stringify(result));
      setSession(result);
      applySessionScope(result);
      if (mode === 'api') await refresh();
      return result;
    },
    [mode, refresh, applySessionScope],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    clearToken();
    setSession(null);
    applySessionScope(null);
    void refresh();
  }, [refresh, applySessionScope]);

  const updateSession = useCallback((patch: Partial<AuthSession>) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ session, loading, login, logout, updateSession }),
    [session, loading, login, logout, updateSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { portalPath };
