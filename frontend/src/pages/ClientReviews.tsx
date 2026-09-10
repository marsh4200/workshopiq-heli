import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CircularProgress,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import StarBorderIcon from '@mui/icons-material/StarBorderPurple500';
import WorkIcon from '@mui/icons-material/Engineering';
import { useNavigate } from 'react-router-dom';
import { apiError, getPendingReviews } from '../api/client';
import { EmptyState, PageHeader } from '../components/common';
import { fontMono } from '../theme/theme';
import ReviewDialog from '../components/ReviewDialog';
import type { PendingReview } from '../types';

/**
 * Client-facing list of finished jobs still awaiting their review. This is the
 * sidebar "Jobs to review" destination — a focused list, one tap to rate each.
 */
export default function ClientReviews() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<PendingReview | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPending(await getPendingReviews());
    } catch (e) {
      setToast(apiError(e, 'Could not load your reviews'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box>
      <PageHeader
        eyebrow="Feedback"
        title="Jobs to review"
        subtitle="Rate your finished jobs — it helps the workshop keep improving. Each one takes a few seconds."
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : pending.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<StarBorderIcon sx={{ fontSize: 44, opacity: 0.5 }} />}
            title="No jobs to review"
            subtitle="When a job is finished, it will appear here for you to rate."
          />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {pending.map((p) => (
            <Card key={p.job_id} variant="outlined" sx={{ p: 2 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', sm: 'center' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontFamily: fontMono, fontWeight: 700 }}>
                    {p.job_number}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {p.customer_name}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                  <Button size="small" startIcon={<WorkIcon />} onClick={() => navigate(`/jobs/${p.job_id}`)}>
                    Open job
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<StarBorderIcon />}
                    onClick={() => setActive(p)}
                  >
                    Leave review
                  </Button>
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

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
