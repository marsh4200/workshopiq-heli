import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import QrCodeIcon from '@mui/icons-material/QrCode2';
import PrintIcon from '@mui/icons-material/Print';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import WorkIcon from '@mui/icons-material/Engineering';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  deleteInspectionReport,
  generateInspectionReport,
  getInspectionReport,
  inspectionReportFormUrl,
  listInspectionReports,
  listJobs,
  openBlankInspectionReport,
} from '../api/client';
import { PageHeader, EmptyState, fmtDate } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import { printQrSheet } from '../utils/platform';
import type { InspectionReportDetail, InspectionReportItem, JobListItem } from '../types';

interface CustomerGroup {
  key: string;
  name: string;
  reports: InspectionReportItem[];
}

// Newest first: by submitted/created date, then certificate number as a
// stable fallback.
function byRecency(a: InspectionReportItem, b: InspectionReportItem): number {
  const da = Date.parse(a.submitted_at || a.created_at || '') || 0;
  const db = Date.parse(b.submitted_at || b.created_at || '') || 0;
  if (da !== db) return db - da;
  return (b.certificate_number || '').localeCompare(a.certificate_number || '', undefined, {
    numeric: true,
  });
}

function StatusChip({ r }: { r: InspectionReportItem }) {
  const color = r.submitted ? '#22c55e' : '#f59e0b';
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
      <Chip
        label={r.submitted ? 'Filed' : 'Pending'}
        size="small"
        sx={{ bgcolor: `${color}1f`, color, fontWeight: 600, borderRadius: 1 }}
      />
      {r.client_signed && (
        <Chip
          label="Client signed"
          size="small"
          sx={{ bgcolor: '#3b82f61f', color: '#3b82f6', fontWeight: 600, borderRadius: 1 }}
        />
      )}
    </Stack>
  );
}

// Landing tile for the Open/Submitted split below — same look as the Settings
// page tiles, so the "pick a category first" pattern feels consistent across
// the app.
function ViewTile({
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

export default function InspectionReports() {
  const { isAdmin } = useAuth();
  const isMobile = useDeviceType().isMobile;
  const navigate = useNavigate();

  const [reports, setReports] = useState<InspectionReportItem[]>([]);
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [genOpen, setGenOpen] = useState(false);
  const [job, setJob] = useState<JobListItem | null>(null);
  const [genDrawingNumber, setGenDrawingNumber] = useState('');
  const [genQcpNo, setGenQcpNo] = useState('');
  const [genQuantity, setGenQuantity] = useState('');
  const [generating, setGenerating] = useState(false);
  const [qr, setQr] = useState<InspectionReportDetail | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await listInspectionReports());
    } catch (e) {
      setToast(apiError(e, 'Could not load reports'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    listJobs().then(setJobs).catch(() => undefined);
  }, [load]);

  const handleGenerate = async () => {
    if (!job) return;
    setGenerating(true);
    try {
      const detail = await generateInspectionReport(job.id, {
        drawing_number: genDrawingNumber.trim() || undefined,
        qcp_no: genQcpNo.trim() || undefined,
        quantity: genQuantity.trim() || undefined,
      });
      setQr(detail);
      setGenOpen(false);
      setJob(null);
      setGenDrawingNumber('');
      setGenQcpNo('');
      setGenQuantity('');
      await load();
    } catch (e) {
      setToast(apiError(e, 'Could not generate report'));
    } finally {
      setGenerating(false);
    }
  };

  const showQr = async (r: InspectionReportItem) => {
    // Show the dialog immediately with the link, then fill in the QR image
    // once it comes back — the list endpoint doesn't carry qr_png, only
    // GET /inspection-reports/{id} regenerates it.
    setQr({ ...r, url: inspectionReportFormUrl(r.token), qr_png: '' } as InspectionReportDetail);
    try {
      const detail = await getInspectionReport(r.id);
      setQr(detail);
    } catch (e) {
      setToast(apiError(e, 'Could not load QR code'));
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => setToast('Link copied'),
      () => setToast('Copy failed'),
    );
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteInspectionReport(id);
      setToast('Pending report removed');
      await load();
    } catch (e) {
      setToast(apiError(e, 'Could not remove'));
    }
  };

  const pendingCount = useMemo(() => reports.filter((r) => !r.submitted).length, [reports]);
  const filedCount = reports.length - pendingCount;

  // Landing view: pick "open" (not yet filled in) or "closed" (submitted)
  // before seeing any reports — same click-a-tile-first pattern as Settings.
  const [view, setView] = useState<'open' | 'closed' | null>(null);

  // Which customer folders are open. Keyed by the normalised customer name —
  // same folder-per-customer pattern as the Jobs page.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const groups = useMemo<CustomerGroup[]>(() => {
    const scoped = reports.filter((r) => (view === 'closed' ? r.submitted : !r.submitted));
    const map = new Map<string, CustomerGroup>();
    for (const r of scoped) {
      const name = (r.customer_name || 'Unassigned').trim() || 'Unassigned';
      const key = name.toLowerCase();
      const g = map.get(key);
      if (g) g.reports.push(r);
      else map.set(key, { key, name, reports: [r] });
    }
    const list = Array.from(map.values());
    list.forEach((g) => g.reports.sort(byRecency));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [reports, view]);

  // A single customer opens by default; the rest start collapsed.
  const isOpen = (key: string) => open[key] ?? groups.length === 1;
  const toggle = (key: string) =>
    setOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? groups.length === 1) }));
  const setAll = (value: boolean) =>
    setOpen(Object.fromEntries(groups.map((g) => [g.key, value])));

  const ReportRows = ({ group }: { group: CustomerGroup }) =>
    isMobile ? (
      <Stack spacing={1.5} sx={{ p: 1.5, pt: 0.75 }}>
        {group.reports.map((r) => (
          <Card key={r.id} variant="outlined" sx={{ p: 1.75, bgcolor: 'background.default' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography sx={{ fontWeight: 700 }}>{r.certificate_number}</Typography>
              <StatusChip r={r} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {r.job_number}
            </Typography>
            {r.submitted ? (
              <Typography variant="caption" color="text.secondary">
                {r.inspector_name} · {fmtDate(r.submitted_at)}
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Created {fmtDate(r.created_at)}
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
              {r.submitted ? (
                <Button size="small" startIcon={<WorkIcon />} onClick={() => navigate(`/jobs/${r.job_id}`)}>
                  Open job
                </Button>
              ) : (
                <>
                  <Button
                    size="small"
                    startIcon={<QrCodeIcon />}
                    onClick={() => showQr(r)}
                  >
                    QR
                  </Button>
                  <Button
                    size="small"
                    startIcon={<OpenInNewIcon />}
                    onClick={() => window.open(inspectionReportFormUrl(r.token), '_blank')}
                  >
                    Fill
                  </Button>
                  {isAdmin && (
                    <IconButton size="small" color="error" onClick={() => handleDelete(r.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </>
              )}
            </Stack>
          </Card>
        ))}
      </Stack>
    ) : (
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Certificate</TableCell>
            <TableCell>Job</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Inspector</TableCell>
            <TableCell>Date</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {group.reports.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell sx={{ fontWeight: 600 }}>{r.certificate_number}</TableCell>
              <TableCell>{r.job_number}</TableCell>
              <TableCell>
                <StatusChip r={r} />
              </TableCell>
              <TableCell>{r.inspector_name || '—'}</TableCell>
              <TableCell>{fmtDate(r.submitted_at || r.created_at)}</TableCell>
              <TableCell align="right">
                {r.submitted ? (
                  <Tooltip title="Open job (report is in documents)">
                    <IconButton size="small" onClick={() => navigate(`/jobs/${r.job_id}`)}>
                      <WorkIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <>
                    <Tooltip title="Show QR code">
                      <IconButton size="small" onClick={() => showQr(r)}>
                        <QrCodeIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Fill on screen">
                      <IconButton
                        size="small"
                        onClick={() => window.open(inspectionReportFormUrl(r.token), '_blank')}
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {isAdmin && (
                      <Tooltip title="Remove pending report">
                        <IconButton size="small" color="error" onClick={() => handleDelete(r.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );

  return (
    <Box>
      <PageHeader
        eyebrow="Quality"
        title="Inspection Reports"
        subtitle="Generate a QR per job. Scan it to fill in the inspection report online — it files straight to the job's documents."
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={() => openBlankInspectionReport().catch((e) => setToast(apiError(e)))}
            >
              Print blank
            </Button>
            <Button variant="contained" startIcon={<QrCodeIcon />} onClick={() => setGenOpen(true)}>
              Generate QR
            </Button>
          </>
        }
      />

      {view && (
        <Button startIcon={<ArrowBackIcon />} onClick={() => setView(null)} sx={{ mb: 2 }}>
          Back to Inspection Reports
        </Button>
      )}

      {!loading && view && groups.length > 0 && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={1}
          sx={{ mb: 1.5 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1, alignSelf: 'center' }}>
            {groups.length} customer{groups.length === 1 ? '' : 's'} ·{' '}
            {view === 'open' ? pendingCount : filedCount} {view === 'open' ? 'open' : 'submitted'} report
            {(view === 'open' ? pendingCount : filedCount) === 1 ? '' : 's'}
          </Typography>
          <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-end', sm: 'flex-start' }}>
            <Button size="small" startIcon={<UnfoldMoreIcon />} onClick={() => setAll(true)}>
              Expand all
            </Button>
            <Button size="small" startIcon={<UnfoldLessIcon />} onClick={() => setAll(false)}>
              Collapse all
            </Button>
          </Stack>
        </Stack>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : !view ? (
        reports.length === 0 ? (
          <Card sx={{ p: 2 }}>
            <EmptyState
              icon={<FactCheckIcon sx={{ fontSize: 44, opacity: 0.5 }} />}
              title="No inspection reports yet"
              subtitle="Generate a QR code for a job to get started."
            />
          </Card>
        ) : (
          <Grid container spacing={2}>
            <ViewTile
              icon={<PendingActionsOutlinedIcon />}
              title="Open Inspection Reports"
              subtitle={
                pendingCount > 0 ? `${pendingCount} not yet filled in` : 'None waiting — all caught up'
              }
              badge={
                pendingCount > 0 ? (
                  <Chip
                    size="small"
                    label={pendingCount}
                    sx={{ bgcolor: '#f59e0b1f', color: '#f59e0b', fontWeight: 700 }}
                  />
                ) : undefined
              }
              onClick={() => setView('open')}
            />
            <ViewTile
              icon={<TaskAltOutlinedIcon />}
              title="Submitted Inspection Reports"
              subtitle={filedCount > 0 ? `${filedCount} filed` : 'None filed yet'}
              onClick={() => setView('closed')}
            />
          </Grid>
        )
      ) : groups.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<FactCheckIcon sx={{ fontSize: 44, opacity: 0.5 }} />}
            title={view === 'open' ? 'No open reports' : 'No submitted reports yet'}
            subtitle={
              view === 'open'
                ? 'Every generated report has been filled in and filed.'
                : 'Reports show up here once they’ve been filled in and filed.'
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
                  onClick={() => toggle(g.key)}
                  sx={{
                    px: 2,
                    py: 1.5,
                    cursor: 'pointer',
                    userSelect: 'none',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ color: 'primary.main', display: 'flex' }}>
                    {expanded ? <FolderOpenOutlinedIcon /> : <FolderOutlinedIcon />}
                  </Box>
                  <Typography fontWeight={800} sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                    {g.name}
                  </Typography>
                  {g.reports.some((r) => !r.submitted) && (
                    <Chip
                      label={`${g.reports.filter((r) => !r.submitted).length} pending`}
                      size="small"
                      sx={{ bgcolor: '#f59e0b1f', color: '#f59e0b', fontWeight: 700 }}
                    />
                  )}
                  <Chip label={g.reports.length} size="small" sx={{ fontWeight: 700 }} />
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
                    <ReportRows group={g} />
                  </Box>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* Generate dialog */}
      <Dialog open={genOpen} onClose={() => setGenOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Generate inspection report QR</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Pick the job this report belongs to. A new certificate number is assigned
            automatically, and the QR files the completed report into that job's documents.
          </Typography>
          <Autocomplete
            options={jobs}
            value={job}
            onChange={(_, v) => setJob(v)}
            getOptionLabel={(j) => `${j.job_number} · ${j.customer_name}`}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={(params) => <TextField {...params} label="Job" autoFocus />}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2.5, mb: 1 }}>
            Optional — shown on the form but locked, so the person filling it in on site
            can't accidentally change them.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Drawing number"
              value={genDrawingNumber}
              onChange={(e) => setGenDrawingNumber(e.target.value)}
              fullWidth
            />
            <TextField
              label="QCP no"
              value={genQcpNo}
              onChange={(e) => setGenQcpNo(e.target.value)}
              fullWidth
            />
            <TextField
              label="Quantity"
              value={genQuantity}
              onChange={(e) => setGenQuantity(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!job || generating} onClick={handleGenerate}>
            {generating ? 'Generating…' : 'Generate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* QR result dialog */}
      <Dialog open={!!qr} onClose={() => setQr(null)} fullWidth maxWidth="xs">
        <DialogTitle>{qr?.certificate_number}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {qr?.job_number} · {qr?.customer_name}
          </Typography>
          {qr?.qr_png ? (
            <Box
              component="img"
              src={qr.qr_png}
              alt="QR code"
              sx={{ width: '100%', maxWidth: 260, display: 'block', mx: 'auto', borderRadius: 2, bgcolor: '#fff', p: 1 }}
            />
          ) : (
            <Box sx={{ textAlign: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          <Typography
            variant="caption"
            sx={{ display: 'block', mt: 2, wordBreak: 'break-all', color: 'text.secondary' }}
          >
            {qr?.url}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              startIcon={<OpenInNewIcon />}
              onClick={() => qr && window.open(qr.url, '_blank')}
            >
              Fill on screen
            </Button>
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => qr && copyLink(qr.url)}>
              Copy link
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<PrintIcon />}
              disabled={!qr?.qr_png}
              onClick={() =>
                qr &&
                qr.qr_png &&
                printQrSheet({
                  title: qr.certificate_number,
                  subtitle: `${qr.job_number} · ${qr.customer_name}`,
                  qrPng: qr.qr_png,
                  caption: 'Scan to fill the inspection report · WorkshopIQ',
                })
              }
            >
              Print QR
            </Button>
            <Button
              size="small"
              startIcon={<PrintIcon />}
              onClick={() => openBlankInspectionReport().catch((e) => setToast(apiError(e)))}
            >
              Print blank
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQr(null)}>Done</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!toast}
        autoHideDuration={3000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
