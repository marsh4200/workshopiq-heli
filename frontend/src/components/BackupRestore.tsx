import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import {
  startBackup,
  getBackupProgress,
  downloadBackupResult,
  restoreBackup,
  apiError,
} from '../api/client';

export default function BackupRestore() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [phase, setPhase] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // The bar covers the WHOLE journey: building the zip on the server is
  // 0–70%, and the actual transfer to this device is 70–100%. It only hits
  // 100 at the moment the file lands in the browser's downloads — no more
  // freezing at "100%" while the real download quietly happens.
  const BUILD_SHARE = 0.7;
  const fmtMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    setMsg('');
    setPercent(0);
    setPhase('Starting…');
    try {
      const { job_id } = await startBackup();
      // Poll progress until the build is done (or fails).
      // Generous cap (~10 min) for large upload sets.
      for (let i = 0; i < 850; i++) {
        await sleep(700);
        let p;
        try {
          p = await getBackupProgress(job_id);
        } catch {
          continue; // a poll may briefly hit a worker before the file syncs
        }
        setPercent(Math.round((p.percent || 0) * BUILD_SHARE));
        setPhase(p.phase || '');
        if (p.state === 'error') {
          throw new Error(p.error || 'Backup failed');
        }
        if (p.state === 'done') {
          const expectedSize = p.size || 0;
          setPercent(Math.round(100 * BUILD_SHARE));
          setPhase('Downloading backup…');
          await downloadBackupResult(
            job_id,
            p.filename || undefined,
            expectedSize,
            (loaded, total) => {
              if (total && total > 0) {
                const dl = Math.min(1, loaded / total);
                setPercent(Math.round(100 * (BUILD_SHARE + (1 - BUILD_SHARE) * dl)));
                setPhase(`Downloading backup… ${fmtMB(loaded)} of ${fmtMB(total)}`);
              } else {
                // No size available — at least show live bytes moving.
                setPhase(`Downloading backup… ${fmtMB(loaded)}`);
              }
            },
          );
          setPercent(100);
          setPhase('Saved to your downloads');
          setMsg('Backup downloaded. Keep it somewhere safe.');
          await sleep(900); // let the bar visibly land on 100%
          break;
        }
      }
    } catch (e) {
      setError(apiError(e, 'Backup failed'));
    } finally {
      setDownloading(false);
      setPercent(0);
      setPhase('');
    }
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setPendingFile(f);
      setConfirmText('');
    }
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!pendingFile) return;
    setRestoring(true);
    setError('');
    setMsg('');
    try {
      const res = await restoreBackup(pendingFile);
      const total = Object.values(res.counts || {}).reduce((a, b) => a + b, 0);
      setMsg(
        `Restore complete — ${total} records restored from a ${res.restored_from_version || '?'} backup. ` +
          'Reloading…',
      );
      setPendingFile(null);
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      setError(apiError(e, 'Restore failed'));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Box>
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

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Button
          variant="contained"
          startIcon={downloading ? <CircularProgress size={18} color="inherit" /> : <CloudDownloadIcon />}
          onClick={handleDownload}
          disabled={downloading || restoring}
        >
          {downloading ? 'Preparing backup…' : 'Download Backup'}
        </Button>
        <Button
          variant="outlined"
          color="warning"
          startIcon={<RestoreIcon />}
          onClick={() => fileInput.current?.click()}
          disabled={downloading || restoring}
        >
          Restore from Backup
        </Button>
        <input
          type="file"
          accept=".zip"
          hidden
          ref={fileInput}
          onChange={pickFile}
        />
      </Stack>

      {downloading && (
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {phase || 'Preparing backup…'}
            </Typography>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>
              {percent}%
            </Typography>
          </Stack>
          <LinearProgress
            variant={percent > 0 ? 'determinate' : 'indeterminate'}
            value={percent}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        A backup captures everything — all jobs, users, settings, reviews and every
        uploaded photo and document — in a single file. To recover after a crash,
        reinstall WorkshopIQ, then restore that file here.
      </Typography>

      {/* Restore confirmation (destructive) */}
      <Dialog
        open={!!pendingFile}
        onClose={() => !restoring && setPendingFile(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Restore from backup?</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This will <strong>permanently overwrite all current data and uploads</strong> with
            the contents of the backup. This cannot be undone.
          </Alert>
          <DialogContentText sx={{ mb: 2 }}>
            File: <strong>{pendingFile?.name}</strong>
            <br />
            Type <strong>RESTORE</strong> below to confirm.
          </DialogContentText>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
            placeholder="RESTORE"
            disabled={restoring}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontSize: 16,
              letterSpacing: '0.15em',
              borderRadius: 8,
              border: '1px solid rgba(148,163,184,0.4)',
              background: 'transparent',
              color: 'inherit',
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setPendingFile(null)} disabled={restoring}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleRestore}
            disabled={restoring || confirmText !== 'RESTORE'}
            startIcon={restoring ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {restoring ? 'Restoring…' : 'Restore now'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
