import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getSettings } from '../api/client';
import { useAuth } from './AuthContext';
import type { AppSettings } from '../types';

interface SettingsCtx {
  settings: AppSettings | null;
  reload: () => Promise<void>;
}

const Ctx = createContext<SettingsCtx>({ settings: null, reload: async () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const reload = async () => {
    try {
      setSettings(await getSettings());
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (user && !user.must_change_password) reload();
  }, [user]);

  useEffect(() => {
    if (settings?.company_name) document.title = `${settings.company_name}`;
  }, [settings]);

  return <Ctx.Provider value={{ settings, reload }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  return useContext(Ctx);
}
