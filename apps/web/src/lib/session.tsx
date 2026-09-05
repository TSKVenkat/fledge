/**
 * The only global state in the application.
 *
 * Everything else is loaded in the page that needs it, which is what a product
 * this size actually calls for.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, type User } from './api.ts';

interface Session {
  user: User | null;
  loading: boolean;
  signIn(identifier: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser((await api.me()).user);
    } catch (error) {
      // 401 is the ordinary answer for a visitor, not a failure worth showing.
      if (!(error instanceof ApiError) || error.status !== 401) console.error(error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<Session>(() => ({
    user, loading, refresh,
    signIn: async (identifier, password) => { setUser((await api.login(identifier, password)).user); },
    signOut: async () => { await api.logout(); setUser(null); },
  }), [user, loading, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside a SessionProvider.');
  return session;
}
