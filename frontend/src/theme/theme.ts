import { createTheme, alpha, type Theme } from '@mui/material/styles';

/**
 * WorkshopIQ design language.
 *
 * Grounded in the subject: a precision engineering workshop. The interface
 * should read like instrument software — disciplined, legible, trustworthy.
 * Signature device: job/serial numbers and key metrics set in a monospace
 * "spec sheet" face, because in a workshop the numbers ARE the identifiers.
 *
 * The palette now ships in two finishes — a deep-graphite dark mode (the
 * original signature look) and a clean daylight light mode. Both are built by
 * the same `buildTheme(mode)` factory so every component stays consistent.
 * Each signed-in user picks their own finish; the choice is stored per-user.
 */

export type ThemeMode = 'light' | 'dark';

// Allow a couple of custom palette tokens (used by the sidebar + page chrome).
declare module '@mui/material/styles' {
  interface Palette {
    sidebar: string;
    sidebarLine: string;
  }
  interface PaletteOptions {
    sidebar?: string;
    sidebarLine?: string;
  }
}

// Font stacks (loaded via index.html, with robust system fallbacks for offline use).
export const fontDisplay =
  "'Space Grotesk', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const fontBody =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const fontMono =
  "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace";

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

// Dark — deep graphite base with a confident engineering blue (original look).
const dark = {
  bg: '#0a0e16',
  bgElevated: '#0e1422',
  surface: '#131b2c',
  sidebar: '#0c1220',
  line: 'rgba(148,163,184,0.12)',
  lineStrong: 'rgba(148,163,184,0.20)',
  primary: '#3b82f6',
  primaryDark: '#2563eb',
  accent: '#f59e0b',
  textPrimary: '#e8edf6',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  inputBg: alpha('#0a0e16', 0.5),
  scrollThumb: '#283656',
  bodyGradient:
    'radial-gradient(1100px 760px at 88% -12%, rgba(37, 99, 235, 0.16) 0%, transparent 60%),' +
    'radial-gradient(900px 640px at -8% 8%, rgba(34, 211, 238, 0.08) 0%, transparent 55%)',
};

// Light — cool daylight off-white, same engineering blue, fully legible.
const light = {
  bg: '#eef2f8',
  bgElevated: '#ffffff',
  surface: '#ffffff',
  sidebar: '#ffffff',
  line: 'rgba(15,23,42,0.10)',
  lineStrong: 'rgba(15,23,42,0.18)',
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  accent: '#d97706',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#64748b',
  inputBg: '#ffffff',
  scrollThumb: '#c2ccda',
  bodyGradient:
    'radial-gradient(1100px 760px at 88% -12%, rgba(37, 99, 235, 0.10) 0%, transparent 60%),' +
    'radial-gradient(900px 640px at -8% 8%, rgba(34, 211, 238, 0.07) 0%, transparent 55%)',
};

// Back-compat export: the original `palette` constant referenced the dark set.
export const palette = dark;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function buildTheme(mode: ThemeMode): Theme {
  const p = mode === 'dark' ? dark : light;

  return createTheme({
    palette: {
      mode,
      primary: { main: p.primary, dark: p.primaryDark },
      secondary: { main: mode === 'dark' ? '#22d3ee' : '#0891b2' },
      success: { main: mode === 'dark' ? '#22c55e' : '#16a34a' },
      warning: { main: p.accent },
      error: { main: mode === 'dark' ? '#f43f5e' : '#e11d48' },
      info: { main: mode === 'dark' ? '#38bdf8' : '#0284c7' },
      background: { default: p.bg, paper: p.surface },
      text: { primary: p.textPrimary, secondary: p.textSecondary },
      divider: p.line,
      sidebar: p.sidebar,
      sidebarLine: p.line,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: fontBody,
      h3: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.02em' },
      h4: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.02em' },
      h5: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.01em' },
      h6: { fontFamily: fontDisplay, fontWeight: 600, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600, letterSpacing: '0.01em' },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
      overline: {
        fontWeight: 600,
        letterSpacing: '0.14em',
        fontSize: 11,
        color: p.textMuted,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': { colorScheme: mode },
          '*::selection': { background: alpha(p.primary, 0.32) },
          body: {
            backgroundColor: p.bg,
            backgroundImage: p.bodyGradient,
            backgroundAttachment: 'fixed',
            transition: 'background-color .25s ease',
          },
          '::-webkit-scrollbar-thumb': {
            background: p.scrollThumb,
            borderRadius: 8,
            border: '2px solid transparent',
            backgroundClip: 'content-box',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: p.surface,
            border: `1px solid ${p.line}`,
          },
          outlined: { borderColor: p.line },
        },
      },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: p.surface,
            backgroundImage:
              mode === 'dark'
                ? `linear-gradient(180deg, ${alpha('#1e2a47', 0.35)}, ${alpha('#0e1422', 0.0)})`
                : 'none',
            border: `1px solid ${p.line}`,
            borderRadius: 14,
            boxShadow:
              mode === 'dark'
                ? `0 1px 0 ${alpha('#fff', 0.03)} inset, 0 10px 24px -18px ${alpha('#000', 0.7)}`
                : `0 1px 0 ${alpha('#fff', 0.6)} inset, 0 10px 24px -18px ${alpha('#0f172a', 0.18)}`,
            transition: 'border-color .18s ease, transform .18s ease, box-shadow .18s ease',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 10,
            paddingInline: 18,
            transition: 'all .16s ease',
          },
          containedPrimary: {
            background: `linear-gradient(180deg, ${p.primary}, ${p.primaryDark})`,
            boxShadow: `0 1px 0 ${alpha('#fff', 0.12)} inset, 0 6px 18px ${alpha(p.primaryDark, 0.35)}`,
            '&:hover': {
              background: `linear-gradient(180deg, ${alpha(p.primary, 0.9)}, ${p.primary})`,
              boxShadow: `0 1px 0 ${alpha('#fff', 0.16)} inset, 0 8px 22px ${alpha(p.primaryDark, 0.5)}`,
            },
          },
          outlined: {
            borderColor: p.lineStrong,
            '&:hover': { borderColor: alpha(p.primary, 0.6), background: alpha(p.primary, 0.06) },
          },
        },
      },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: p.inputBg,
            borderRadius: 10,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: p.line },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: p.lineStrong },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: p.primary,
              borderWidth: 1.5,
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 600, borderRadius: 8 },
          sizeSmall: { height: 23 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: mode === 'dark' ? '#1e293b' : '#0f172a',
            border: `1px solid ${p.line}`,
            fontSize: 12,
            fontWeight: 500,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: p.line },
          head: {
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: p.textMuted,
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: mode === 'dark' ? alpha('#0a0e16', 0.72) : alpha('#ffffff', 0.82),
            backdropFilter: 'blur(12px)',
            color: p.textPrimary,
            borderBottom: `1px solid ${p.line}`,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: 14, border: `1px solid ${p.line}` },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&.MuiTableRow-hover:hover': {
              backgroundColor: alpha(p.primary, mode === 'dark' ? 0.07 : 0.05),
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
    },
  });
}

// Default export keeps the original signature dark theme for any code that
// imports `theme` directly (and as the pre-auth fallback).
export const theme = buildTheme('dark');
