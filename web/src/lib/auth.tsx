import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setCsrf } from './api';

export interface Me {
  user: { id: string; username: string; name: string; role: 'ADMIN' | 'SELLER'; mustChangePassword: boolean };
  rep: null | {
    id: string;
    fullName: string;
    title: string;
    maxDiscountBps: number;
    canViewAllOrders: boolean;
    canViewCost: boolean;
    canViewClientTotals: boolean;
    canViewFinanceContact: boolean;
    phone: string | null;
    contactPhone: string | null;
  };
  csrfToken: string;
  company: { name: string; timezone: string; hasLogo: boolean };
}

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  setMe: (me: Me) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const setMe = useCallback((m: Me | null) => {
    setCsrf(m?.csrfToken);
    setMeState(m);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, [setMe]);

  useEffect(() => {
    void refresh();
    const onUnauth = () => setMe(null);
    const onPwd = () => void refresh();
    window.addEventListener('della:unauthorized', onUnauth);
    window.addEventListener('della:password-change', onPwd);
    return () => {
      window.removeEventListener('della:unauthorized', onUnauth);
      window.removeEventListener('della:password-change', onPwd);
    };
  }, [refresh, setMe]);

  const login = useCallback(
    async (username: string, password: string) => {
      const m = await api<Me>('/auth/login', { body: { username, password } });
      setMe(m);
      return m;
    },
    [setMe],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setMe(null);
      sessionStorage.clear();
    }
  }, [setMe]);

  return <Ctx.Provider value={{ me, loading, login, logout, setMe, refresh }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
