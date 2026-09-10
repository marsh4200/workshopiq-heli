import { Avatar, Box, Chip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import LockIcon from '@mui/icons-material/Lock';
import type { ReactNode } from 'react';
import { fontDisplay, fontMono } from '../theme/theme';
import { useSettings } from '../context/SettingsContext';

export const STATUS_COLORS: Record<string, string> = {
  Received: '#94a3b8',
  Inspection: '#38bdf8',
  'Inspection Failed': '#f43f5e',
  Quotation: '#a855f7',
  'Awaiting Approval': '#f59e0b',
  'In Production': '#3b82f6',
  Machining: '#6366f1',
  Assembly: '#14b8a6',
  'Quality Control': '#eab308',
  Completed: '#22c55e',
  'Awaiting Customer Review': '#f59e0b',
  Collected: '#10b981',
  Closed: '#64748b',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#94a3b8';
  return (
    <Chip
      label={status}
      size="small"
      icon={
        <Box
          component="span"
          sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, ml: '4px !important', flexShrink: 0 }}
        />
      }
      sx={{
        bgcolor: `${color}17`,
        color,
        border: `1px solid ${color}38`,
        fontWeight: 600,
        letterSpacing: '0.01em',
        '& .MuiChip-label': { px: 0.9 },
      }}
    />
  );
}

// Relative luminance of a #rrggbb colour — used to pick white vs dark text
// so the solid status banner stays readable on light colours (yellow, amber…).
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.substring(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// Big, solid status banner for the job header — far more visible than the
// small chip, so the current stage reads at a glance.
export function StatusBanner({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || '#94a3b8';
  const onColor = hexLuminance(color) > 0.5 ? '#0f172a' : '#ffffff';
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        bgcolor: color,
        color: onColor,
        px: { xs: 1.75, sm: 2.25 },
        py: { xs: 0.75, sm: 1 },
        borderRadius: 2,
        fontWeight: 800,
        fontSize: { xs: '0.95rem', sm: '1.05rem' },
        letterSpacing: 0.3,
        lineHeight: 1.1,
        boxShadow: `0 2px 12px ${color}55`,
        whiteSpace: 'nowrap',
      }}
    >
      <Box
        component="span"
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: onColor,
          opacity: 0.9,
          flexShrink: 0,
        }}
      />
      {status}
    </Box>
  );
}

// Full-width "CLOSED" banner for the job overview. Sits above the detail cards
// so a finished job reads unmistakably at a glance, without sitting on top of
// any of the text. Only render this when the job is actually closed.
export function ClosedBanner() {
  const color = STATUS_COLORS['Closed'];
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        width: '100%',
        px: { xs: 2, sm: 2.5 },
        py: { xs: 1.25, sm: 1.5 },
        borderRadius: 2,
        color: '#fff',
        background: `linear-gradient(135deg, ${color} 0%, #475569 100%)`,
        border: `1px solid ${color}`,
        boxShadow: `0 2px 14px ${color}66`,
      }}
    >
      <LockIcon sx={{ fontSize: { xs: 22, sm: 26 } }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 800, letterSpacing: 1, lineHeight: 1.1, fontSize: { xs: '1rem', sm: '1.15rem' } }}>
          JOB CLOSED
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.85 }}>
          This job has been closed.
        </Typography>
      </Box>
    </Box>
  );
}

const RESULT_COLORS: Record<string, string> = {
  pass: '#22c55e',
  fail: '#f43f5e',
  na: '#64748b',
};
export function ResultBadge({ result }: { result?: string | null }) {
  if (!result) return <Chip label="Pending" size="small" variant="outlined" />;
  const color = RESULT_COLORS[result] || '#64748b';
  const label = result === 'na' ? 'N/A' : result.charAt(0).toUpperCase() + result.slice(1);
  return (
    <Chip
      label={label}
      size="small"
      sx={{ bgcolor: `${color}1f`, color, border: `1px solid ${color}3d`, fontWeight: 700 }}
    />
  );
}

export const fmtDate = (s?: string | null) =>
  s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const fmtDay = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

/** Parse a plain YYYY-MM-DD string as a *local* date (no TZ day-shift). */
const parseLocalDate = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export type DueState = 'overdue' | 'today' | 'soon' | 'normal' | 'none';

export interface DueInfo {
  state: DueState;
  days: number; // signed: negative = overdue, 0 = today, positive = days remaining
  label: string; // formatted date, e.g. "20 Jun 2026"
  chip: string | null; // short urgency label, or null when not urgent
  color: 'error' | 'warning' | 'default';
}

/**
 * Due-date status used for the date chips/colours. Passing `done = true`
 * (Completed/Closed jobs) suppresses the urgency chip — the work is finished,
 * so a past due date is no longer a problem.
 */
export function dueInfo(due?: string | null, done = false): DueInfo {
  if (!due) return { state: 'none', days: 0, label: '—', chip: null, color: 'default' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = parseLocalDate(due);
  target.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  const label = target.toLocaleDateString(undefined, { dateStyle: 'medium' });
  if (done) return { state: 'normal', days, label, chip: null, color: 'default' };
  if (days < 0)
    return { state: 'overdue', days, label, chip: `Overdue ${Math.abs(days)}d`, color: 'error' };
  if (days === 0) return { state: 'today', days, label, chip: 'Due today', color: 'warning' };
  if (days <= 3) return { state: 'soon', days, label, chip: `Due in ${days}d`, color: 'warning' };
  return { state: 'normal', days, label, chip: null, color: 'default' };
}

/** Monospace serial/job number — the design signature. */
export function Serial({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Box
      component="span"
      sx={{ fontFamily: fontMono, fontWeight: 600, letterSpacing: '0.01em', ...sx }}
    >
      {children}
    </Box>
  );
}

/** The WorkshopIQ brand mark — uses the company logo when configured. */
export function Logomark({ size = 38 }: { size?: number }) {
  const { settings } = useSettings();
  if (settings?.company_logo) {
    return (
      <Avatar
        src={`/api/settings/logo/${settings.company_logo}`}
        variant="rounded"
        sx={{ width: size, height: size, borderRadius: size / 4 }}
      />
    );
  }
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: `${size / 4}px`,
        display: 'grid',
        placeItems: 'center',
        fontFamily: fontDisplay,
        fontWeight: 700,
        fontSize: size * 0.5,
        color: '#06121f',
        background: 'linear-gradient(150deg,#5b9bff,#2563eb)',
        boxShadow: '0 4px 14px rgba(37,99,235,0.4), inset 0 1px 0 rgba(255,255,255,0.35)',
      }}
    >
      W
    </Box>
  );
}

/** Consistent page heading with an eyebrow label and optional actions. */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Box
      sx={{
        mb: 3,
        display: 'flex',
        alignItems: { sm: 'flex-end' },
        flexDirection: { xs: 'column', sm: 'row' },
        gap: 2,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <Typography variant="overline" sx={{ display: 'block', color: 'primary.main' }}>
            {eyebrow}
          </Typography>
        )}
        <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {actions && <Box sx={{ flexShrink: 0, display: 'flex', gap: 1 }}>{actions}</Box>}
    </Box>
  );
}

/**
 * "Nothing here yet" placeholder used across every list/tab in the app.
 * The icon sits inside a soft tinted badge (rather than floating bare) so
 * an empty screen still reads as designed, not broken — with an optional
 * action for the handful of places that don't already have a CTA nearby.
 */
export function EmptyState({
  icon,
  title,
  subtitle,
  action,
  tone = 'primary',
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  tone?: 'primary' | 'neutral';
}) {
  const tintColor = tone === 'primary' ? 'primary.main' : 'text.secondary';
  return (
    <Box sx={{ textAlign: 'center', py: { xs: 5, sm: 6.5 }, px: 2 }}>
      {icon && (
        <Box
          sx={{
            width: 68,
            height: 68,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            mx: 'auto',
            mb: 2,
            color: tintColor,
            bgcolor: (t) =>
              tone === 'primary' ? alpha(t.palette.primary.main, 0.1) : alpha('#94a3b8', 0.08),
            border: (t) =>
              `1px solid ${alpha(tone === 'primary' ? t.palette.primary.main : '#94a3b8', 0.22)}`,
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5, maxWidth: 400, mx: 'auto' }}
        >
          {subtitle}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2.5, display: 'flex', justifyContent: 'center' }}>{action}</Box>}
    </Box>
  );
}

/**
 * Small icon-in-a-chip badge + title (+ optional description/action) used to
 * head up a card section — gives Settings/Templates-style stacks of cards a
 * consistent, scannable rhythm instead of same-weight bare headings.
 */
export function SectionHeader({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: subtitle ? 2 : 1.5 }}>
      {icon && (
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '10px',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            color: 'primary.main',
            bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
            '& svg': { fontSize: 19 },
          }}
        >
          {icon}
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h6" sx={{ lineHeight: 1.25 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Box>
  );
}
