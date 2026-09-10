import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Collapse,
  InputAdornment,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import { listJobs, fetchMeta, apiError } from '../api/client';
import { StatusBadge, STATUS_COLORS, fmtDay, dueInfo, EmptyState } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { JobListItem } from '../types';

interface CustomerGroup {
  key: string;
  name: string;
  jobs: JobListItem[];
}

// The closed-jobs lens. 'active' hides Closed jobs (the default working list),
// 'closed' shows only Closed jobs, 'all' shows everything.
type JobView = 'active' | 'closed' | 'all';

// Statuses that count as "closed" / archived. A job lands in the Closed view
// automatically the moment it reaches one of these — nothing to file by hand.
// Kept as a set so it's a one-line change if "Completed" should join later.
const CLOSED_STATUSES = new Set(['Closed']);
const isClosedJob = (j: JobListItem) => CLOSED_STATUSES.has(j.status);

// Newest first: by received date, then job number as a stable fallback.
function byRecency(a: JobListItem, b: JobListItem): number {
  const da = a.date_received ? Date.parse(a.date_received) : 0;
  const db = b.date_received ? Date.parse(b.date_received) : 0;
  if (da !== db) return db - da;
  return b.job_number.localeCompare(a.job_number, undefined, { numeric: true });
}

export default function Jobs() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { isClient } = useAuth();
  const isMobile = useDeviceType().isMobile;

  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Which customer folders are open. Keyed by the normalised customer name.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Free-text search. Persisted in the URL (like status/view/due) so that
  // leaving for a job's detail page and coming back — via the browser's own
  // history — restores exactly what was typed, instead of landing back on an
  // empty, unfiltered list.
  const search = params.get('q') || '';
  const setSearch = (v: string) => {
    if (v) params.set('q', v);
    else params.delete('q');
    setParams(params, { replace: true });
  };

  const statusFilter = params.get('status') || '';
  // Optional due-date lens, set by the dashboard tiles: 'overdue' | 'soon'.
  const dueFilter = params.get('due') || '';

  // Closed-jobs lens. Defaults to 'active' so the working list isn't packed
  // with finished jobs. Persisted in the URL like the other filters.
  const rawView = (params.get('view') || 'active').toLowerCase();
  const view: JobView = rawView === 'closed' || rawView === 'all' ? rawView : 'active';
  // When a specific status is chosen from the dropdown, that *is* the lens, so
  // the Active/Closed toggle steps aside (disabled) to avoid contradictions
  // like "Active" + status "Closed". It keeps showing the user's last choice.
  const viewLocked = !!statusFilter;
  const effectiveView: JobView = viewLocked ? 'all' : view;

  useEffect(() => {
    fetchMeta()
      .then((m) => setStatuses(m.statuses))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    listJobs(statusFilter || undefined)
      .then(setJobs)
      .catch((e) => setError(apiError(e, 'Failed to load jobs')))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  // Stage 1 — search + due lens. Closed-ness is applied separately (stage 2)
  // so the toggle's counts can reflect what's available under the same search.
  const baseFiltered = useMemo(() => {
    let list = jobs;
    // Due lens first (driven by the dashboard tiles).
    if (dueFilter === 'overdue' || dueFilter === 'soon') {
      list = list.filter((j) => {
        const done = j.status === 'Completed' || j.status === 'Closed';
        if (done || !j.due_date) return false;
        const { days } = dueInfo(j.due_date, done);
        return dueFilter === 'overdue' ? days < 0 : days >= 0 && days <= 7;
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (j) =>
        j.job_number.toLowerCase().includes(q) ||
        j.customer_name.toLowerCase().includes(q) ||
        (j.component_type || '').toLowerCase().includes(q) ||
        (j.po_number || '').toLowerCase().includes(q) ||
        (j.eq_number || '').toLowerCase().includes(q),
    );
  }, [jobs, search, dueFilter]);

  // Counts shown on the Active/Closed toggle (reflect the current search/due lens).
  const activeCount = useMemo(
    () => baseFiltered.filter((j) => !isClosedJob(j)).length,
    [baseFiltered],
  );
  const closedCount = useMemo(
    () => baseFiltered.filter(isClosedJob).length,
    [baseFiltered],
  );

  // Stage 2 — apply the closed-jobs lens.
  const filtered = useMemo(() => {
    if (effectiveView === 'active') return baseFiltered.filter((j) => !isClosedJob(j));
    if (effectiveView === 'closed') return baseFiltered.filter(isClosedJob);
    return baseFiltered;
  }, [baseFiltered, effectiveView]);

  // Group jobs into one folder per customer, alphabetical by name.
  const groups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    for (const j of filtered) {
      const name = (j.customer_name || 'Unassigned').trim() || 'Unassigned';
      const key = name.toLowerCase();
      const g = map.get(key);
      if (g) g.jobs.push(j);
      else map.set(key, { key, name, jobs: [j] });
    }
    const list = Array.from(map.values());
    list.forEach((g) => g.jobs.sort(byRecency));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [filtered]);

  const searching = search.trim().length > 0;
  // While searching, every matching folder is forced open so results show.
  // Otherwise a single customer opens by default; the rest start collapsed.
  const isOpen = (key: string) =>
    searching ? true : open[key] ?? groups.length === 1;

  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? groups.length === 1) }));

  const setAll = (value: boolean) =>
    setOpen(Object.fromEntries(groups.map((g) => [g.key, value])));

  const setStatus = (s: string) => {
    if (s) params.set('status', s);
    else params.delete('status');
    setParams(params, { replace: true });
  };

  const setView = (v: JobView) => {
    // 'active' is the default — keep it out of the URL so links stay tidy.
    if (v === 'active') params.delete('view');
    else params.set('view', v);
    setParams(params, { replace: true });
  };

  const clearDue = () => {
    params.delete('due');
    setParams(params, { replace: true });
  };

  const JobRows = ({ group }: { group: CustomerGroup }) =>
    isMobile ? (
      <Stack spacing={1.5} sx={{ p: 1.5, pt: 0.75 }}>
        {group.jobs.map((j) => (
          <Card
            key={j.id}
            variant="outlined"
            onClick={() => navigate(`/jobs/${j.id}`)}
            sx={{ p: 1.75, cursor: 'pointer', bgcolor: 'background.default' }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography fontWeight={800}>{j.job_number}</Typography>
              <StatusBadge status={j.status} />
            </Stack>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
              {j.component_type || (j.quantity ?? 1) > 1 ? (
                <Chip
                  label={`${j.component_type || 'Item'}${(j.quantity ?? 1) > 1 ? ` ×${j.quantity}` : ''}`}
                  size="small"
                  variant="outlined"
                />
              ) : (
                <span />
              )}
              <Stack direction="row" spacing={1} alignItems="center">
                {(() => {
                  const d = dueInfo(j.due_date, j.status === 'Completed' || j.status === 'Closed');
                  if (d.chip) return <Chip size="small" color={d.color} label={d.chip} />;
                  if (j.due_date)
                    return (
                      <Typography variant="caption" color="text.secondary">
                        Due {d.label}
                      </Typography>
                    );
                  return null;
                })()}
                <Typography variant="caption" color="text.secondary">
                  {fmtDay(j.date_received)}
                </Typography>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    ) : (
      <Table size="small" sx={{ '& td, & th': { borderColor: 'divider' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Job #</TableCell>
            <TableCell>Component</TableCell>
            <TableCell>Received</TableCell>
            <TableCell>Due</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {group.jobs.map((j) => (
            <TableRow
              key={j.id}
              hover
              onClick={() => navigate(`/jobs/${j.id}`)}
              sx={{ cursor: 'pointer' }}
            >
              <TableCell sx={{ fontWeight: 700 }}>{j.job_number}</TableCell>
              <TableCell>
                {j.component_type || (j.quantity ?? 1) > 1 ? (
                  <Chip
                    label={`${j.component_type || 'Item'}${(j.quantity ?? 1) > 1 ? ` ×${j.quantity}` : ''}`}
                    size="small"
                    variant="outlined"
                  />
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>{fmtDay(j.date_received)}</TableCell>
              <TableCell>
                {(() => {
                  const d = dueInfo(j.due_date, j.status === 'Completed' || j.status === 'Closed');
                  if (d.chip) return <Chip size="small" color={d.color} label={d.chip} />;
                  if (j.due_date) return d.label;
                  return '—';
                })()}
              </TableCell>
              <TableCell>
                <StatusBadge status={j.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Typography variant="h4" fontWeight={800} sx={{ fontSize: { xs: '1.6rem', sm: '2.125rem' } }}>
          Jobs
        </Typography>
        {!isClient && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/jobs/new')}
          >
            New Job
          </Button>
        )}
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          placeholder="Search by job number, customer, component, PO or EQ…"
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
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {statuses.map((s) => (
            <MenuItem key={s} value={s}>
              {s}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        sx={{ mb: 3 }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          disabled={viewLocked}
          onChange={(_, v) => v && setView(v)}
          sx={{ flexShrink: 0, '& .MuiToggleButton-root': { px: 2, textTransform: 'none', fontWeight: 700 } }}
        >
          <ToggleButton value="active">
            Active{activeCount ? ` · ${activeCount}` : ''}
          </ToggleButton>
          <ToggleButton value="closed">
            Closed{closedCount ? ` · ${closedCount}` : ''}
          </ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
        {viewLocked ? (
          <Typography variant="caption" color="text.secondary">
            Showing the “{statusFilter}” status — clear it to switch between Active and Closed.
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {view === 'closed'
              ? 'Closed jobs only — finished jobs land here automatically.'
              : view === 'all'
              ? 'Showing active and closed jobs together.'
              : 'Closed jobs are tucked away — tap “Closed” to see the archive.'}
          </Typography>
        )}
      </Stack>

      {dueFilter && (
        <Stack direction="row" sx={{ mb: 2 }}>
          <Chip
            color={dueFilter === 'overdue' ? 'error' : 'warning'}
            variant="outlined"
            label={
              dueFilter === 'overdue'
                ? 'Showing overdue jobs'
                : 'Showing jobs due within 7 days'
            }
            onDelete={clearDue}
          />
        </Stack>
      )}

      {!loading && !error && groups.length > 0 && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={1}
          sx={{ mb: 1.5 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, alignSelf: 'center' }}>
            {groups.length} customer{groups.length === 1 ? '' : 's'} · {filtered.length} job
            {filtered.length === 1 ? '' : 's'}
          </Typography>
          <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-end', sm: 'flex-start' }}>
            <Button size="small" startIcon={<UnfoldMoreIcon />} onClick={() => setAll(true)} disabled={searching}>
              Expand all
            </Button>
            <Button size="small" startIcon={<UnfoldLessIcon />} onClick={() => setAll(false)} disabled={searching}>
              Collapse all
            </Button>
          </Stack>
        </Stack>
      )}

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Typography color="error">{error}</Typography>
      ) : groups.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<WorkOutlineIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
            title="No jobs found"
            subtitle={
              dueFilter === 'overdue'
                ? 'No overdue jobs — nicely on top of it.'
                : dueFilter === 'soon'
                ? 'Nothing due in the next 7 days.'
                : statusFilter
                ? `No jobs with status "${statusFilter}".`
                : search.trim()
                ? 'No jobs match your search.'
                : effectiveView === 'closed'
                ? 'No closed jobs yet — finished jobs will land here automatically.'
                : effectiveView === 'active'
                ? 'No active jobs right now. Check the Closed view for finished work.'
                : 'Create your first job to get started.'
            }
          />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {groups.map((g) => {
            const expanded = isOpen(g.key);
            return (
              <Card key={g.key} sx={{ overflow: 'hidden' }}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                  onClick={() => !searching && toggle(g.key)}
                  sx={{
                    px: 2,
                    py: 1.5,
                    cursor: searching ? 'default' : 'pointer',
                    userSelect: 'none',
                    '&:hover': searching ? {} : { bgcolor: 'action.hover' },
                  }}
                >
                  <Box
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: '9px',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                      color: 'primary.main',
                      bgcolor: (t) => `${t.palette.primary.main}1c`,
                    }}
                  >
                    {expanded ? (
                      <FolderOpenOutlinedIcon sx={{ fontSize: 19 }} />
                    ) : (
                      <FolderOutlinedIcon sx={{ fontSize: 19 }} />
                    )}
                  </Box>
                  <Typography fontWeight={800} sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                    {g.name}
                  </Typography>
                  {!searching && (
                    <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.5, flexShrink: 0 }}>
                      {Array.from(new Set(g.jobs.map((j) => j.status)))
                        .slice(0, 6)
                        .map((status) => (
                          <Box
                            key={status}
                            title={status}
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              bgcolor: STATUS_COLORS[status] || '#94a3b8',
                            }}
                          />
                        ))}
                    </Box>
                  )}
                  <Chip label={g.jobs.length} size="small" sx={{ fontWeight: 700 }} />
                  <ExpandMoreIcon
                    sx={{
                      transition: 'transform 0.2s',
                      transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                      color: 'text.secondary',
                    }}
                  />
                </Stack>
                <Collapse in={expanded} unmountOnExit>
                  <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
                    <JobRows group={g} />
                  </Box>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
