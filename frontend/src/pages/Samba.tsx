import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import StorageIcon from '@mui/icons-material/Storage';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import BackupIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import { getSamba, updateSamba, testSamba, backupNowSamba, getSambaBackupProgress, apiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { SambaStatus, SambaBackupProgress } from '../types';

const NO_RIGHTS_MSG =
  'Unfortunately, you do not have these rights. Please contact your system administrator.';

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        )}
        <Box sx={{ mt: 2 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

function fmt(ts?: string | null): string {
  if (!ts) return 'Never';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

export default function Samba() {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<SambaStatus | null>(null);
  // Form fields (password is write-only; blank = keep existing).
  const [server, setServer] = useState('');
  const [share, setShare] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [subpath, setSubpath] = useState('');
  const [autoBackup, setAutoBackup] = useState(false);

  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupPct, setBackupPct] = useState(0);
  const [backupPhase, setBackupPhase] = useState('');
  const pollRef = useRef<number | null>(null);

  const hydrate = (s: SambaStatus) => {
    setStatus(s);
    setServer(s.server || '');
    setShare(s.share || '');
    setUsername(s.username || '');
    setSubpath(s.subpath || '');
    setAutoBackup(s.auto_backup);
    setPassword(''); // never populated from the server
  };

  useEffect(() => {
    getSamba()
      .then(hydrate)
      .catch((e) => setError(apiError(e, 'Failed to load Samba settings')));
  }, []);

  const clearNotes = () => {
    setError('');
    setMsg('');
  };

  const save = async () => {
    if (!isAdmin) return setError(NO_RIGHTS_MSG);
    setSaving(true);
    clearNotes();
    try {
      const body = {
        server,
        share,
        username,
        subpath,
        auto_backup: autoBackup,
        ...(password ? { password } : {}),
      };
      const updated = await updateSamba(body);
      hydrate(updated);
      setMsg('Saved.');
    } catch (e) {
      setError(apiError(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const doTest = async () => {
    if (!isAdmin) return setError(NO_RIGHTS_MSG);
    setTesting(true);
    clearNotes();
    try {
      // Save first so the test uses exactly what's on screen.
      const body = {
        server,
        share,
        username,
        subpath,
        auto_backup: autoBackup,
        ...(password ? { password } : {}),
      };
      hydrate(await updateSamba(body));
      const res = await testSamba();
      setMsg(res.detail || 'Connection successful.');
    } catch (e) {
      setError(apiError(e, 'Connection failed'));
    } finally {
      setTesting(false);
    }
  };

  const stopPoll = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const applyProgress = (p: SambaBackupProgress) => {
    if (p.state === 'running') {
      setBackingUp(true);
      setBackupPct(p.percent);
      setBackupPhase(p.phase || 'Working…');
    } else if (p.state === 'done') {
      stopPoll();
      setBackupPct(100);
      setBackingUp(false);
      setMsg(p.detail || 'Backup complete.');
      getSamba().then(setStatus).catch(() => undefined);
    } else if (p.state === 'error') {
      stopPoll();
      setBackingUp(false);
      setError(p.error ? `Backup failed: ${p.error}` : 'Backup failed.');
      getSamba().then(setStatus).catch(() => undefined);
    }
  };

  const startPoll = () => {
    stopPoll();
    pollRef.current = window.setInterval(async () => {
      try {
        applyProgress(await getSambaBackupProgress());
      } catch {
        /* transient network blip — keep polling */
      }
    }, 700);
  };

  // Stop polling on unmount; if a backup is already running (e.g. after a page
  // reload mid-backup), pick the progress bar back up.
  useEffect(() => {
    let cancelled = false;
    getSambaBackupProgress()
      .then((p) => {
        if (!cancelled && p.state === 'running') {
          applyProgress(p);
          startPoll();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stopPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doBackupNow = async () => {
    if (!isAdmin) return setError(NO_RIGHTS_MSG);
    setBackingUp(true);
    setBackupPct(0);
    setBackupPhase('Starting backup…');
    clearNotes();
    try {
      await backupNowSamba();
      startPoll();
    } catch (e) {
      setBackingUp(false);
      setError(apiError(e, 'Backup failed'));
    }
  };

  if (!status)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );

  const lastFailed = (status.last_backup_status || '').startsWith('error');
  const canAct = !!server && !!share;

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        Network Backup
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Automatically copy a full WorkshopIQ backup to a Samba network drive. When enabled, a
        backup runs every {status.interval_hours} hours and the share always keeps the latest{' '}
        {status.keep_copies} copies — each new one replaces the oldest.
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

      {/* Status band */}
      <Card sx={{ mb: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        <Box
          sx={{
            px: 3,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            background: (t) => `linear-gradient(135deg, ${t.palette.primary.dark} 0%, ${t.palette.primary.main} 100%)`,
            color: 'primary.contrastText',
          }}
        >
          <Box sx={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.18)' }}>
            <StorageIcon />
          </Box>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" fontWeight={800} lineHeight={1.2}>
              Samba Backup
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {status.configured
                ? `Target: \\\\${status.server}\\${status.share}${status.subpath ? '\\' + status.subpath : ''}`
                : 'No network drive configured yet'}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={status.auto_backup && status.configured ? 'Auto-backup on' : 'Disabled'}
            sx={{
              fontWeight: 700,
              color: '#0b2e13',
              bgcolor: status.auto_backup && status.configured ? 'success.light' : 'rgba(255,255,255,0.92)',
            }}
            icon={status.auto_backup && status.configured ? <WifiTetheringIcon /> : <ErrorIcon />}
          />
        </Box>
        <CardContent sx={{ p: 3 }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                Last backup
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{fmt(status.last_backup_at)}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="overline" color="text.secondary" letterSpacing={1}>
                Last result
              </Typography>
              {status.last_backup_status ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  {lastFailed ? (
                    <ErrorIcon fontSize="small" color="error" />
                  ) : (
                    <CheckCircleIcon fontSize="small" color="success" />
                  )}
                  <Typography sx={{ fontWeight: 700 }}>
                    {lastFailed ? status.last_backup_status : 'Success'}
                  </Typography>
                </Stack>
              ) : (
                <Typography sx={{ fontWeight: 700 }}>—</Typography>
              )}
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Configuration form */}
      <Section
        title="Network Drive"
        subtitle="Enter the SMB share details. The password is stored securely and never shown again."
      >
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Server IP / hostname"
              placeholder="192.168.88.184"
              fullWidth
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Share name"
              placeholder="backups"
              fullWidth
              value={share}
              onChange={(e) => setShare(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Username"
              fullWidth
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Password"
              type="password"
              fullWidth
              autoComplete="new-password"
              placeholder={status.password_set ? '•••••••• (unchanged)' : ''}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helperText={status.password_set ? 'Leave blank to keep the saved password.' : ' '}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Folder on share (optional)"
              placeholder="workshopiq"
              fullWidth
              value={subpath}
              onChange={(e) => setSubpath(e.target.value)}
              helperText="Subfolder inside the share to store backups in."
            />
          </Grid>
        </Grid>

        <Divider sx={{ my: 2.5 }} />

        <FormControlLabel
          control={
            <Switch
              checked={autoBackup}
              onChange={(e) => setAutoBackup(e.target.checked)}
              disabled={!canAct}
            />
          }
          label={
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Enable automatic backup</Typography>
              <Typography variant="caption" color="text.secondary">
                Runs every {status.interval_hours} hours · keeps the newest {status.keep_copies} copies
              </Typography>
            </Box>
          }
        />
        {!canAct && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Enter a server and share name to enable automatic backups.
          </Typography>
        )}
      </Section>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 4 }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
          onClick={save}
          disabled={saving || testing || backingUp}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          variant="outlined"
          startIcon={testing ? <CircularProgress size={16} /> : <WifiTetheringIcon />}
          onClick={doTest}
          disabled={!canAct || saving || testing || backingUp}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </Button>
        <Button
          variant="outlined"
          color="success"
          startIcon={backingUp ? <CircularProgress size={16} /> : <BackupIcon />}
          onClick={doBackupNow}
          disabled={!canAct || saving || testing || backingUp}
        >
          {backingUp ? 'Backing up…' : 'Back Up Now'}
        </Button>
      </Stack>

      {backingUp && (
        <Card sx={{ mb: 4, border: '1px solid', borderColor: 'divider' }}>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <BackupIcon fontSize="small" color="success" />
                <Typography sx={{ fontWeight: 700 }}>
                  {backupPhase || 'Backing up…'}
                </Typography>
              </Stack>
              <Typography sx={{ fontWeight: 800 }} color="text.secondary">
                {backupPct}%
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={backupPct}
              color="success"
              sx={{ height: 10, borderRadius: 5 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Copying a full backup to the network drive — you can keep working; this runs in the
              background.
            </Typography>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
