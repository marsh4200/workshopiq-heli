import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { buildTheme, type ThemeMode } from '../theme/theme';
import { updatePreferences } from '../api/client';
import { useAuth } from './AuthContext';

// What the user picks. "system" follows the device's OS light/dark setting.
export type ThemePreference = 'light' | 'dark' | 'system';

const CACHE_KEY = 'wiq_theme'; // fast paint cache; the DB is the source of truth.

interface ThemeModeCtx {
  preference: ThemePreference; // what the user chose
  mode: ThemeMode; // the resolved light/dark actually applied
  setPreference: (p: ThemePreference) => void;
  saving: boolean;
}

const Ctx = createContext<ThemeModeCtx>({
  preference: 'dark',
  mode: 'dark',
  setPreference: () => {},
  saving: false,
});

function systemMode(): ThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function readCache(): ThemePreference {
  const v = localStorage.getItem(CACHE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // Start from the cached choice so there's no flash before /me resolves.
  const [preference, setPreferenceState] = useState<ThemePreference>(readCache);
  const [sysMode, setSysMode] = useState<ThemeMode>(systemMode);
  const [saving, setSaving] = useState(false);

  // Adopt the signed-in user's stored preference whenever it loads/changes.
  useEffect(() => {
    const pref = user?.theme_preference;
    if (pref === 'light' || pref === 'dark' || pref === 'system') {
      setPreferenceState(pref);
      localStorage.setItem(CACHE_KEY, pref);
    }
  }, [user?.theme_preference]);

  // Keep "system" live if the OS theme changes while the app is open.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSysMode(mq.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const setPreference = useCallback(
    (p: ThemePreference) => {
      setPreferenceState(p);
      localStorage.setItem(CACHE_KEY, p);
      // Persist to the user's account so it follows them to every device.
      if (user) {
        setSaving(true);
        updatePreferences(p)
          .catch(() => {
            /* offline / transient — the cached choice still applies locally */
          })
          .finally(() => setSaving(false));
      }
    },
    [user],
  );

  const mode: ThemeMode = preference === 'system' ? sysMode : preference;
  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <Ctx.Provider value={{ preference, mode, setPreference, saving }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useThemeMode() {
  return useContext(Ctx);
}
