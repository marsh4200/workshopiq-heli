import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import ShieldIcon from '@mui/icons-material/GppGoodOutlined';
import { useNavigate } from 'react-router-dom';
import { changePassword, acceptTerms, apiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Logomark } from '../components/common';

function strength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 6) s++;
  if (pw.length >= 10) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const map = [
    { label: 'Too short', color: '#64748b' },
    { label: 'Weak', color: '#f43f5e' },
    { label: 'Fair', color: '#f59e0b' },
    { label: 'Good', color: '#38bdf8' },
    { label: 'Strong', color: '#22c55e' },
    { label: 'Strong', color: '#22c55e' },
  ];
  return { score: s, ...map[s] };
}

export default function ChangePassword() {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const forced = user?.must_change_password;
  // First-login welcome & terms gate for client users: shown once, before
  // the forced password change. Acceptance is recorded server-side.
  const needsTerms = Boolean(forced && user?.role === 'client' && !user?.terms_accepted_at);
  const [termsOpen, setTermsOpen] = useState(false);
  // Open reactively: the user profile loads asynchronously after sign-in, so
  // a mount-time check can run before `user` exists and miss the dialog.
  useEffect(() => {
    if (needsTerms) setTermsOpen(true);
  }, [needsTerms]);
  const [accepting, setAccepting] = useState(false);

  const accept = async () => {
    setAccepting(true);
    try {
      await acceptTerms();
      await refresh();
      setTermsOpen(false);
    } catch {
      // Transient failure — keep the dialog up; the button can be pressed again.
    } finally {
      setAccepting(false);
    }
  };
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const st = strength(next);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) return setError('New password must be at least 6 characters');
    if (next !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      await changePassword(current, next);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Could not change password'));
    } finally {
      setLoading(false);
    }
  };

  const pwField = (
    label: string,
    val: string,
    set: (v: string) => void,
    autoFocus = false,
  ) => (
    <Box>
      <Typography variant="overline" component="label" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <TextField
        fullWidth
        autoFocus={autoFocus}
        type={show ? 'text' : 'password'}
        value={val}
        onChange={(e) => set(e.target.value)}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton onClick={() => setShow((s) => !s)} edge="end" size="small" tabIndex={-1}>
                {show ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Dialog open={termsOpen} maxWidth="sm" fullWidth disableEscapeKeyDown>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Logomark size={40} />
            <Box>
              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                Welcome to WorkshopIQ
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Please read and accept before continuing
              </Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            WorkshopIQ is built entirely on custom software, developed and
            maintained in-house — it exists for one purpose: managing your jobs
            with us.
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Your privacy matters to us. Your personal details and job
            information are kept private and secure, and are never shared with
            any third party — no exceptions.
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Our servers are protected with strong, up-to-date security measures
            and the system is monitored around the clock.
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            On the next step you'll choose your own password. Please pick a
            secure password that only you know.
          </Typography>
          <Typography variant="body2">
            If you ever run into a problem or need help with your password,
            please contact the administration team.
          </Typography>
          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">
            By continuing, you confirm that you have read and accept these
            terms of use.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            variant="contained"
            fullWidth
            size="large"
            onClick={accept}
            disabled={accepting}
          >
            {accepting ? 'One moment…' : 'I accept — continue'}
          </Button>
        </DialogActions>
      </Dialog>

      <Paper sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 440, borderRadius: 4 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
          <Logomark size={42} />
          <Box>
            <Typography variant="h5">
              {forced ? 'Secure your account' : 'Change password'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {forced
                ? 'Set your own password to continue.'
                : 'Update your account password.'}
            </Typography>
          </Box>
        </Stack>

        {forced && (
          <Alert
            icon={<ShieldIcon fontSize="inherit" />}
            severity="info"
            variant="outlined"
            sx={{ mb: 2 }}
          >
            You signed in with a temporary password. Choose your own password to finish setting up your account.
          </Alert>
        )}

        {error && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={submit}>
          <Stack spacing={2}>
            {pwField('Current password', current, setCurrent, true)}
            {pwField('New password', next, setNext)}
            {next.length > 0 && (
              <Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, (st.score / 5) * 100)}
                  sx={{
                    height: 6,
                    borderRadius: 3,
                    bgcolor: 'rgba(148,163,184,0.15)',
                    '& .MuiLinearProgress-bar': { bgcolor: st.color, borderRadius: 3 },
                  }}
                />
                <Typography variant="caption" sx={{ color: st.color, mt: 0.5, display: 'block' }}>
                  {st.label}
                </Typography>
              </Box>
            )}
            {pwField('Confirm new password', confirm, setConfirm)}
          </Stack>

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={loading}
            sx={{ mt: 3, py: 1.1 }}
          >
            {loading ? 'Saving…' : 'Update password'}
          </Button>
          {forced && (
            <Button fullWidth sx={{ mt: 1 }} color="inherit" onClick={logout}>
              Cancel and log out
            </Button>
          )}
        </form>
      </Paper>
    </Box>
  );
}
