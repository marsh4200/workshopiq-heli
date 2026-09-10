import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Rating, Stack, Typography } from '@mui/material';
import StarOutlineIcon from '@mui/icons-material/StarBorderPurple500';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import BorderColorOutlinedIcon from '@mui/icons-material/BorderColorOutlined';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import {
  getPendingClientSignatures,
  getPendingClosures,
  getPendingInspections,
  getPendingReviews,
  getReviewNotifications,
  markReviewNotificationsSeen,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import type {
  PendingClientSignature,
  PendingClosure,
  PendingInspection,
  PendingReview,
  ReviewNotification,
} from '../types';
import ReviewDialog from './ReviewDialog';

/**
 * Login banners, by role:
 *  - Clients: a persistent nag for anything awaiting their action — final
 *    inspections / re-inspections released to them, and jobs awaiting their
 *    review. Each reappears every login until the client acts on it.
 *  - Staff/admin: a one-time-per-user notice that a customer review came in.
 *    Each user sees it once (their first login after it), then it's marked seen
 *    so it won't return — independently of other users.
 */
export default function ReviewNotifier() {
  const { isClient, isAdmin } = useAuth();
  if (!isClient)
    return (
      <>
        {isAdmin && <AdminClosureAlert />}
        <StaffReviewAlert />
      </>
    );
  return (
    <>
      <ClientSignatureNag />
      <ClientInspectionNag />
      <ClientNag />
    </>
  );
}

/* ---------------- Client: inspection report awaiting signature nag ---------------- */
function ClientSignatureNag() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingClientSignature[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPendingClientSignatures()
      .then((items) => {
        if (!cancelled) setPending(items);
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (pending.length === 0) return null;
  const next = pending[0];
  const more = pending.length - 1;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Alert
        severity="warning"
        icon={<BorderColorOutlinedIcon />}
        sx={{
          alignItems: 'center',
          border: '1px solid',
          borderColor: 'warning.main',
          background: 'rgba(245,158,11,0.10)',
        }}
        action={
          <Button
            color="warning"
            variant="contained"
            size="small"
            onClick={() => navigate('/inspection-reports')}
          >
            Sign now
          </Button>
        }
      >
        <Stack>
          <Typography sx={{ fontWeight: 700 }}>
            {next.certificate_number} needs your signature
          </Typography>
          <Typography variant="body2" color="text.secondary">
            The inspection report for {next.job_number} ({next.customer_name}) is ready for you to
            sign.
            {more > 0
              ? ` ${more} other report${more === 1 ? '' : 's'} also awaiting your signature.`
              : ''}
          </Typography>
        </Stack>
      </Alert>
    </Box>
  );
}

/* ---------------- Admin: closure requests awaiting approval ---------------- */
function AdminClosureAlert() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingClosure[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPendingClosures()
      .then((items) => {
        if (!cancelled) setPending(items);
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (pending.length === 0) return null;
  const next = pending[0];
  const more = pending.length - 1;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Alert
        severity="warning"
        icon={<GavelOutlinedIcon />}
        sx={{
          alignItems: 'center',
          border: '1px solid',
          borderColor: 'warning.main',
          background: 'rgba(245,158,11,0.10)',
        }}
        action={
          <Button
            color="warning"
            variant="contained"
            size="small"
            onClick={() =>
              navigate(
                `/jobs/${next.job_id}?tab=${encodeURIComponent('Final Inspection')}`,
              )
            }
          >
            Review
          </Button>
        }
      >
        <Stack>
          <Typography sx={{ fontWeight: 700 }}>
            {next.job_number} — closure awaiting your approval
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {next.requested_by ? `${next.requested_by} requested` : 'Requested'} to close{' '}
            {next.customer_name} without a client final inspection.
            {next.reason ? ` Reason: ${next.reason}.` : ''}
            {more > 0
              ? ` ${more} other closure request${more === 1 ? '' : 's'} also pending.`
              : ''}
          </Typography>
          {more > 0 && (
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start', mt: 0.5, px: 0 }}
              onClick={() => navigate('/closure-requests')}
            >
              View all closure requests
            </Button>
          )}
        </Stack>
      </Alert>
    </Box>
  );
}

/* ---------------- Client: ready-for-inspection / re-inspection nag ---------------- */
function ClientInspectionNag() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingInspection[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPendingInspections()
      .then((items) => {
        if (!cancelled) setPending(items);
      })
      .catch(() => {
        if (!cancelled) setPending([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (pending.length === 0) return null;
  const next = pending[0];
  const more = pending.length - 1;
  const reinspection = next.is_reinspection;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Alert
        severity="warning"
        icon={<FactCheckOutlinedIcon />}
        sx={{
          alignItems: 'center',
          border: '1px solid',
          borderColor: 'warning.main',
          background: 'rgba(245,158,11,0.10)',
        }}
        action={
          <Button
            color="warning"
            variant="contained"
            size="small"
            onClick={() =>
              navigate(`/jobs/${next.job_id}?tab=${encodeURIComponent('Final Inspection')}`)
            }
          >
            {reinspection ? 'Re-inspect' : 'Inspect now'}
          </Button>
        }
      >
        <Stack>
          <Typography sx={{ fontWeight: 700 }}>
            {reinspection
              ? `${next.job_number} is ready for re-inspection`
              : `${next.job_number} is ready for inspection`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {reinspection
              ? `The workshop has addressed the issue and sent ${next.customer_name} back for your sign-off.`
              : `${next.customer_name} is awaiting your final inspection sign-off.`}
            {more > 0
              ? ` ${more} other job${more === 1 ? '' : 's'} also awaiting your inspection.`
              : ''}
          </Typography>
        </Stack>
      </Alert>
    </Box>
  );
}

/* ---------------- Client: nag until reviewed ---------------- */
function ClientNag() {
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [active, setActive] = useState<PendingReview | null>(null);

  const load = useCallback(() => {
    getPendingReviews()
      .then(setPending)
      .catch(() => setPending([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (pending.length === 0) return null;
  const next = pending[0];
  const more = pending.length - 1;

  return (
    <>
      <Box sx={{ mb: 2.5 }}>
        <Alert
          severity="info"
          icon={<StarOutlineIcon />}
          sx={{
            alignItems: 'center',
            border: '1px solid',
            borderColor: 'primary.main',
            background: 'rgba(59,130,246,0.10)',
          }}
          action={
            <Button color="primary" variant="contained" size="small" onClick={() => setActive(next)}>
              Leave review
            </Button>
          }
        >
          <Stack>
            <Typography sx={{ fontWeight: 700 }}>How did we do on {next.job_number}?</Typography>
            <Typography variant="body2" color="text.secondary">
              Please rate this job ({next.customer_name}).
              {more > 0 ? ` ${more} other job${more === 1 ? '' : 's'} also awaiting your review.` : ''}
            </Typography>
          </Stack>
        </Alert>
      </Box>

      {active && (
        <ReviewDialog
          open
          jobId={active.job_id}
          jobNumber={active.job_number}
          customerName={active.customer_name}
          onClose={() => setActive(null)}
          onSubmitted={load}
        />
      )}
    </>
  );
}

/* ---------------- Staff/Admin: first-time "review submitted" notice ---------------- */
function StaffReviewAlert() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<ReviewNotification[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getReviewNotifications()
      .then((items) => {
        if (cancelled || items.length === 0) return;
        setNotes(items);
        // Mark seen immediately so it's a true one-time-per-user notice.
        markReviewNotificationsSeen(items.map((n) => n.review_id)).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || notes.length === 0) return null;

  const single = notes.length === 1;

  return (
    <Box sx={{ mb: 2.5 }}>
      <Alert
        severity="success"
        onClose={() => setDismissed(true)}
        sx={{ border: '1px solid', borderColor: 'success.main', background: 'rgba(34,197,94,0.10)' }}
      >
        <Typography sx={{ fontWeight: 700, mb: single ? 0 : 0.5 }}>
          {single ? 'A customer left a review' : `${notes.length} new customer reviews came in`}
        </Typography>
        <Stack spacing={0.75}>
          {notes.slice(0, 5).map((n) => (
            <Stack key={n.review_id} direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {n.job_number}
              </Typography>
              <Rating value={n.rating || 0} readOnly size="small" />
              <Typography variant="body2" color="text.secondary">
                {n.customer_name}
              </Typography>
              <Button size="small" onClick={() => navigate(`/jobs/${n.job_id}`)}>
                View
              </Button>
            </Stack>
          ))}
        </Stack>
      </Alert>
    </Box>
  );
}
