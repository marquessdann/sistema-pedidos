import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, setApiScope, setCsrf } from './api';
import { setOfflineUser } from './offline';

/** Vendedor: guarda o usuário no aparelho para abrir o sistema sem internet. */
const ME_KEY = 'della:me';
function readCachedMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}
function writeCachedMe(m: Me | null) {
  try {
    if (m && m.user.role === 'SELLER' && !m.user.mustChangePassword) localStorage.setItem(ME_KEY, JSON.stringify(m));
    else localStorage.removeItem(ME_KEY);
  } catch {
    /* ignore */
  }
}

export interface Me {
  user: { id: string; username: string; name: string; role: 'ADMIN' | 'MANAGER' | 'SELLER' | 'LOGISTICS'; mustChangePassword: boolean };
  manager: null | { perms: ManagerPerms; repIds: string[] };
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

export interface ManagerPerms {
  canViewSales: boolean;
  canViewCommissions: boolean;
  canReleaseProducts: boolean;
  canReleaseClients: boolean;
  canApproveDiscounts: boolean;
  canUpdateOrderStatus: boolean;
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
    setApiScope(m?.user.role === 'MANAGER' ? 'manager' : 'admin');
    setOfflineUser(m?.user.role === 'SELLER' ? m.user.id : null);
    writeCachedMe(m);
    setMeState(m);
  }, []);

  const refresh = useCallback(async () => {
    const cached = readCachedMe();
    try {
      setMe(await api<Me>('/auth/me', cached ? { timeoutMs: 8000 } : {}));
    } catch (e) {
      // sem internet: o vendedor continua trabalhando com os dados guardados no aparelho
      if (cached && e instanceof ApiError && e.status === 0) {
        setCsrf(cached.csrfToken);
        setApiScope('admin');
        setOfflineUser(cached.user.id);
        setMeState(cached);
      } else setMe(null);
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

/** Atalhos de perfil: administrador total, gestor (com permissões) ou vendedor. */
export function useRole() {
  const { me } = useAuth();
  const role = me?.user.role;
  const perms = me?.manager?.perms;
  const isAdmin = role === 'ADMIN';
  const isManager = role === 'MANAGER';
  return {
    isAdmin,
    isManager,
    /** administrador sempre pode; gestor somente se a permissão estiver marcada */
    can: (p: keyof ManagerPerms) => isAdmin || (isManager && !!perms?.[p]),
  };
}
