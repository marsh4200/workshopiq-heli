import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import {
  apiError,
  createNCR,
  deleteNCR,
  fetchNCRMeta,
  getNCR,
  listJobs,
  listNCRs,
  updateNCR,
} from '../api/client';
import { fmtDay, EmptyState } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { JobListItem, NCR, NCRListItem, NCRMeta } from '../types';

const SEVERITY_COLORS: Record<string, string> = {
  Minor: '#38bdf8',
  Major: '#f59e0b',
  Critical: '#f43f5e',
};
const STATUS_COLORS: Record<string, string> = {
  Open: '#f43f5e',
  'In Progress': '#f59e0b',
  Closed: '#22c55e',
};

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: `${color}1f`,
        color,
        border: `1px solid ${color}3d`,
        fontWeight: 700,
        '& .MuiChip-label': { px: 1.1 },
      }}
    />
  );
}

const EMPTY_META: NCRMeta = {
  categories: [],
  severities: [],
  sources: [],
  dispositions: [],
  statuses: [],
};

export default function NCRs() {
  const { isAdmin } = useAuth();
  const isMobile = useDeviceType().isMobile;

  const [ncrs, setNcrs] = useState<NCRListItem[]>([]);
  const [meta, setMeta] = useState<NCRMeta>(EMPTY_META);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<NCR | NCRListItem | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return listNCRs(statusFilter ? { status: statusFilter } : undefined)
      .then(setNcrs)
      .catch((e) => setError(apiError(e, 'Failed to load NCRs')))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchNCRMeta().then(setMeta).catch(() => undefined);
    listJobs().then(setJobs).catch(() => undefined);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ncrs;
    return ncrs.filter(
      (n) =>
        n.ncr_number.toLowerCase().includes(q) ||
        n.title.toLowerCase().includes(q) ||
        (n.job_number || '').toLowerCase().includes(q),
    );
  }, [ncrs, search]);

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
  };

  const onSaved = async () => {
    closeDialog();
    await load();
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
            NCRs
          </Typography>
          <Typography color="text.secondary">Non-Conformance Reports</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>
          New NCR
        </Button>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          placeholder="Search by NCR number, title, job…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
        <TextField
          select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {meta.statuses.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
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
      ) : filtered.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<ReportProblemOutlinedIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
            title="No NCRs found"
            subtitle={
              statusFilter
                ? `No NCRs with status "${statusFilter}".`
                : 'Raise your first non-conformance report.'
            }
          />
        </Card>
      ) : isMobile ? (
        <Stack spacing={1.5}>
          {filtered.map((n) => (
            <Card key={n.id} onClick={() => setEditing(n)} sx={{ p: 2, cursor: 'pointer' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography fontWeight={800}>{n.ncr_number}</Typography>
                <Pill label={n.status} color={STATUS_COLORS[n.status] || '#94a3b8'} />
              </Stack>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {n.title}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center" flexWrap="wrap">
                <Pill label={n.severity} color={SEVERITY_COLORS[n.severity] || '#94a3b8'} />
                <Chip label={n.category} size="small" variant="outlined" />
                {n.job_number && <Chip label={n.job_number} size="small" variant="outlined" />}
              </Stack>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>NCR #</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Job</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Raised</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((n) => (
                <TableRow key={n.id} hover onClick={() => setEditing(n)} sx={{ cursor: 'pointer' }}>
                  <TableCell sx={{ fontWeight: 700 }}>{n.ncr_number}</TableCell>
                  <TableCell>{n.title}</TableCell>
                  <TableCell>{n.job_number || '—'}</TableCell>
                  <TableCell>
                    <Chip label={n.category} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Pill label={n.severity} color={SEVERITY_COLORS[n.severity] || '#94a3b8'} />
                  </TableCell>
                  <TableCell>
                    <Pill label={n.status} color={STATUS_COLORS[n.status] || '#94a3b8'} />
                  </TableCell>
                  <TableCell>{fmtDay(n.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {(creating || editing) && (
        <NCRDialog
          existing={editing && 'description' in editing ? (editing as NCR) : editing}
          existingId={editing?.id ?? null}
          meta={meta}
          jobs={jobs}
          canDelete={isAdmin}
          onClose={closeDialog}
          onSaved={onSaved}
          setError={setError}
        />
      )}
    </Box>
  );
}

function NCRDialog({
  existing,
  existingId,
  meta,
  jobs,
  canDelete,
  onClose,
  onSaved,
  setError,
}: {
  existing: NCR | NCRListItem | null;
  existingId: number | null;
  meta: NCRMeta;
  jobs: JobListItem[];
  canDelete: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const isEdit = existingId !== null;
  const full = existing as NCR | null;

  const [title, setTitle] = useState(existing?.title || '');
  const [description, setDescription] = useState(full?.description || '');
  const [category, setCategory] = useState(existing?.category || 'Other');
  const [severity, setSeverity] = useState(existing?.severity || 'Minor');
  const [source, setSource] = useState(full?.source || 'In-Process');
  const [disposition, setDisposition] = useState(full?.disposition || 'Pending');
  const [rootCause, setRootCause] = useState(full?.root_cause || '');
  const [correctiveAction, setCorrectiveAction] = useState(full?.corrective_action || '');
  const [assignedTo, setAssignedTo] = useState(full?.assigned_to || '');
  const [status, setStatus] = useState(existing?.status || 'Open');
  const [job, setJob] = useState<JobListItem | null>(
    jobs.find((j) => j.id === existing?.job_id) || null,
  );
  const [busy, setBusy] = useState(false);
  // The row/card passed in from the list only carries the summary fields
  // (title, category, severity, status…) — description, root cause,
  // corrective action, source, disposition and assigned-to are NOT in that
  // list payload. Without this fetch those fields render blank the moment
  // you reopen an existing NCR, and saving then overwrites the real values
  // with empty ones. Fetch the full record here and fill in the rest once
  // it arrives.
  const [loadingFull, setLoadingFull] = useState(isEdit);

  useEffect(() => {
    if (!isEdit || !existingId) return;
    let cancelled = false;
    setLoadingFull(true);
    getNCR(existingId)
      .then((n) => {
        if (cancelled) return;
        setTitle(n.title);
        setDescription(n.description || '');
        setCategory(n.category);
        setSeverity(n.severity);
        setSource(n.source);
        setDisposition(n.disposition);
        setRootCause(n.root_cause || '');
        setCorrectiveAction(n.corrective_action || '');
        setAssignedTo(n.assigned_to || '');
        setStatus(n.status);
        setJob(jobs.find((j) => j.id === n.job_id) || null);
      })
      .catch((e) => setError(apiError(e, 'Could not load the full NCR')))
      .finally(() => {
        if (!cancelled) setLoadingFull(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, existingId]);

  const valid = title.trim() && description.trim();

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const base = {
        title: title.trim(),
        description: description.trim(),
        category,
        severity,
        source,
        disposition,
        root_cause: rootCause.trim() || null,
        corrective_action: correctiveAction.trim() || null,
        assigned_to: assignedTo.trim() || null,
      };
      if (isEdit) {
        await updateNCR(existingId as number, {
          ...base,
          status,
          job_id: job ? job.id : 0, // 0 unlinks on the backend
        });
      } else {
        await createNCR({ ...base, ...(job ? { job_id: job.id } : {}) });
      }
      await onSaved();
    } catch (e) {
      setError(apiError(e, 'Could not save the NCR'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existingId) return;
    if (!window.confirm('Delete this NCR? This cannot be undone.')) return;
    setBusy(true);
    try {
      await deleteNCR(existingId);
      await onSaved();
    } catch (e) {
      setError(apiError(e, 'Could not delete the NCR'));
    } finally {
      setBusy(false);
    }
  };

  const sel = (label: string, value: string, set: (v: string) => void, opts: string[]) => (
    <TextField select label={label} size="small" fullWidth value={value} onChange={(e) => set(e.target.value)}>
      {opts.map((o) => (
        <MenuItem key={o} value={o}>
          {o}
        </MenuItem>
      ))}
    </TextField>
  );

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isEdit ? `Edit ${existing?.ncr_number}` : 'New NCR'}
      </DialogTitle>
      {loadingFull && <LinearProgress />}
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Title"
            size="small"
            fullWidth
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Autocomplete
            options={jobs}
            value={job}
            onChange={(_, v) => setJob(v)}
            getOptionLabel={(j) => `${j.job_number} · ${j.customer_name}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => (
              <TextField {...params} label="Linked job (optional)" size="small" />
            )}
          />
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              {sel('Category', category, setCategory, meta.categories)}
            </Grid>
            <Grid item xs={12} sm={6}>
              {sel('Severity', severity, setSeverity, meta.severities)}
            </Grid>
            <Grid item xs={12} sm={6}>
              {sel('Source', source, setSource, meta.sources)}
            </Grid>
            <Grid item xs={12} sm={6}>
              {sel('Disposition', disposition, setDisposition, meta.dispositions)}
            </Grid>
          </Grid>
          <TextField
            label="Description of non-conformance"
            size="small"
            fullWidth
            required
            multiline
            minRows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextField
            label="Root cause (optional)"
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
          />
          <TextField
            label="Corrective action (optional)"
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={correctiveAction}
            onChange={(e) => setCorrectiveAction(e.target.value)}
          />
          <Grid container spacing={2}>
            <Grid item xs={12} sm={isEdit ? 6 : 12}>
              <TextField
                label="Assigned to (optional)"
                size="small"
                fullWidth
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
              />
            </Grid>
            {isEdit && (
              <Grid item xs={12} sm={6}>
                {sel('Status', status, setStatus, meta.statuses)}
              </Grid>
            )}
          </Grid>
          {isEdit && full?.raised_by_name && (
            <Typography variant="caption" color="text.secondary">
              Raised by {full.raised_by_name}
              {full.closed_by_name ? ` · Closed by ${full.closed_by_name}` : ''}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
        <Box>
          {isEdit && canDelete && (
            <Button color="error" onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={busy || loadingFull || !valid}>
            {busy ? 'Saving…' : isEdit ? 'Save' : 'Raise NCR'}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
