import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import { submitReview, apiError } from '../api/client';

interface Props {
  open: boolean;
  jobId: number;
  jobNumber: string;
  customerName?: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const RATING_LABELS: Record<number, string> = {
  1: 'Very dissatisfied',
  2: 'Dissatisfied',
  3: 'Neutral',
  4: 'Satisfied',
  5: 'Very satisfied',
};

export default function ReviewDialog({
  open,
  jobId,
  jobNumber,
  customerName,
  onClose,
  onSubmitted,
}: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [hover, setHover] = useState(-1);
  const [feedback, setFeedback] = useState('');
  const [improvement, setImprovement] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setRating(null);
    setHover(-1);
    setFeedback('');
    setImprovement('');
    setError('');
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async () => {
    if (!rating) {
      setError('Please choose a star rating.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await submitReview(jobId, {
        rating,
        feedback: feedback.trim() || undefined,
        improvement: improvement.trim() || undefined,
      });
      reset();
      onSubmitted();
      onClose();
    } catch (e) {
      setError(apiError(e, 'Could not submit your review'));
    } finally {
      setSaving(false);
    }
  };

  const shown = hover !== -1 ? hover : rating;

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>
        Rate this job
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {jobNumber}
          {customerName ? ` · ${customerName}` : ''}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              How satisfied are you with this job?
            </Typography>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Rating
                value={rating}
                size="large"
                onChange={(_e, v) => setRating(v)}
                onChangeActive={(_e, v) => setHover(v)}
                emptyIcon={<StarIcon style={{ opacity: 0.3 }} fontSize="inherit" />}
              />
              <Typography variant="body2" color="text.secondary">
                {shown ? RATING_LABELS[shown] : ''}
              </Typography>
            </Stack>
          </Box>

          <TextField
            label="What were you happy with?"
            placeholder="Tell us what went well…"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
          <TextField
            label="How could we improve?"
            placeholder="Anything we could do better…"
            value={improvement}
            onChange={(e) => setImprovement(e.target.value)}
            fullWidth
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={saving || !rating}
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          Submit review
        </Button>
      </DialogActions>
    </Dialog>
  );
}
