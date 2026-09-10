import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import BorderColorOutlinedIcon from '@mui/icons-material/BorderColorOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import StarBorderIcon from '@mui/icons-material/StarBorderPurple500';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import WorkIcon from '@mui/icons-material/Engineering';
import ArrowForwardIcon from '@mui/icons-material/ArrowForwardIos';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import PrecisionManufacturingOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import { useNavigate } from 'react-router-dom';
import {
  apiError,
  downloadJobPack,
  getPendingReviews,
  listJobs,
  listMyInspectionReports,
  signInspectionReport,
} from '../api/client';
import { EmptyState, STATUS_COLORS, StatusBadge, fmtDay } from '../components/common';
import SignaturePad from '../components/SignaturePad';
import ReviewDialog from '../components/ReviewDialog';
import { useAuth } from '../context/AuthContext';
import { fontDisplay, fontMono } from '../theme/theme';
import type { InspectionReportItem, JobListItem, PendingReview } from '../types';

const SIGN_COLOR = '#f59e0b';
const REVIEW_COLOR = '#3b82f6';
const FINISHED_STATUSES = new Set(['Completed', 'Awaiting Customer Review', 'Closed']);

/** One-line human description of a job from the list payload we already have. */
function jobBlurb(j: JobListItem): string {
  const bits: string[] = [];
  if (j.component_type) bits.push(j.component_type);
  if (j.quantity && j.quantity > 1) bits.push(`Qty ${j.quantity}`);
  if (!bits.length && j.po_number) bits.push(`PO ${j.po_number}`);
  return bits.join(' · ') || 'Workshop job';
}

/** The pipeline stages shown on the progress rail (a failed/awaiting-review
 * job still maps onto one of these so every job reads on the same scale). */
const STAGES = ['Received', 'Machining', 'Inspection', 'Completed', 'Closed'];

function stageIndex(status: string): number {
  switch (status) {
    case 'Received':
      return 0;
    case 'Machining':
      return 1;
    case 'Inspection':
    case 'Inspection Failed':
      return 2;
    case 'Completed':
    case 'Awaiting Customer Review':
      return 3;
    case 'Closed':
      return 4;
    default:
      return 0;
  }
}

/** Slim animated progress rail — dots for each pipeline stage, filled in up
 * to the job's current position. A quick, glanceable "how far along is this"
 * without needing to open the job. */
function JobStageRail({ status }: { status: string }) {
  const idx = stageIndex(status);
  const failed = status === 'Inspection Failed';
  const color = STATUS_COLORS[status] || '#94a3b8';
  return (
    <Stack direction="row" alignItems="center" sx={{ width: '100%', py: 0.25 }}>
      {STAGES.map((label, i) => {
        const done = i < idx;
        const current = i === idx;
        const isFailNode = current && failed;
        const dotColor = isFailNode ? '#f43f5e' : done ? '#22c55e' : current ? color : undefined;
        return (
          <Box key={label} sx={{ display: 'flex', alignItems: 'center', flex: i < STAGES.length - 1 ? 1 : '0 0 auto' }}>
            <Tooltip title={isFailNode ? 'Inspection failed — rework in progress' : label} arrow>
              <Box
                sx={{
                  width: current ? 12 : 8,
                  height: current ? 12 : 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  bgcolor: dotColor || 'action.disabledBackground',
                  boxShadow: current ? `0 0 0 4px ${alpha(dotColor || color, 0.22)}` : 'none',
                  transition: 'all .25s ease',
                }}
              />
            </Tooltip>
            {i < STAGES.length - 1 && (
              <Box
                sx={{
                  flex: 1,
                  height: 3,
                  mx: 0.5,
                  borderRadius: 2,
                  bgcolor: i < idx ? alpha('#22c55e', 0.55) : 'divider',
                  transition: 'all .3s ease',
                }}
              />
            )}
          </Box>
        );
      })}
    </Stack>
  );
}

/** Ring progress used in the hero — how many of the client's jobs are done. */
function ProgressRing({
  percent,
  size = 108,
  stroke = 10,
  value,
  label,
}: {
  percent: number;
  size?: number;
  stroke?: number;
  value: string;
  label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, percent)) / 100) * c;
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <defs>
          <linearGradient id="clientHomeRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#clientHomeRingGrad)"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', px: 1 }}>
        <Box>
          <Typography sx={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: '1.5rem', lineHeight: 1 }}>
            {value}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.1, display: 'block', mt: 0.25 }}>
            {label}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Client landing page. Built around two questions the client actually has:
 * "what needs me?" (sign a report, leave a review) and "how's my job going?".
 * The hero up top answers both at a glance — an overall completion ring plus
 * the two action tiles — and the job cards below carry a live pipeline rail
 * and, once a job is finished, a one-tap download of everything filed on it.
 */
export default function ClientHome() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [reports, setReports] = useState<InspectionReportItem[]>([]);
  const [pendingReviews, setPendingReviews] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState('');
  const [packBusy, setPackBusy] = useState<number | null>(null);

  // Sign dialog
  const [signTarget, setSignTarget] = useState<InspectionReportItem | null>(null);
  const [signName, setSignName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [padKey, setPadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  // Review dialog
  const [reviewTarget, setReviewTarget] = useState<PendingReview | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, r, pr] = await Promise.all([
        listJobs(),
        listMyInspectionReports(),
        getPendingReviews(),
      ]);
      setJobs(j);
      setReports(r);
      setPendingReviews(pr);
    } catch (e) {
      setToast(apiError(e, 'Could not load your workshop'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reportsByJob = useMemo(() => {
    const m = new Map<number, InspectionReportItem[]>();
    for (const r of reports) {
      const arr = m.get(r.job_id) || [];
      arr.push(r);
      m.set(r.job_id, arr);
    }
    return m;
  }, [reports]);

  const reviewByJob = useMemo(() => {
    const m = new Map<number, PendingReview>();
    for (const p of pendingReviews) m.set(p.job_id, p);
    return m;
  }, [pendingReviews]);

  const signCount = useMemo(() => reports.filter((r) => !r.client_signed).length, [reports]);
  const reviewCount = pendingReviews.length;

  const jobHasSign = (id: number) => (reportsByJob.get(id) || []).some((r) => !r.client_signed);
  const jobHasReview = (id: number) => reviewByJob.has(id);
  const jobNeedsAction = (id: number) => jobHasSign(id) || jobHasReview(id);

  const { active, closed } = useMemo(() => {
    const a = jobs.filter((j) => j.status !== 'Closed');
    const c = jobs.filter((j) => j.status === 'Closed');
    // Float jobs that need the client's attention to the top of the active list.
    a.sort((x, y) => Number(jobNeedsAction(y.id)) - Number(jobNeedsAction(x.id)));
    return { active: a, closed: c };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, reportsByJob, reviewByJob]);

  const doneCount = useMemo(
    () => jobs.filter((j) => FINISHED_STATUSES.has(j.status)).length,
    [jobs],
  );
  const donePercent = jobs.length ? Math.round((doneCount / jobs.length) * 100) : 0;

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const openSign = (r: InspectionReportItem) => {
    setSignTarget(r);
    setSignName((user?.full_name || '').trim());
    setSignature(null);
    setPadKey((k) => k + 1);
  };

  const submitSign = async () => {
    if (!signTarget) return;
    const typed = signName.trim();
    if (!typed && !signature) {
      setToast('Type your name or draw your signature');
      return;
    }
    setSaving(true);
    try {
      await signInspectionReport(signTarget.id, { signed_name: typed, signature_png: signature });
      setToast(`${signTarget.certificate_number} signed`);
      setSignTarget(null);
      await load();
    } catch (e) {
      setToast(apiError(e, 'Could not submit signature'));
    } finally {
      setSaving(false);
    }
  };

  const handlePack = async (job: JobListItem) => {
    setPackBusy(job.id);
    try {
      await downloadJobPack(job.id, job.job_number);
    } catch (e) {
      setToast(apiError(e, 'Could not download the job pack'));
    } finally {
      setPackBusy(null);
    }
  };

  const firstName = (user?.full_name || user?.username || '').split(' ')[0];

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );

  const totalAction = signCount + reviewCount;

  const NeedsCard = ({
    color,
    icon,
    count,
    label,
    caption,
    to,
  }: {
    color: string;
    icon: React.ReactNode;
    count: number;
    label: string;
    caption: string;
    to: string;
  }) => {
    const isActive = count > 0;
    return (
      <Card
        sx={{
          bgcolor: isActive ? alpha(color, 0.08) : alpha('#ffffff', 0.02),
          borderColor: isActive ? alpha(color, 0.35) : undefined,
          height: '100%',
          '&:hover': { borderColor: alpha(color, 0.5) },
        }}
      >
        <CardActionArea onClick={() => navigate(to)} sx={{ borderRadius: 'inherit', height: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, height: '100%' }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                color: isActive ? color : 'text.disabled',
                bgcolor: isActive ? alpha(color, 0.16) : 'action.hover',
                '& svg': { fontSize: 24 },
              }}
            >
              {isActive ? icon : <CheckCircleOutlineIcon />}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {isActive ? `${count} ${label}` : `No ${label}`}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {isActive ? caption : "You're all caught up"}
              </Typography>
            </Box>
            <ArrowForwardIcon sx={{ fontSize: 16, color: 'text.disabled', flexShrink: 0 }} />
          </Box>
        </CardActionArea>
      </Card>
    );
  };

  const JobFolder = ({ job }: { job: JobListItem }) => {
    const isOpen = open.has(job.id);
    const jobReports = reportsByJob.get(job.id) || [];
    const needsSign = jobHasSign(job.id);
    const needsReview = jobHasReview(job.id);
    const review = reviewByJob.get(job.id);
    const finished = FINISHED_STATUSES.has(job.status);
    const color = STATUS_COLORS[job.status] || '#94a3b8';
    const busy = packBusy === job.id;

    return (
      <Card
        variant="outlined"
        sx={{
          overflow: 'hidden',
          borderColor: needsSign
            ? alpha(SIGN_COLOR, 0.4)
            : needsReview
              ? alpha(REVIEW_COLOR, 0.4)
              : undefined,
          transition: 'transform .18s ease, box-shadow .18s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            boxShadow: `0 14px 30px -20px ${alpha(color, 0.6)}`,
          },
        }}
      >
        <Box sx={{ height: 3, background: `linear-gradient(90deg, ${color}, ${alpha(color, 0.25)})` }} />

        <Box
          onClick={() => toggle(job.id)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1.5,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color,
              bgcolor: alpha(color, 0.14),
              '& svg': { fontSize: 20 },
            }}
          >
            {isOpen ? <FolderOpenOutlinedIcon /> : <PrecisionManufacturingOutlinedIcon />}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography sx={{ fontFamily: fontMono, fontWeight: 700 }} noWrap>
                {job.job_number}
              </Typography>
              {needsSign && (
                <Chip
                  size="small"
                  label="Sign"
                  sx={{ height: 20, bgcolor: alpha(SIGN_COLOR, 0.14), color: SIGN_COLOR, fontWeight: 700 }}
                />
              )}
              {needsReview && (
                <Chip
                  size="small"
                  label="Review"
                  sx={{ height: 20, bgcolor: alpha(REVIEW_COLOR, 0.14), color: REVIEW_COLOR, fontWeight: 700 }}
                />
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" noWrap>
              {jobBlurb(job)}
            </Typography>
          </Box>
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <StatusBadge status={job.status} />
          </Box>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {finished && (
              <Tooltip title="Download everything filed on this job — report, photos and documents">
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<Inventory2OutlinedIcon />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePack(job);
                    }}
                    disabled={busy}
                    sx={{
                      whiteSpace: 'nowrap',
                      background: 'linear-gradient(135deg, #22c55e, #0ea5e9)',
                      color: '#04150c',
                      fontWeight: 700,
                      '&:hover': { background: 'linear-gradient(135deg, #16a34a, #0284c7)' },
                    }}
                  >
                    {busy ? 'Packing…' : 'Job Pack'}
                  </Button>
                </span>
              </Tooltip>
            )}
            <Button
              size="small"
              variant="outlined"
              startIcon={<WorkIcon />}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/jobs/${job.id}`);
              }}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Open
            </Button>
          </Stack>
          <ExpandMoreIcon
            sx={{
              color: 'text.secondary',
              transition: 'transform 0.2s',
              transform: isOpen ? 'rotate(180deg)' : 'none',
              display: { xs: 'none', sm: 'block' },
            }}
          />
        </Box>

        <Box sx={{ px: 2, pb: 1.25 }}>
          <JobStageRail status={job.status} />
        </Box>

        <Collapse in={isOpen} unmountOnExit>
          <Divider />
          <Box sx={{ px: 2, py: 1.5 }}>
            <Box sx={{ display: { xs: 'flex', md: 'none' }, mb: 1.5 }}>
              <StatusBadge status={job.status} />
            </Box>

            {/* Inspection reports for this job */}
            <Typography variant="overline" color="text.secondary">
              Inspection reports
            </Typography>
            {jobReports.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 0.5 }}>
                None filed on this job yet.
              </Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 0.5 }}>
                {jobReports.map((r) => (
                  <Stack
                    key={r.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <FactCheckOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                        {r.certificate_number}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Filed {fmtDay(r.submitted_at)}
                        {r.inspector_name ? ` · ${r.inspector_name}` : ''}
                      </Typography>
                    </Box>
                    {r.client_signed ? (
                      <Chip
                        size="small"
                        icon={<CheckCircleOutlineIcon />}
                        label="Signed"
                        sx={{ bgcolor: '#22c55e1f', color: '#22c55e', fontWeight: 700 }}
                      />
                    ) : (
                      <Button
                        size="small"
                        variant="contained"
                        color="warning"
                        startIcon={<BorderColorOutlinedIcon />}
                        onClick={() => openSign(r)}
                      >
                        Sign now
                      </Button>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}

            {/* Review action */}
            {needsReview && review && (
              <>
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
                  <StarBorderIcon sx={{ fontSize: 20, color: REVIEW_COLOR }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
                    How did we do on this job?
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<StarBorderIcon />}
                    onClick={() => setReviewTarget(review)}
                  >
                    Leave review
                  </Button>
                </Stack>
              </>
            )}

            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary">
              Received {fmtDay(job.date_received)}
              {job.due_date ? ` · Due ${fmtDay(job.due_date)}` : ''}
            </Typography>
          </Box>
        </Collapse>
      </Card>
    );
  };

  return (
    <Box>
      {/* Hero */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          p: { xs: 2.5, sm: 3.5 },
          mb: 3,
          background: (t) =>
            t.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(37,99,235,0.16), rgba(34,211,238,0.05) 55%, transparent)'
              : 'linear-gradient(135deg, rgba(37,99,235,0.10), rgba(34,211,238,0.04) 55%, transparent)',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            width: 320,
            height: 320,
            borderRadius: '50%',
            top: -160,
            right: -120,
            background: 'radial-gradient(circle, rgba(59,130,246,0.22), transparent 70%)',
            pointerEvents: 'none',
          }}
        />
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={{ xs: 3, md: 4 }}
          alignItems={{ md: 'center' }}
          justifyContent="space-between"
          sx={{ position: 'relative' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ color: 'primary.main' }}>
              Your workshop
            </Typography>
            <Typography
              sx={{
                fontFamily: fontDisplay,
                fontWeight: 800,
                fontSize: { xs: '1.75rem', sm: '2.25rem' },
                lineHeight: 1.1,
              }}
            >
              Welcome back{firstName ? `, ${firstName}` : ''}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 480 }}>
              {totalAction > 0
                ? `You have ${totalAction} thing${totalAction === 1 ? '' : 's'} waiting for you.`
                : 'Everything is up to date. Browse your jobs below.'}
            </Typography>
          </Box>

          {jobs.length > 0 && (
            <Box sx={{ flexShrink: 0, display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' } }}>
              <ProgressRing percent={donePercent} value={`${doneCount}/${jobs.length}`} label="jobs finished" />
            </Box>
          )}
        </Stack>

        <Grid container spacing={2} sx={{ mt: { xs: 0.5, sm: 1 }, position: 'relative' }}>
          <Grid item xs={12} sm={6}>
            <NeedsCard
              color={SIGN_COLOR}
              icon={<BorderColorOutlinedIcon />}
              count={signCount}
              label={signCount === 1 ? 'report to sign' : 'reports to sign'}
              caption="Tap to review and sign"
              to="/inspection-reports"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <NeedsCard
              color={REVIEW_COLOR}
              icon={<StarBorderIcon />}
              count={reviewCount}
              label={reviewCount === 1 ? 'job to review' : 'jobs to review'}
              caption="Tap to rate your finished jobs"
              to="/reviews"
            />
          </Grid>
        </Grid>
      </Box>

      {jobs.length === 0 ? (
        <Card sx={{ p: 2, mt: 2 }}>
          <EmptyState
            icon={<FolderOutlinedIcon sx={{ fontSize: 44, opacity: 0.5 }} />}
            title="No jobs yet"
            subtitle="When the workshop opens a job for you, it will appear here as a folder you can open."
          />
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Active jobs ({active.length})
              </Typography>
              <Stack spacing={1.25}>
                {active.map((j) => (
                  <JobFolder key={j.id} job={j} />
                ))}
              </Stack>
            </Box>
          )}

          {closed.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Closed jobs ({closed.length})
              </Typography>
              <Stack spacing={1.25}>
                {closed.map((j) => (
                  <JobFolder key={j.id} job={j} />
                ))}
              </Stack>
            </Box>
          )}
        </>
      )}

      {/* Sign dialog */}
      <Dialog open={!!signTarget} onClose={() => !saving && setSignTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Sign {signTarget?.certificate_number}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {signTarget?.job_number} · confirming you've reviewed and accept this inspection report.
          </Typography>
          <TextField
            label="Your name"
            fullWidth
            value={signName}
            onChange={(e) => setSignName(e.target.value)}
            sx={{ mb: 2 }}
            autoFocus
          />
          <Divider sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Signature
            </Typography>
          </Divider>
          <SignaturePad key={padKey} onChange={setSignature} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Draw your signature above, or leave it blank to sign with your typed name only.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSignTarget(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={submitSign} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit signature'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Review dialog */}
      {reviewTarget && (
        <ReviewDialog
          open
          jobId={reviewTarget.job_id}
          jobNumber={reviewTarget.job_number}
          customerName={reviewTarget.customer_name}
          onClose={() => setReviewTarget(null)}
          onSubmitted={load}
        />
      )}

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
