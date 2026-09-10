import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import CircularProgress from '@mui/material/CircularProgress';

type UpdateState = 'idle' | 'queued' | 'running' | 'done' | 'error';

interface Props {
  open: boolean;
  state: UpdateState;
  log: string;
  /** True progress reported by the updater (.update-pct). Null/undefined on
   *  older updaters — the dialog then falls back to log-milestone parsing. */
  serverPct?: number | null;
  onClose: () => void;
  onReload: () => void;
}

const STEPS = ['Backup', 'Fetch update', 'Rebuild containers', 'Restart', 'Finish'];

// Map known updater log lines (from scripts/update.sh) to a percentage + step.
// The updater itself is unchanged — we just read the milestones it already logs.
const MILESTONES: { match: string; pct: number; step: number }[] = [
  { match: 'Update started', pct: 4, step: 0 },
  { match: 'Backing up', pct: 9, step: 0 },
  { match: 'Backup complete', pct: 18, step: 0 },
  { match: 'Fetching latest', pct: 28, step: 1 },
  { match: 'Checking out', pct: 42, step: 1 },
  { match: 'pulling default branch', pct: 42, step: 1 },
  { match: 'No tags found', pct: 42, step: 1 },
  { match: 'Rebuilding containers', pct: 55, step: 2 },
  { match: 'Containers rebuilt', pct: 88, step: 3 },
  { match: 'Updated to version', pct: 94, step: 3 },
  { match: 'Update complete', pct: 100, step: 4 },
];

const REBUILD_CAPTIONS = [
  'Rebuilding backend image…',
  'Rebuilding frontend image…',
  'Restarting database…',
  'Bringing services online…',
];

function derive(state: UpdateState, log: string) {
  let pct = 0;
  let step = 0;
  for (const m of MILESTONES) {
    if (log.includes(m.match)) {
      pct = Math.max(pct, m.pct);
      step = Math.max(step, m.step);
    }
  }
  if (state === 'queued' && pct === 0) pct = 2;
  if (state === 'done') {
    pct = 100;
    step = STEPS.length - 1;
  }
  // In the rebuild window (logged 'Rebuilding…' but not yet 'Containers rebuilt')
  const rebuilding = log.includes('Rebuilding containers') && !log.includes('Containers rebuilt');
  return { pct, step, rebuilding };
}

export default function UpdateProgressDialog({ open, state, log, serverPct, onClose, onReload }: Props) {
  const { pct: milestonePct, step, rebuilding } = useMemo(() => derive(state, log), [state, log]);

  const [display, setDisplay] = useState(0);
  const [creep, setCreep] = useState(0);
  const [captionIdx, setCaptionIdx] = useState(0);
  const startedRef = useRef(false);

  // Reset when a fresh run opens.
  useEffect(() => {
    if (open && (state === 'queued' || state === 'idle')) {
      if (!startedRef.current) {
        setDisplay(0);
        setCreep(0);
        startedRef.current = true;
      }
    }
    if (!open) startedRef.current = false;
  }, [open, state]);

  // During the long rebuild phase, creep forward so it's visibly working.
  // When the updater reports true progress (serverPct), the creep is only a
  // smoothing layer capped just above it — the bar tracks reality.
  useEffect(() => {
    if (!rebuilding) return;
    const cap = serverPct != null ? Math.min(serverPct + 3, 96) : 82;
    const id = window.setInterval(() => {
      setCreep((c) => Math.min(cap, Math.max(c, serverPct != null ? serverPct : 56) + 1));
    }, 1100);
    return () => window.clearInterval(id);
  }, [rebuilding, serverPct]);

  // Rotate the rebuild caption so each container reads as making progress.
  useEffect(() => {
    if (!rebuilding) return;
    const id = window.setInterval(() => setCaptionIdx((i) => (i + 1) % REBUILD_CAPTIONS.length), 2200);
    return () => window.clearInterval(id);
  }, [rebuilding]);

  const target = Math.max(
    milestonePct,
    serverPct ?? 0,
    rebuilding ? creep : 0,
    state === 'done' ? 100 : 0,
  );

  // Ease the displayed bar toward the target (forward only).
  useEffect(() => {
    const id = window.setInterval(() => {
      setDisplay((d) => {
        if (d >= target) return d;
        const next = d + Math.max(1, Math.ceil((target - d) * 0.25));
        return Math.min(next, target);
      });
    }, 110);
    return () => window.clearInterval(id);
  }, [target]);

  const isError = state === 'error';
  const isDone = state === 'done';
  const finished = isError || isDone;

  const caption = isError
    ? 'Update failed'
    : isDone
      ? 'Update complete'
      : rebuilding
        ? REBUILD_CAPTIONS[captionIdx]
        : state === 'queued'
          ? 'Waiting for the update service…'
          : `${STEPS[step]}…`;

  const shownPct = isError ? display : Math.round(display);

  return (
    <Dialog open={open} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          {isDone ? (
            <CheckCircleIcon color="success" />
          ) : isError ? (
            <ErrorIcon color="error" />
          ) : (
            <CircularProgress size={22} />
          )}
          <span>
            {isDone ? 'Update complete' : isError ? 'Update failed' : 'Updating WorkshopIQ…'}
          </span>
        </Stack>
      </DialogTitle>

      <DialogContent>
        {/* Progress bar */}
        <Box sx={{ mb: 0.75 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {caption}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {shownPct}%
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={Math.min(100, shownPct)}
            color={isError ? 'error' : isDone ? 'success' : 'primary'}
            sx={{ height: 10, borderRadius: 5 }}
          />
        </Box>

        {/* Step checklist */}
        <Stack direction="row" spacing={1} sx={{ my: 2, flexWrap: 'wrap', rowGap: 1 }}>
          {STEPS.map((label, i) => {
            const complete = i < step || isDone;
            const active = i === step && !finished;
            return (
              <Stack
                key={label}
                direction="row"
                spacing={0.75}
                alignItems="center"
                sx={{
                  px: 1.2,
                  py: 0.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: active ? 'primary.main' : 'divider',
                  bgcolor: active ? 'rgba(59,130,246,0.10)' : 'transparent',
                  opacity: complete || active ? 1 : 0.55,
                }}
              >
                {complete ? (
                  <CheckCircleIcon sx={{ fontSize: 17 }} color="success" />
                ) : active ? (
                  <CircularProgress size={13} />
                ) : (
                  <RadioButtonUncheckedIcon sx={{ fontSize: 17, opacity: 0.6 }} />
                )}
                <Typography variant="caption" sx={{ fontWeight: active ? 700 : 500 }}>
                  {label}
                </Typography>
              </Stack>
            );
          })}
        </Stack>

        {!finished && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Backing up, pulling the latest release and rebuilding. The service will restart
            during this process — this dialog keeps tracking it and reconnects automatically.
          </Typography>
        )}

        {/* Live log (kept, collapsible) */}
        <Box
          sx={{
            bgcolor: 'rgba(0,0,0,0.35)',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1.5,
            p: 1.5,
            fontFamily: 'monospace',
            fontSize: 12.5,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {log || 'Waiting for the update service to pick up the request…'}
        </Box>

        <Collapse in={isDone}>
          <Alert severity="success" sx={{ mt: 2 }}>
            Update applied successfully. Reload to use the new version.
          </Alert>
        </Collapse>
        <Collapse in={isError}>
          <Alert severity="error" sx={{ mt: 2 }}>
            The update did not complete. Your data and backup are safe — review the log above.
          </Alert>
        </Collapse>

        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
          {finished && <Button onClick={onClose}>Close</Button>}
          {isDone && (
            <Button variant="contained" onClick={onReload}>
              Reload Now
            </Button>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
