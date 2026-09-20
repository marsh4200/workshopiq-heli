import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutline';
import CloudSyncIcon from '@mui/icons-material/CloudSyncOutlined';
import { activateLicense, apiError, requestLicense } from '../api/client';
import type { LicenseStatus } from '../types';
import { fontDisplay, fontMono } from '../theme/theme';
import { Logomark } from '../components/common';

export const REASON_MESSAGES: Record<string, string> = {
  not_activated: 'This install has not been activated yet.',
  invalid_or_unsigned: "That license key isn't recognised. Check it was copied in full.",
  wrong_product: 'That license key is for a different product.',
  server_mismatch:
    "That license key was issued for a different server. Send the Server ID below to get one for this install.",
  expired: 'This license has expired. Contact AR Smart Home Server for a renewal.',
  pending_approval:
    "Waiting for approval — this Server ID has reached the licence server. This page unlocks by itself once it's approved.",
  activation_refused:
    'The licence server declined this install (revoked or expired). Contact AR Smart Home Server.',
  checked_recently: 'Checked a moment ago — trying again shortly.',
  no_activation_endpoint:
    'The configured licence server address has no activation endpoint. Check WORKSHOPIQ_LICENSE_URL points at the licence server, not the request portal.',
  cannot_reach_server:
    "Couldn't reach the licence server. Check this server's internet connection, or enter a key manually below.",
};

// While the Server ID is waiting for approval, ask again this often so
// approving it on the licence server unlocks this page by itself.
const PENDING_POLL_MS = 30000;

export default function Activate({
  status,
  onActivated,
}: {
  status: LicenseStatus;
  onActivated: (s: LicenseStatus) => void;
}) {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [online, setOnline] = useState<{ severity: 'info' | 'warning' | 'error' | 'success'; text: string } | null>(null);
  const [lastContact, setLastContact] = useState<string | null>(null);
  const [serverId, setServerId] = useState(status.server_id);
  const [showManual, setShowManual] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ask the AR Smart Home licence server for this install's key — the same
  // request AR HDL BUSPRO and GuestIQ make. Runs once on load, then again
  // every 30 s while the Server ID is waiting for approval.
  const checkServer = useCallback(
    async (auto: boolean) => {
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      setChecking(true);
      try {
        const r = await requestLicense();
        if (r.server_id) setServerId(r.server_id);
        if (r.last_contact) setLastContact(r.last_contact);
        if (r.activated) {
          setOnline({ severity: 'success', text: `Licensed${r.client ? ` to ${r.client}` : ''} — opening WorkshopIQ…` });
          setTimeout(() => onActivated(r), 800);
          return;
        }
        const text = REASON_MESSAGES[r.reason || ''] || 'This install is not currently licensed.';
        if (r.reason === 'pending_approval' || r.reason === 'checked_recently') {
          setOnline({ severity: 'info', text });
          pollRef.current = setTimeout(() => checkServer(true), PENDING_POLL_MS);
        } else {
          setOnline({ severity: auto && r.reason === 'cannot_reach_server' ? 'warning' : 'error', text });
          if (r.reason === 'cannot_reach_server') setShowManual(true);
        }
      } catch (err) {
        setOnline({ severity: 'error', text: apiError(err, "Couldn't contact this WorkshopIQ server") });
      } finally {
        setChecking(false);
      }
    },
    [onActivated],
  );

  useEffect(() => {
    checkServer(true);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [checkServer]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await activateLicense(key.trim());
      if (result.activated) {
        onActivated(result);
      } else {
        setError(
          REASON_MESSAGES[result.reason || ''] ||
            'That license key could not be activated.',
        );
      }
    } catch (err) {
      setError(apiError(err, 'Activation failed'));
    } finally {
      setLoading(false);
    }
  };

  const copyServerId = async () => {
    try {
      await navigator.clipboard.writeText(serverId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the ID is still selectable text below.
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: { xs: 3, sm: 5 },
        background:
          'radial-gradient(900px 600px at 20% 0%, rgba(37,99,235,0.14), transparent 60%), #0a0e16',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 440 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 4 }}>
          <Logomark size={38} />
          <Box>
            <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 20, color: '#e2e8f0' }}>
              WorkshopIQ
            </Typography>
            <Typography sx={{ fontFamily: fontMono, fontSize: 11, color: '#64748b', letterSpacing: '0.06em' }}>
              AR SMART HOME SERVER
            </Typography>
          </Box>
        </Box>

        <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 24, color: '#e2e8f0' }}>
          Activate this install
        </Typography>
        <Typography sx={{ color: '#94a3b8', mb: 3, mt: 0.5 }}>
          This install asks the AR Smart Home licence server for its key automatically.
        </Typography>

        {online && (
          <Alert severity={online.severity} variant="outlined" sx={{ mb: 2 }}>
            {online.text}
          </Alert>
        )}

        <Button
          variant="contained"
          fullWidth
          size="large"
          startIcon={<CloudSyncIcon />}
          disabled={checking}
          onClick={() => checkServer(false)}
          sx={{ py: 1.2 }}
        >
          {checking ? 'Checking with licence server…' : 'Request license from server'}
        </Button>
        <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 1, mb: 2 }}>
          {lastContact
            ? `Last reached the licence server: ${new Date(lastContact).toLocaleString()}`
            : '\u00a0'}
        </Typography>

        {!online && status.reason && status.reason !== 'not_activated' && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            {REASON_MESSAGES[status.reason] || 'This install is not currently licensed.'}
          </Alert>
        )}
        {error && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Button
          variant="text"
          size="small"
          onClick={() => setShowManual((v) => !v)}
          sx={{ color: '#94a3b8', px: 0, mb: 1 }}
        >
          {showManual ? 'Hide manual key entry' : 'No internet on this site? Enter a key manually'}
        </Button>

        {showManual && (
        <form onSubmit={submit}>
          <Typography variant="overline" component="label" sx={{ display: 'block', mb: 0.5, color: '#94a3b8' }}>
            License key
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            placeholder="WIQL1...."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            sx={{
              mb: 2,
              '& textarea': { fontFamily: fontMono, fontSize: 12.5, wordBreak: 'break-all' },
            }}
          />

          <Button
            type="submit"
            variant="outlined"
            fullWidth
            size="large"
            disabled={loading || !key.trim()}
            sx={{ py: 1.2 }}
          >
            {loading ? 'Activating…' : 'Activate with key'}
          </Button>
        </form>
        )}

        <Box
          sx={{
            mt: 4,
            p: 2,
            borderRadius: 2,
            border: '1px solid rgba(148,163,184,0.18)',
            bgcolor: 'rgba(148,163,184,0.05)',
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="overline" sx={{ color: '#94a3b8' }}>
                Server ID
              </Typography>
              <Typography sx={{ fontFamily: fontMono, fontSize: 13, color: '#e2e8f0', wordBreak: 'break-all' }}>
                {serverId || '—'}
              </Typography>
            </Box>
            <Tooltip title={copied ? 'Copied' : 'Copy'}>
              <IconButton onClick={copyServerId} size="small" sx={{ color: '#94a3b8' }}>
                {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
            The licence server sees this ID as soon as this install checks in — once it's
            approved there, this page unlocks by itself.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
