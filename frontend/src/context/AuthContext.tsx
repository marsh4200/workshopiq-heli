import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as apiClient from '../api/client';
import { getToken, setToken, clearToken } from '../api/token';
import type { User } from '../types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (u: string, p: string, remember?: boolean) => Promise<{ must_change_password: boolean }>;
  logout: () => void;
  refresh: () => Promise<void>;
  isAdmin: boolean;
  isStaff: boolean;
  isClient: boolean;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await apiClient.fetchMe());
    } catch {
      clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const login = async (username: string, password: string, remember = true) => {
    const res = await apiClient.login(username, password);
    setToken(res.access_token, remember);
    await refresh();
    return { must_change_password: res.must_change_password };
  };

  const logout = () => {
    clearToken();
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refresh,
        isAdmin: user?.role === 'administrator',
        isStaff: user?.role === 'administrator' || user?.role === 'staff',
        isClient: user?.role === 'client',
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
