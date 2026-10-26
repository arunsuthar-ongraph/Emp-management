import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { api, get } from './api';

export interface Me {
  id: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  permissions: string[];
  isLead: boolean; // reporting manager or department head
  tenant: { id: string; name: string; slug: string; state: string } | null;
  employee: { id: string; code: string; name: string; designation?: string; department?: string } | null;
}

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  can: (perm: string) => boolean;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!localStorage.getItem('token'));

  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    get<Me>('/auth/me')
      .then(setUser)
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false));
  }, []);

  const accept = (data: { token: string; user: Me }) => {
    localStorage.setItem('token', data.token);
    setUser(data.user);
  };

  const value: AuthCtx = {
    user,
    loading,
    login: async (email, password) => accept((await api.post('/auth/login', { email, password })).data),
    refresh: async () => setUser(await get<Me>('/auth/me')),
    logout: () => {
      localStorage.removeItem('token');
      setUser(null);
      window.location.href = '/login';
    },
    can: (perm) => !!user?.permissions.includes(perm),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
