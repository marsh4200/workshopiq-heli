import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { apiError, approveClosure, getPendingClosures, rejectClosure } from '../api/client';
import { fmtDate, EmptyState } from '../components/common';
import { useDeviceType } from '../hooks/useDeviceType';
import type { PendingClosure } from '../types';

export default function ClosureRequests() {
  const navigate = useNavigate();
  const isMobile = useDeviceType().isMobile;

  const [items, setItems] = useState<PendingClosure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<PendingClosure | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return getPendingClosures()
      .then(setItems)
      .catch((e) => setError(apiError(e, 'Failed to load closure requests')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (item: PendingClosure) => {
    setBusyId(item.job_id);
    setError('');
    try {
      await approveClosure(item.job_id);
      await load();
    } catch (e) {
      setError(apiError(e, 'Could not approve closure'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight={800}>
            Closure Requests
          </Typography>
          <Typography color="text.secondary">
            Jobs staff have asked to close without a client final inspection.
          </Typography>
        </Box>
      </Stack>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<GavelOutlinedIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
            title="Nothing awaiting closure"
            subtitle="Closure requests raised by staff will show up here for approval."
          />
        </Card>
      ) : isMobile ? (
        <Stack spacing={1.5}>
          {items.map((it) => (
            <Card key={it.job_id} sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800}>{it.job_number}</Typography>
                <Button
                  size="small"
                  endIcon={<OpenInNewIcon fontSize="small" />}
                  onClick={() => navigate(`/jobs/${it.job_id}?tab=${encodeURIComponent('Final Inspection')}`)}
                >
                  Open
                </Button>
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {it.customer_name}
              </Typography>
              {it.reason && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Reason: {it.reason}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {it.requested_by ? `Requested by ${it.requested_by}` : 'Requested'}
                {it.requested_at ? ` · ${fmtDate(it.requested_at)}` : ''}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <Button
                  variant="contained"
                  color="success"
                  size="small"
                  fullWidth
                  startIcon={<CheckCircleOutlineIcon />}
                  disabled={busyId === it.job_id}
                  onClick={() => approve(it)}
                >
                  Approve
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  fullWidth
                  startIcon={<HighlightOffIcon />}
                  disabled={busyId === it.job_id}
                  onClick={() => setRejecting(it)}
                >
                  Reject
                </Button>
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Job #</TableCell>
                <TableCell>Customer</TableCell>
                <TableCell>Reason</TableCell>
                <TableCell>Requested by</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.job_id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{it.job_number}</TableCell>
                  <TableCell>{it.customer_name}</TableCell>
                  <TableCell sx={{ maxWidth: 280 }}>{it.reason || '—'}</TableCell>
                  <TableCell>{it.requested_by || '—'}</TableCell>
                  <TableCell>{fmtDate(it.requested_at)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        onClick={() =>
                          navigate(`/jobs/${it.job_id}?tab=${encodeURIComponent('Final Inspection')}`)
                        }
                      >
                        Open
                      </Button>
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        disabled={busyId === it.job_id}
                        onClick={() => approve(it)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        disabled={busyId === it.job_id}
                        onClick={() => setRejecting(it)}
                      >
                        Reject
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {rejecting && (
        <RejectDialog
          item={rejecting}
          onClose={() => setRejecting(null)}
          onDone={async () => {
            setRejecting(null);
            await load();
          }}
          setError={setError}
        />
      )}
    </Box>
  );
}

function RejectDialog({
  item,
  onClose,
  onDone,
  setError,
}: {
  item: PendingClosure;
  onClose: () => void;
  onDone: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await rejectClosure(item.job_id, { reason: reason.trim() || undefined });
      await onDone();
    } catch (e) {
      setError(apiError(e, 'Could not reject closure'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Reject closure for {item.job_number}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Staff will need to re-request closure or run the client inspection as normal.
        </Typography>
        <TextField
          label="Reason (optional)"
          size="small"
          fullWidth
          multiline
          minRows={2}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" color="error" onClick={submit} disabled={busy}>
          {busy ? 'Rejecting…' : 'Reject'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
