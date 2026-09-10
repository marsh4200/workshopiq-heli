import { useState } from 'react';
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
import { activateLicense, apiError } from '../api/client';
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
};

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
      await navigator.clipboard.writeText(status.server_id);
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
          Enter the license key for this server to continue.
        </Typography>

        {status.reason && status.reason !== 'not_activated' && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            {REASON_MESSAGES[status.reason] || 'This install is not currently licensed.'}
          </Alert>
        )}
        {error && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={submit}>
          <Typography variant="overline" component="label" sx={{ display: 'block', mb: 0.5, color: '#94a3b8' }}>
            License key
          </Typography>
          <TextField
            fullWidth
            autoFocus
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
            variant="contained"
            fullWidth
            size="large"
            disabled={loading || !key.trim()}
            sx={{ py: 1.2 }}
          >
            {loading ? 'Activating…' : 'Activate'}
          </Button>
        </form>

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
                {status.server_id || '—'}
              </Typography>
            </Box>
            <Tooltip title={copied ? 'Copied' : 'Copy'}>
              <IconButton onClick={copyServerId} size="small" sx={{ color: '#94a3b8' }}>
                {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Stack>
          <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mt: 0.5 }}>
            Send this ID to AR Smart Home Server support to have a license key issued for this
            server.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
