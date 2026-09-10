import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import UploadIcon from '@mui/icons-material/Upload';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import BuildIcon from '@mui/icons-material/Build';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import StorefrontOutlinedIcon from '@mui/icons-material/StorefrontOutlined';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import SendIcon from '@mui/icons-material/Send';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import SettingsBackupRestoreOutlinedIcon from '@mui/icons-material/SettingsBackupRestoreOutlined';
import AndroidIcon from '@mui/icons-material/Android';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import AllInclusiveIcon from '@mui/icons-material/AllInclusive';
import type { ReactNode } from 'react';
import { SectionHeader } from '../components/common';
import {
  getSettings,
  updateSettings,
  uploadLogo,
  checkUpdates,
  applyUpdate,
  getUpdateStatus,
  sendTestEmail,
  getLicenseStatus,
  apiError,
} from '../api/client';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import UpdateProgressDialog from '../components/UpdateProgressDialog';
import BackupRestore from '../components/BackupRestore';
import AppDownload from '../components/AppDownload';
import type { AppSettings, LicenseStatus } from '../types';

const NO_RIGHTS_MSG =
  'Unfortunately, you do not have these rights. Please contact your system administrator.';

function Section({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <SectionHeader icon={icon} title={title} subtitle={subtitle} />
        <Box>{children}</Box>
      </CardContent>
    </Card>
  );
}

type SettingsSection =
  | 'branding'
  | 'email'
  | 'notifications'
  | 'updates'
  | 'backup'
  | 'android'
  | 'licensing';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysUntil(isoDate: string): number {
  // Ceil so "expires later today" reads as 0 days left rather than -0/1
  // depending on time-of-day, and a date a few hours in the past still
  // reads as clearly expired rather than "0 days left".
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / MS_PER_DAY);
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

function Tile({
  icon,
  title,
  subtitle,
  badge,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <Grid item xs={12} sm={6}>
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardActionArea onClick={onClick} sx={{ height: '100%', p: 0.5 }}>
          <CardContent sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.75 }}>
            <Box
              sx={{
                display: 'grid',
                placeItems: 'center',
                width: 44,
                height: 44,
                borderRadius: 2,
                flexShrink: 0,
                bgcolor: 'action.hover',
                color: 'primary.main',
              }}
            >
              {icon}
            </Box>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography fontWeight={700}>{title}</Typography>
                {badge}
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                {subtitle}
              </Typography>
            </Box>
            <ChevronRightIcon sx={{ color: 'text.disabled', flexShrink: 0, mt: 0.5 }} />
          </CardContent>
        </CardActionArea>
      </Card>
    </Grid>
  );
}

export default function Settings() {
  const { reload } = useSettings();
  const { isAdmin } = useAuth();
  const [section, setSection] = useState<SettingsSection | null>(null);
  const [s, setS] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [updateNote, setUpdateNote] = useState<
    { severity: 'success' | 'info' | 'error'; text: string } | null
  >(null);
  const logoInput = useRef<HTMLInputElement>(null);
  // SMTP password is write-only — the backend never echoes it back (only
  // whether one is stored, via email_password_set). Left blank, the existing
  // stored password is kept as-is.
  const [emailPassword, setEmailPassword] = useState('');
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<
    { success: boolean; text: string } | null
  >(null);
  // Hidden maintenance controls — revealed by tapping the faint "· · ·" at the
  // very bottom of the page (admins only). Auto-revealed while active so the
  // off switch can never be lost.
  const [showMaint, setShowMaint] = useState(false);
  const [maintBusy, setMaintBusy] = useState(false);
  // Second hidden control, tucked *inside* the maintenance card — revealed by
  // tapping the faint "· · ·" at the bottom of that card. Turns the server into
  // an admin-only lockout that tells staff/clients it has been shut down.
  // Auto-revealed while active so the off switch can never be lost.
  const [showShutdown, setShowShutdown] = useState(false);
  const [shutdownBusy, setShutdownBusy] = useState(false);

  const toggleMaintenance = async (on: boolean) => {
    setMaintBusy(true);
    setError('');
    setMsg('');
    try {
      const updated = await updateSettings({ maintenance_mode: on });
      setS(updated);
      setMsg(
        on
          ? 'Maintenance mode is ON — staff and clients are now locked out.'
          : 'Maintenance mode is OFF — normal access restored.',
      );
    } catch (e) {
      setError(apiError(e, 'Failed to change maintenance mode'));
    } finally {
      setMaintBusy(false);
    }
  };

  const toggleShutdown = async (on: boolean) => {
    setShutdownBusy(true);
    setError('');
    setMsg('');
    try {
      const updated = await updateSettings({ server_shutdown: on });
      setS(updated);
      setMsg(
        on
          ? 'Server shutdown is ON — only administrators can sign in. Everyone else is told the server has been shut down.'
          : 'Server shutdown is OFF — normal access restored.',
      );
    } catch (e) {
      setError(apiError(e, 'Failed to change server shutdown'));
    } finally {
      setShutdownBusy(false);
    }
  };

  const load = () =>
    getSettings()
      .then(setS)
      .catch((e) => setError(apiError(e, 'Failed to load settings')));

  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licenseError, setLicenseError] = useState('');
  const loadLicense = () =>
    getLicenseStatus()
      .then(setLicense)
      .catch((e) => setLicenseError(apiError(e, 'Failed to load license status')));

  useEffect(() => {
    load();
    loadLicense();
  }, []);

  const set = (k: keyof AppSettings, v: string) =>
    setS((prev) => (prev ? { ...prev, [k]: v } : prev));

  const save = async () => {
    if (!s) return;
    setSaving(true);
    setError('');
    setMsg('');
    try {
      const body: Record<string, unknown> = {
        company_name: s.company_name,
        dashboard_branding: s.dashboard_branding,
        job_number_prefix: s.job_number_prefix,
        email_host: s.email_host,
        email_port: s.email_port,
        email_user: s.email_user,
        email_from: s.email_from,
        whatsapp_country_code: s.whatsapp_country_code,
        github_repo_url: s.github_repo_url,
      };
      if (emailPassword.trim()) {
        body.email_password = emailPassword.trim();
      }
      const updated = await updateSettings(body);
      setS(updated);
      setEmailPassword('');
      setMsg('Settings saved.');
      reload();
    } catch (e) {
      setError(apiError(e, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const onLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const updated = await uploadLogo(file);
      setS(updated);
      setMsg('Logo uploaded.');
      reload();
    } catch (err) {
      setError(apiError(err, 'Failed to upload logo'));
    }
  };

  const toggleBackupBeforeUpdate = async (value: boolean) => {
    setS((prev) => (prev ? { ...prev, backup_before_update: value } : prev));
    try {
      const updated = await updateSettings({ backup_before_update: value });
      setS(updated);
    } catch (e) {
      setError(apiError(e, 'Could not change the backup setting'));
      load();
    }
  };

  const doTestEmail = async () => {
    setTestingEmail(true);
    setTestEmailResult(null);
    try {
      const result = await sendTestEmail();
      setTestEmailResult({ success: result.success, text: result.detail });
    } catch (e) {
      setTestEmailResult({ success: false, text: apiError(e, 'Test email failed to send') });
    } finally {
      setTestingEmail(false);
    }
  };

  const doCheck = async () => {
    setChecking(true);
    setError('');
    setMsg('');
    setUpdateNote(null);
    // Non-administrators may view the panel but cannot run update checks.
    // Show the spinner briefly, then deny with a clear message.
    if (!isAdmin) {
      window.setTimeout(() => {
        setChecking(false);
        setUpdateNote({ severity: 'error', text: NO_RIGHTS_MSG });
      }, 1100);
      return;
    }
    try {
      const updated = await checkUpdates();
      setS(updated);
      if (updated.available_version && updated.available_version !== updated.current_version) {
        setUpdateNote({
          severity: 'info',
          text: `Update available: v${updated.available_version}`,
        });
      } else {
        setUpdateNote({
          severity: 'success',
          text: `You're on the latest version (v${updated.current_version}).`,
        });
      }
    } catch (e) {
      setUpdateNote({
        severity: 'error',
        text: apiError(e, 'Update check failed. Please try again shortly.'),
      });
    } finally {
      setChecking(false);
    }
  };

  const [updateOpen, setUpdateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [updateState, setUpdateState] = useState<'queued' | 'running' | 'done' | 'error' | 'idle'>('idle');
  const [updateLog, setUpdateLog] = useState('');
  const [updatePct, setUpdatePct] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const requestApply = () => {
    if (!isAdmin) {
      setError(NO_RIGHTS_MSG);
      return;
    }
    setConfirmOpen(true);
  };

  const confirmApply = async () => {
    setConfirmOpen(false);
    setApplying(true);
    setError('');
    setMsg('');
    setUpdateNote(null);
    setUpdateLog('');
    setUpdatePct(null);
    setUpdateState('queued');
    setUpdateOpen(true);
    try {
      await applyUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to request update'));
      setUpdateOpen(false);
      setApplying(false);
      return;
    }

    // Poll for progress. The backend (and frontend) restart mid-update, so
    // failed polls are expected briefly — keep trying until done/error.
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const st = await getUpdateStatus();
        setUpdateLog(st.log || '');
        if (typeof st.pct === 'number') setUpdatePct((p) => Math.max(p ?? 0, st.pct as number));
        setUpdateState((st.status as typeof updateState) || 'running');
        if (st.status === 'done' || st.status === 'error') {
          stopPolling();
          setApplying(false);
          if (st.status === 'done') refreshSettings();
        }
      } catch {
        // Backend is likely restarting — show that and keep polling.
        setUpdateState((prev) => (prev === 'done' || prev === 'error' ? prev : 'running'));
      }
    }, 2000);
  };

  const refreshSettings = () => {
    getSettings().then(setS).catch(() => undefined);
  };

  if (!s)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );

  const updateAvailable =
    !!s.available_version && s.available_version !== s.current_version && s.available_version !== '';

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 3 }}>
        Settings
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {msg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>
          {msg}
        </Alert>
      )}

      {section && (
        <Button startIcon={<ArrowBackIcon />} onClick={() => setSection(null)} sx={{ mb: 2 }}>
          Back to Settings
        </Button>
      )}

      {!section && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {isAdmin && (
            <Tile
              icon={<StorefrontOutlinedIcon />}
              title="Company & Branding"
              subtitle="Company name, logo, tagline and job numbering."
              onClick={() => setSection('branding')}
            />
          )}
          {isAdmin && (
            <Tile
              icon={<EmailOutlinedIcon />}
              title="Email"
              subtitle="The SMTP account WorkshopIQ sends emails from."
              onClick={() => setSection('email')}
            />
          )}
          {isAdmin && (
            <Tile
              icon={<WhatsAppIcon />}
              title="Notifications"
              subtitle="WhatsApp default country code for customer messages."
              onClick={() => setSection('notifications')}
            />
          )}
          <Tile
            icon={<SystemUpdateAltIcon />}
            title="Software Updates"
            subtitle={
              updateAvailable
                ? `Update available: v${s.available_version}`
                : `Installed: v${s.current_version}`
            }
            badge={
              updateAvailable ? (
                <Chip size="small" color="success" label="Update available" sx={{ fontWeight: 700 }} />
              ) : undefined
            }
            onClick={() => setSection('updates')}
          />
          {isAdmin && (
            <Tile
              icon={<SettingsBackupRestoreOutlinedIcon />}
              title="Backup & Restore"
              subtitle="Download a full backup, or restore everything from a backup file."
              onClick={() => setSection('backup')}
            />
          )}
          {isAdmin && (
            <Tile
              icon={<AndroidIcon />}
              title="Android App"
              subtitle="Download the WorkshopIQ Android app (.apk) to install on a device."
              onClick={() => setSection('android')}
            />
          )}
          {isAdmin && (
            <Tile
              icon={<VerifiedUserOutlinedIcon />}
              title="Licensing"
              subtitle={
                !license || !license.activated
                  ? 'License status'
                  : !license.expires_at
                  ? 'Perpetual license — no expiry'
                  : daysUntil(license.expires_at) < 0
                  ? 'License has expired'
                  : `Renews in ${daysUntil(license.expires_at)} day${daysUntil(license.expires_at) === 1 ? '' : 's'}`
              }
              badge={
                license?.activated && license.expires_at && daysUntil(license.expires_at) < 30 ? (
                  <Chip
                    size="small"
                    color={daysUntil(license.expires_at) < 0 ? 'error' : 'warning'}
                    label={daysUntil(license.expires_at) < 0 ? 'Expired' : 'Renew soon'}
                    sx={{ fontWeight: 700 }}
                  />
                ) : undefined
              }
              onClick={() => setSection('licensing')}
            />
          )}
        </Grid>
      )}

      {section === 'branding' && isAdmin && (
        <>
      <Section
        icon={<StorefrontOutlinedIcon />}
        title="Company & Branding"
        subtitle="Shown across the portal and on the dashboard."
      >
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Company Name"
              fullWidth
              value={s.company_name}
              onChange={(e) => set('company_name', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Dashboard Tagline"
              fullWidth
              value={s.dashboard_branding || ''}
              onChange={(e) => set('dashboard_branding', e.target.value)}
            />
          </Grid>
          <Grid item xs={12}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Button
                variant="outlined"
                startIcon={<UploadIcon />}
                onClick={() => logoInput.current?.click()}
              >
                Upload Logo
              </Button>
              <input
                ref={logoInput}
                type="file"
                accept="image/*"
                hidden
                onChange={onLogo}
              />
              {s.company_logo ? (
                <Typography variant="body2" color="text.secondary">
                  Current: {s.company_logo}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No logo uploaded.
                </Typography>
              )}
            </Stack>
          </Grid>
        </Grid>
      </Section>

      <Section
        icon={<ConfirmationNumberOutlinedIcon />}
        title="Job Numbering"
        subtitle='Prefix for new job numbers. Changing it does not reset the running sequence — e.g. "Job 12" → change prefix → "Acme 13".'
      >
        <TextField
          label="Job Number Prefix"
          value={s.job_number_prefix}
          onChange={(e) => set('job_number_prefix', e.target.value)}
          sx={{ maxWidth: 320 }}
        />
      </Section>

      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </Stack>
        </>
      )}

      {section === 'email' && isAdmin && (
        <>
      <Section
        icon={<EmailOutlinedIcon />}
        title="Email (SMTP)"
        subtitle="The account WorkshopIQ sends notification emails from. For Gmail, use a 16-character App Password (Google Account → Security → App passwords) — your normal password will be rejected."
      >
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="SMTP Host"
              fullWidth
              placeholder="smtp.gmail.com"
              value={s.email_host || ''}
              onChange={(e) => set('email_host', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="SMTP Port"
              fullWidth
              placeholder="587"
              value={s.email_port || ''}
              onChange={(e) => set('email_port', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="SMTP Username"
              fullWidth
              placeholder="you@example.com"
              value={s.email_user || ''}
              onChange={(e) => set('email_user', e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="SMTP Password"
              type="password"
              fullWidth
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              placeholder={s.email_password_set ? '••••••••  (saved — leave blank to keep it)' : ''}
              helperText={
                s.email_password_set
                  ? 'A password is already saved. Leave this blank unless you want to replace it.'
                  : 'Not set yet.'
              }
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="From Address"
              fullWidth
              placeholder="you@example.com"
              value={s.email_from || ''}
              onChange={(e) => set('email_from', e.target.value)}
              helperText="Defaults to the SMTP username if left blank."
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 3 }} />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          This is just the sending account. Whether a job's customer gets emailed —
          and when — is controlled per job on that job's Overview tab, and always
          requires pressing Send. Nothing here sends anything on its own.
        </Typography>

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            startIcon={<SendIcon />}
            onClick={doTestEmail}
            disabled={testingEmail}
          >
            {testingEmail ? 'Sending…' : 'Send Test Email'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            Sends to your own account email. Save any SMTP changes first.
          </Typography>
        </Stack>
        {testEmailResult && (
          <Alert
            severity={testEmailResult.success ? 'success' : 'error'}
            sx={{ mt: 1.5 }}
            onClose={() => setTestEmailResult(null)}
          >
            {testEmailResult.text}
          </Alert>
        )}
      </Section>

      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </Stack>
        </>
      )}

      {section === 'notifications' && isAdmin && (
        <>
      <Section
        icon={<WhatsAppIcon />}
        title="WhatsApp Notifications"
        subtitle="Default country code used to build wa.me links when notifying a customer from a job."
      >
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Default Country Code"
              fullWidth
              value={s.whatsapp_country_code || ''}
              onChange={(e) => set('whatsapp_country_code', e.target.value.replace(/\D/g, ''))}
              helperText="Digits only, no +. South Africa is 27."
            />
          </Grid>
        </Grid>
      </Section>

      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save Settings'}
        </Button>
      </Stack>
        </>
      )}

      {section === 'updates' && (
      <Card
        sx={{
          mb: 3,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: updateAvailable ? 'success.main' : 'divider',
        }}
      >
        {/* Header band */}
        <Box
          sx={{
            px: 3,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            background: (t) =>
              `linear-gradient(135deg, ${t.palette.primary.dark} 0%, ${t.palette.primary.main} 100%)`,
            color: 'primary.contrastText',
          }}
        >
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.18)',
            }}
          >
            <SystemUpdateAltIcon />
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight={800} lineHeight={1.2}>
              Software Updates
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              Secure in-app updates · optional rollback backup · auto restart
            </Typography>
          </Box>
          <Chip
            size="small"
            label={updateAvailable ? 'Update available' : 'Up to date'}
            sx={{
              fontWeight: 700,
              color: updateAvailable ? '#0b2e13' : '#0b2e13',
              bgcolor: updateAvailable ? 'success.light' : 'rgba(255,255,255,0.92)',
            }}
            icon={updateAvailable ? <SystemUpdateAltIcon /> : <CheckCircleIcon />}
          />
        </Box>

        <CardContent sx={{ p: 3 }}>
          {/* Version stat tiles */}
          <Grid container spacing={2} sx={{ mb: 2.5 }}>
            <Grid item xs={12} sm={6} sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                  Installed
                </Typography>
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 800,
                    lineHeight: 1.1,
                    fontSize: { xs: '1.5rem', sm: '2.125rem' },
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  v{s.current_version}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={6} sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: updateAvailable ? 'success.main' : 'divider',
                  bgcolor: updateAvailable ? 'success.dark' : 'action.hover',
                  color: updateAvailable ? 'success.contrastText' : 'inherit',
                  minWidth: 0,
                  overflow: 'hidden',
                }}
              >
                <Typography
                  variant="overline"
                  letterSpacing={1}
                  sx={{ color: updateAvailable ? 'inherit' : 'text.secondary', opacity: 0.9 }}
                >
                  Latest
                </Typography>
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 800,
                    lineHeight: 1.1,
                    fontSize: { xs: '1.5rem', sm: '2.125rem' },
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {s.available_version ? `v${s.available_version}` : '—'}
                </Typography>
              </Box>
            </Grid>
          </Grid>

          <Box
            sx={{
              mb: 2,
              p: 2,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover',
            }}
          >
            <FormControlLabel
              sx={{ m: 0, alignItems: 'flex-start' }}
              control={
                <Switch
                  checked={s.backup_before_update ?? true}
                  onChange={(e) => toggleBackupBeforeUpdate(e.target.checked)}
                  disabled={!isAdmin}
                />
              }
              label={
                <Box sx={{ ml: 1 }}>
                  <Typography fontWeight={700}>Back up before updating</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {s.backup_before_update ?? true
                      ? `On — takes a rollback backup first, keeping only the newest ${s.backup_keep ?? 2} (older ones are pruned, so storage won't pile up).`
                      : 'Off — updates run without a backup. Take a manual backup below whenever you want one.'}
                  </Typography>
                </Box>
              }
            />
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button
              fullWidth
              variant="outlined"
              size="large"
              startIcon={checking ? <CircularProgress size={16} /> : <RefreshIcon />}
              onClick={doCheck}
              disabled={checking}
              sx={{ fontWeight: 700 }}
            >
              {checking ? 'Checking…' : 'Check for Updates'}
            </Button>
            <Button
              fullWidth
              variant="contained"
              color="success"
              size="large"
              disableElevation
              startIcon={<SystemUpdateAltIcon />}
              onClick={requestApply}
              disabled={!updateAvailable || applying}
              sx={{ fontWeight: 800 }}
            >
              {applying ? 'Applying…' : updateAvailable ? `Install v${s.available_version}` : 'Apply Update'}
            </Button>
          </Stack>

          {updateNote && (
            <Alert
              severity={updateNote.severity}
              variant="outlined"
              onClose={() => setUpdateNote(null)}
              sx={{ mt: 2 }}
            >
              {updateNote.text}
            </Alert>
          )}

          <Box
            sx={{
              mt: 2.5,
              pt: 2,
              borderTop: '1px dashed',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <CheckCircleIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="caption" color="text.secondary">
              Proprietary software · built and maintained on custom code. Updates are backed up
              and applied automatically with zero downtime.
            </Typography>
          </Box>
        </CardContent>
      </Card>
      )}

      {section === 'backup' && isAdmin && (
        <Section
          icon={<SettingsBackupRestoreOutlinedIcon />}
          title="Backup & Restore"
          subtitle="Download a complete copy of the system, or restore everything from a backup file."
        >
          <BackupRestore />
        </Section>
      )}

      {section === 'android' && isAdmin && (
        <Section
          icon={<AndroidIcon />}
          title="Android App"
          subtitle="Download the WorkshopIQ Android app (.apk) to install on a device."
        >
          <AppDownload />
        </Section>
      )}

      {section === 'licensing' && isAdmin && (
        <Section
          icon={<VerifiedUserOutlinedIcon />}
          title="Licensing"
          subtitle="Your WorkshopIQ license — who it's issued to, and when it needs renewing."
        >
          {licenseError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLicenseError('')}>
              {licenseError}
            </Alert>
          )}

          {!license ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2.5 }}>
                <Chip
                  size="small"
                  color={license.activated ? 'success' : 'error'}
                  icon={license.activated ? <CheckCircleIcon /> : <ErrorIcon />}
                  label={license.activated ? 'Active' : 'Not Activated'}
                  sx={{ fontWeight: 700 }}
                />
                {license.activated && !license.expires_at && (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<AllInclusiveIcon />}
                    label="Perpetual — no expiry"
                    sx={{ fontWeight: 700 }}
                  />
                )}
              </Stack>

              <Grid container spacing={2} sx={{ mb: 2.5 }}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                    Licensed To
                  </Typography>
                  <Typography variant="body1" fontWeight={700}>
                    {license.client || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                    Product
                  </Typography>
                  <Typography variant="body1" fontWeight={700}>
                    {license.product || '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                    Issued
                  </Typography>
                  <Typography variant="body1" fontWeight={700}>
                    {license.issued_at ? formatDate(license.issued_at) : '—'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                    Server ID
                  </Typography>
                  <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all' }}>
                    {license.server_id || '—'}
                  </Typography>
                </Grid>
              </Grid>

              <Divider sx={{ my: 2.5 }} />

              {!license.expires_at ? (
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 2,
                    borderRadius: 2,
                    bgcolor: 'action.hover',
                    border: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  <AllInclusiveIcon sx={{ color: 'success.main' }} />
                  <Box>
                    <Typography fontWeight={700}>This license never expires</Typography>
                    <Typography variant="body2" color="text.secondary">
                      No renewal needed — nothing to do here.
                    </Typography>
                  </Box>
                </Box>
              ) : (
                (() => {
                  const days = daysUntil(license.expires_at as string);
                  const expired = days < 0;
                  const soon = !expired && days <= 30;
                  const severity = expired ? 'error' : soon ? 'warning' : 'success';
                  return (
                    <Alert
                      severity={severity}
                      variant="outlined"
                      icon={<EventBusyOutlinedIcon />}
                      sx={{ alignItems: 'flex-start' }}
                    >
                      <Typography fontWeight={700} sx={{ mb: 0.25 }}>
                        {expired
                          ? `Expired ${formatDate(license.expires_at as string)} (${Math.abs(days)} day${
                              Math.abs(days) === 1 ? '' : 's'
                            } ago)`
                          : `Valid until ${formatDate(license.expires_at as string)} — renews in ${days} day${
                              days === 1 ? '' : 's'
                            }`}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {expired
                          ? 'This installation will stop working until a new license key is entered. Contact AR Smart Home Server to renew.'
                          : soon
                          ? 'Getting close to renewal — contact AR Smart Home Server ahead of time so there’s no interruption.'
                          : 'No action needed yet.'}
                      </Typography>
                    </Alert>
                  );
                })()
              )}
            </>
          )}
        </Section>
      )}

      {!section && isAdmin && s && (showMaint || s.maintenance_mode || s.server_shutdown) && (
        <Card
          sx={{
            mb: 3,
            border: '1px solid',
            borderColor: s.server_shutdown
              ? 'error.main'
              : s.maintenance_mode
              ? 'warning.main'
              : 'divider',
          }}
        >
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
              <BuildIcon sx={{ color: s.maintenance_mode ? 'warning.main' : 'text.disabled' }} />
              <Typography variant="h6" fontWeight={700}>
                Maintenance Mode
              </Typography>
              {s.maintenance_mode && (
                <Chip label="ACTIVE" color="warning" size="small" sx={{ fontWeight: 800 }} />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              When enabled, staff and clients are locked out of WorkshopIQ. Anyone who tries
              to sign in or use the app sees: “This server is currently under maintenance.
              Please try again later. If this continues, please contact your system
              administrator.” Administrators keep full access the whole time.
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={!!s.maintenance_mode}
                  disabled={maintBusy}
                  color="warning"
                  onChange={(e) => toggleMaintenance(e.target.checked)}
                />
              }
              label={
                <Typography fontWeight={700}>
                  {s.maintenance_mode ? 'Maintenance mode is ON' : 'Enable maintenance mode'}
                </Typography>
              }
            />
            {s.maintenance_mode && (
              <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
                Staff and clients cannot access the server right now. Turn this off to
                restore normal access.
              </Alert>
            )}

            {/* Second hidden control, nested behind this one. Tap the faint
                dots to reveal the server-shutdown lock. */}
            {(showShutdown || s.server_shutdown) && (
              <Box
                sx={{
                  mt: 3,
                  pt: 2.5,
                  borderTop: '1px dashed',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                  <PowerSettingsNewIcon
                    sx={{ color: s.server_shutdown ? 'error.main' : 'text.disabled' }}
                  />
                  <Typography variant="h6" fontWeight={700}>
                    Server Shutdown
                  </Typography>
                  {s.server_shutdown && (
                    <Chip label="ACTIVE" color="error" size="small" sx={{ fontWeight: 800 }} />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  A deeper lock than maintenance. When enabled, only administrators can
                  sign in. Any staff or client who tries to log in is told: “This server
                  has been shut down. Please contact your administrator.” Administrators
                  keep full access so you can turn it back off.
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={!!s.server_shutdown}
                      disabled={shutdownBusy}
                      color="error"
                      onChange={(e) => toggleShutdown(e.target.checked)}
                    />
                  }
                  label={
                    <Typography fontWeight={700}>
                      {s.server_shutdown ? 'Server shutdown is ON' : 'Enable server shutdown'}
                    </Typography>
                  }
                />
                {s.server_shutdown && (
                  <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
                    Only administrators can sign in right now. Staff and clients see the
                    shutdown message. Turn this off to restore normal access.
                  </Alert>
                )}
              </Box>
            )}

            {/* Hidden trigger for the shutdown lock — only reachable once this
                (already hidden) maintenance card is open. */}
            <Box sx={{ textAlign: 'center', mt: 2 }}>
              <Typography
                variant="caption"
                onClick={() => setShowShutdown((v) => !v)}
                sx={{
                  color: 'text.disabled',
                  cursor: 'pointer',
                  userSelect: 'none',
                  letterSpacing: 6,
                  px: 3,
                  py: 1,
                  display: 'inline-block',
                }}
              >
                · · ·
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

      {!section && isAdmin && (
        <Box sx={{ textAlign: 'center', mt: 1, mb: 2 }}>
          <Typography
            variant="caption"
            onClick={() => setShowMaint((v) => !v)}
            sx={{
              color: 'text.disabled',
              cursor: 'pointer',
              userSelect: 'none',
              letterSpacing: 6,
              px: 3,
              py: 1,
              display: 'inline-block',
            }}
          >
            · · ·
          </Typography>
        </Box>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2.5,
              flexShrink: 0,
              bgcolor: 'rgba(59,130,246,0.14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SystemUpdateAltIcon sx={{ color: '#60a5fa' }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>
              Install update
            </Typography>
            <Typography variant="caption" color="text.secondary">
              A new version is ready
            </Typography>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Chip
            variant="outlined"
            sx={{ mb: 2, height: 30 }}
            label={
              <Box
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontFamily: 'monospace', fontSize: 13 }}
              >
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  v{s.current_version}
                </Box>
                <Box component="span" sx={{ color: 'text.disabled' }}>
                  →
                </Box>
                <Box component="span" sx={{ color: '#60a5fa', fontWeight: 700 }}>
                  v{s.available_version}
                </Box>
              </Box>
            }
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.6 }}>
            WorkshopIQ will back up the database, pull the latest release, and rebuild. The app goes
            offline for a minute or two, then comes back on its own.
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 1,
              bgcolor: 'rgba(245,158,11,0.08)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 2,
              px: 1.5,
              py: 1,
            }}
          >
            <RefreshIcon sx={{ fontSize: 18, color: 'warning.main', mt: '1px' }} />
            <Typography variant="caption" sx={{ color: '#fbbf24', lineHeight: 1.5 }}>
              The server restarts automatically — no action needed from you.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit">
            Cancel
          </Button>
          <Button variant="contained" disableElevation startIcon={<UploadIcon />} onClick={confirmApply}>
            Back up &amp; update
          </Button>
        </DialogActions>
      </Dialog>

      <UpdateProgressDialog
        open={updateOpen}
        state={updateState}
        log={updateLog}
        serverPct={updatePct}
        onClose={() => setUpdateOpen(false)}
        onReload={() => window.location.reload()}
      />
    </Box>
  );
}
