import { useMediaQuery, useTheme } from '@mui/material';

/**
 * One source of truth for "what kind of screen are we on".
 *
 * Layout decisions should branch on viewport WIDTH (isMobile / isDesktop), not
 * on the actual device — a desktop window dragged narrow, a tablet, and a phone
 * should all behave the same when they have the same amount of space. The
 * breakpoints come from the MUI theme so the whole app stays consistent.
 *
 *   isMobile  — below the `md` breakpoint (default < 900px): phones, small
 *               tablets, and narrow desktop windows. The sidebar collapses to a
 *               hamburger and tables switch to cards.
 *   isDesktop — `md` and up (default >= 900px): permanent sidebar + tables.
 *   isTablet  — the typical tablet range (sm–lg); informational only.
 *   isTouch   — a coarse pointer (touchscreen). Use this to drive *behaviour*
 *               (bigger tap targets, camera, tap-to-dial), NOT layout.
 */
export interface DeviceType {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
}

export function useDeviceType(): DeviceType {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'lg'));
  const isTouch = useMediaQuery('(pointer: coarse)');
  return { isMobile, isTablet, isDesktop, isTouch };
}
