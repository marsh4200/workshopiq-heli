import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  AppBar,
  Avatar,
  Badge,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import WorkIcon from '@mui/icons-material/Engineering';
import AddIcon from '@mui/icons-material/AddCircleOutline';
import PeopleIcon from '@mui/icons-material/GroupOutlined';
import ChecklistIcon from '@mui/icons-material/FactCheckOutlined';
import PrecisionManufacturingOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import QrCodeIcon from '@mui/icons-material/QrCode2';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import SettingsIcon from '@mui/icons-material/TuneOutlined';
import PaletteIcon from '@mui/icons-material/Brightness6Outlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import StorageIcon from '@mui/icons-material/Storage';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import ReportIcon from '@mui/icons-material/AssessmentOutlined';
import NCRIcon from '@mui/icons-material/ReportProblemOutlined';
import BorderColorOutlinedIcon from '@mui/icons-material/BorderColorOutlined';
import StarBorderIcon from '@mui/icons-material/StarBorderPurple500';
import LogoutIcon from '@mui/icons-material/Logout';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useThemeMode } from '../context/ThemeModeContext';
import { Logomark } from './common';
import { useDeviceType } from '../hooks/useDeviceType';
import ReviewNotifier from './ReviewNotifier';
import {
  getLicenseStatus,
  getPendingClientSignatures,
  getPendingClosures,
  getPendingReviews,
} from '../api/client';
import type { LicenseStatus } from '../types';
import { fontDisplay, fontMono } from '../theme/theme';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Same rounding convention as Settings.tsx's licensing panel: ceil so
// "expires later today" reads as 0 days left, and a date a few hours in
// the past still reads as clearly expired rather than "0 days left".
function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / MS_PER_DAY);
}

const DRAWER = 262;

interface NavItem {
  label: string;
  icon: ReactNode;
  path: string;
  roles?: string[];
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Workspace',
    items: [
      { label: 'Dashboard', icon: <DashboardIcon />, path: '/' },
      { label: 'Jobs', icon: <WorkIcon />, path: '/jobs' },
      { label: 'New Job', icon: <AddIcon />, path: '/jobs/new', roles: ['administrator', 'staff'] },
      { label: 'NCRs', icon: <NCRIcon />, path: '/ncrs', roles: ['administrator', 'staff'] },
      { label: 'Inspection Reports', icon: <QrCodeIcon />, path: '/inspection-reports', roles: ['administrator', 'staff', 'client'] },
      { label: 'Reports', icon: <ReportIcon />, path: '/reports', roles: ['administrator', 'staff'] },
      { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
      { label: 'Appearance', icon: <PaletteIcon />, path: '/appearance' },
    ],
  },
  {
    section: 'Administration',
    items: [
      { label: 'Closure Requests', icon: <GavelOutlinedIcon />, path: '/closure-requests', roles: ['administrator'] },
      { label: 'Inspection Templates', icon: <ChecklistIcon />, path: '/templates', roles: ['administrator'] },
      { label: 'Check-in Lists', icon: <PrecisionManufacturingOutlinedIcon />, path: '/checkin-lists', roles: ['administrator'] },
      { label: 'Users', icon: <PeopleIcon />, path: '/users', roles: ['administrator'] },
      { label: 'Samba', icon: <StorageIcon />, path: '/samba', roles: ['administrator'] },
      { label: 'Training', icon: <SchoolOutlinedIcon />, path: '/training', roles: ['administrator'] },
    ],
  },
];

// Clients get a simpler, action-first sidebar: their jobs, the two things that
// need them (with live badge counts), and their account. Kept separate from NAV
// so the staff/admin menu is untouched.
const CLIENT_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Your workshop',
    items: [{ label: 'My jobs', icon: <DashboardIcon />, path: '/' }],
  },
  {
    section: 'Needs you',
    items: [
      { label: 'Reports to sign', icon: <BorderColorOutlinedIcon />, path: '/inspection-reports' },
      { label: 'Jobs to review', icon: <StarBorderIcon />, path: '/reviews' },
    ],
  },
  {
    section: 'Account',
    items: [
      { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
      { label: 'Appearance', icon: <PaletteIcon />, path: '/appearance' },
    ],
  },
];

export default function Layout() {
  const { user, logout, isAdmin, isClient } = useAuth();
  const { settings } = useSettings();
  const { mode, setPreference } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useDeviceType().isMobile;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [denyMsg, setDenyMsg] = useState('');
  const [closureCount, setClosureCount] = useState(0);
  const [signCount, setSignCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  // Sidebar footer license badge. By the time Layout renders, App.tsx has
  // already gated the whole app on activation — so this is never "not
  // activated" in practice, just a status readout (and countdown, if the
  // license carries an expiry) rather than another gate. Refetched
  // occasionally, mainly so a renewed license's new expiry shows up without
  // needing a full reload.
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      getLicenseStatus()
        .then((s) => {
          if (!cancelled) setLicense(s);
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 5 * 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const poll = () => {
      getPendingClosures()
        .then((items) => {
          if (!cancelled) setClosureCount(items.length);
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isAdmin]);

  // Client sidebar badges: reports awaiting their signature and jobs awaiting
  // their review. Same polling shape as the admin closure badge above.
  useEffect(() => {
    if (!isClient) return;
    let cancelled = false;
    const poll = () => {
      getPendingClientSignatures()
        .then((items) => {
          if (!cancelled) setSignCount(items.length);
        })
        .catch(() => undefined);
      getPendingReviews()
        .then((items) => {
          if (!cancelled) setReviewCount(items.length);
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isClient]);
  // Soft refresh for the APK / installed app, where there's no browser reload.
  // Bumping this key remounts the routed page so its data re-fetches — no full
  // page reload, the session and bundle stay put.
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
    window.setTimeout(() => setRefreshing(false), 700);
  };

  const visible = (i: NavItem) => !i.roles || (user && i.roles.includes(user.role));

  const activeNav = isClient ? CLIENT_NAV : NAV;

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname === path;

  const pageTitle = useMemo(() => {
    const all = activeNav.flatMap((s) => s.items);
    if (location.pathname.startsWith('/jobs/') && location.pathname !== '/jobs/new') return 'Job Detail';
    return all.find((i) => isActive(i.path))?.label ?? 'WorkshopIQ';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isClient]);

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2.5, py: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Logomark size={40} />
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontFamily: fontDisplay, fontWeight: 700, lineHeight: 1.1 }}>
            {settings?.company_name || 'WorkshopIQ'}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {settings?.dashboard_branding || 'Workshop management'}
          </Typography>
        </Box>
      </Box>
      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1.5 }}>
        {activeNav.map((group) => {
          const items = group.items.filter(visible);
          if (!items.length) return null;
          return (
            <Box key={group.section} sx={{ mb: 1.5 }}>
              <Typography variant="overline" sx={{ px: 1.5, mb: 0.5, display: 'block' }}>
                {group.section}
              </Typography>
              <List disablePadding>
                {items.map((item) => {
                  const active = isActive(item.path);
                  return (
                    <ListItemButton
                      key={item.path}
                      onClick={() => {
                        navigate(item.path);
                        setMobileOpen(false);
                      }}
                      sx={{
                        position: 'relative',
                        mb: 0.25,
                        py: 0.9,
                        color: active ? 'text.primary' : 'text.secondary',
                        background: active ? 'rgba(59,130,246,0.12)' : 'transparent',
                        '&:hover': { background: active ? 'rgba(59,130,246,0.16)' : 'rgba(148,163,184,0.08)' },
                        '&::before': {
                          content: '""',
                          position: 'absolute',
                          left: 0,
                          top: 8,
                          bottom: 8,
                          width: 3,
                          borderRadius: 3,
                          background: active ? 'linear-gradient(#5b9bff,#2563eb)' : 'transparent',
                        },
                      }}
                    >
                      <ListItemIcon sx={{ color: active ? 'primary.main' : 'text.secondary', minWidth: 38 }}>
                        {(() => {
                          const badge =
                            item.path === '/closure-requests'
                              ? closureCount
                              : item.path === '/inspection-reports' && isClient
                                ? signCount
                                : item.path === '/reviews'
                                  ? reviewCount
                                  : 0;
                          const badgeColor = item.path === '/reviews' ? 'primary' : 'warning';
                          return badge > 0 ? (
                            <Badge badgeContent={badge} color={badgeColor}>
                              {item.icon}
                            </Badge>
                          ) : (
                            item.icon
                          );
                        })()}
                      </ListItemIcon>
                      <ListItemText
                        primaryTypographyProps={{ fontWeight: active ? 700 : 500, fontSize: 14 }}
                        primary={item.label}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          );
        })}
      </Box>

      <Divider />
      <Box sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontFamily: fontMono, fontSize: 11, color: 'text.disabled' }}>
            v{settings?.current_version || '1.0.0'}
          </Typography>
          {settings?.available_version && settings.available_version !== settings.current_version && (
            <Chip
              label="Update available"
              size="small"
              color="warning"
              variant="outlined"
              onClick={() => navigate('/settings')}
              sx={{ cursor: 'pointer', fontSize: 11 }}
            />
          )}
        </Box>
        {license?.activated &&
          (() => {
            const days = license.expires_at ? daysUntil(license.expires_at) : null;
            const expired = days !== null && days < 0;
            const expiringSoon = days !== null && !expired && days < 30;
            const label = expired
              ? 'License expired'
              : expiringSoon
              ? `Expires in ${days} day${days === 1 ? '' : 's'}`
              : 'License active';
            const tooltip = !license.expires_at
              ? 'Perpetual license — no expiry'
              : `${expired ? 'Expired' : 'Valid until'} ${new Date(
                  license.expires_at,
                ).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
            return (
              <Tooltip title={tooltip}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={expired ? 'error' : expiringSoon ? 'warning' : 'success'}
                  icon={expired ? <ErrorIcon /> : <CheckCircleIcon />}
                  label={label}
                  onClick={() => navigate('/settings')}
                  sx={{ mt: 1, cursor: 'pointer', fontSize: 11, height: 22 }}
                />
              </Tooltip>
            );
          })()}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1, boxShadow: 'none' }}>
        <Toolbar sx={{ gap: 1 }}>
          {isMobile && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography
            noWrap
            sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em', minWidth: 0 }}
          >
            {pageTitle}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {isMobile && (
            <Tooltip title="Refresh">
              <IconButton color="inherit" onClick={handleRefresh} sx={{ mr: 0.5 }}>
                <RefreshIcon
                  sx={{
                    animation: refreshing ? 'wiq-spin 0.7s linear' : 'none',
                    '@keyframes wiq-spin': {
                      from: { transform: 'rotate(0deg)' },
                      to: { transform: 'rotate(360deg)' },
                    },
                  }}
                />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton
              color="inherit"
              onClick={() => setPreference(mode === 'dark' ? 'light' : 'dark')}
              sx={{ mr: 0.5 }}
            >
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>
          <Box sx={{ textAlign: 'right', mr: 0.5, display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.1 }}>
              {user?.full_name || user?.username}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
              {user?.role}
            </Typography>
          </Box>
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ p: 0.5 }}>
            <Avatar sx={{ width: 36, height: 36, bgcolor: 'transparent', background: 'linear-gradient(150deg,#5b9bff,#2563eb)', fontSize: 15, fontWeight: 700 }}>
              {(user?.full_name || user?.username || '?').charAt(0).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu
            anchorEl={anchor}
            open={Boolean(anchor)}
            onClose={() => setAnchor(null)}
            transformOrigin={{ horizontal: 'right', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            slotProps={{ paper: { sx: { minWidth: 200, mt: 1 } } }}
          >
            <Box sx={{ px: 2, py: 1.25 }}>
              <Typography sx={{ fontWeight: 700 }}>{user?.full_name || user?.username}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                {user?.role}
              </Typography>
            </Box>
            <Divider />
            <MenuItem
              onClick={() => {
                setAnchor(null);
                if (!isAdmin) {
                  setDenyMsg('Please contact your system administrator.');
                  return;
                }
                navigate('/change-password');
              }}
            >
              <KeyIcon fontSize="small" sx={{ mr: 1.5 }} /> Change password
            </MenuItem>
            <MenuItem onClick={logout}>
              <LogoutIcon fontSize="small" sx={{ mr: 1.5 }} /> Log out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={isMobile ? 'temporary' : 'permanent'}
          open={isMobile ? mobileOpen : true}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: DRAWER,
              boxSizing: 'border-box',
              backgroundColor: (t) => t.palette.sidebar,
              backgroundImage: 'none',
              borderRight: (t) => `1px solid ${t.palette.divider}`,
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          // A flex child's min-width defaults to its content width — one wide
          // table and the whole page gains a sideways scroll on phones.
          // minWidth: 0 lets this column shrink to the viewport and keeps
          // overflow contained inside the cards instead.
          minWidth: 0,
          maxWidth: '100%',
          overflowX: 'hidden',
          width: { md: `calc(100% - ${DRAWER}px)` },
          px: { xs: 2, md: 3.5 },
          pt: { xs: 2, md: 3.5 },
          // Extra bottom room so the last card clears the screen edge in the
          // installed app (no browser chrome to scroll past).
          pb: { xs: 6, md: 4 },
        }}
      >
        <Toolbar />
        <Box key={refreshKey}>
          <ReviewNotifier />
          <Outlet />
        </Box>
      </Box>

      <Snackbar
        open={!!denyMsg}
        autoHideDuration={5000}
        onClose={() => setDenyMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" variant="filled" onClose={() => setDenyMsg('')} sx={{ fontWeight: 600 }}>
          {denyMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
