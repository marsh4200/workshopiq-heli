import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiError } from '../api/client';
import { fontDisplay, fontMono } from '../theme/theme';
import { Logomark } from '../components/common';

const MAINTENANCE_MSG =
  'This server is currently under maintenance. Please try again later. If this continues, please contact your system administrator.';

const SHUTDOWN_MSG = 'This server has been shut down. Please contact your administrator.';

const CAPABILITIES = [
  ['01', 'Intake', 'Log jobs the moment they arrive'],
  ['02', 'Inspection', 'Structured checks against templates'],
  ['03', 'Client portal', 'Share progress, keep records tight'],
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Set by the API interceptor when a signed-in staff/client gets bounced by
  // maintenance mode — shows them why they suddenly landed back here.
  const [maintenance, setMaintenance] = useState(
    () => sessionStorage.getItem('wiq-maintenance') === '1',
  );
  // Set by the API interceptor when a signed-in staff/client is bounced by
  // server-shutdown mode — shows the shutdown wording instead.
  const [shutdown, setShutdown] = useState(
    () => sessionStorage.getItem('wiq-shutdown') === '1',
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMaintenance(false);
    setShutdown(false);
    sessionStorage.removeItem('wiq-maintenance');
    sessionStorage.removeItem('wiq-shutdown');
    setLoading(true);
    try {
      const { must_change_password } = await login(username, password, remember);
      navigate(must_change_password ? '/change-password' : '/', { replace: true });
    } catch (err) {
      setError(apiError(err, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' },
      }}
    >
      {/* Brand panel */}
      <Box
        sx={{
          position: 'relative',
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 6,
          overflow: 'hidden',
          borderRight: '1px solid rgba(148,163,184,0.12)',
          background:
            'radial-gradient(900px 600px at 20% 0%, rgba(37,99,235,0.18), transparent 60%), linear-gradient(160deg,#0c1322,#0a0e16)',
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
            maskImage: 'radial-gradient(700px 500px at 30% 20%, #000 0%, transparent 80%)',
            pointerEvents: 'none',
          },
        }}
      >
        <Box sx={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Logomark size={40} />
          <Box>
            <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, lineHeight: 1.05 }}>
              WorkshopIQ
            </Typography>
            <Typography sx={{ fontFamily: fontMono, fontSize: 11, color: 'text.secondary', letterSpacing: '0.06em' }}>
              ENGINEERING OPS
            </Typography>
          </Box>
        </Box>

        <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 460 }}>
          <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 38, lineHeight: 1.12, letterSpacing: '-0.02em' }}>
            Every job tracked from{' '}
            <Box component="span" sx={{ color: 'primary.main' }}>bench to handover.</Box>
          </Typography>
          <Typography sx={{ color: 'text.secondary', mt: 2, fontSize: 15 }}>
            The workshop floor for intake, inspection and client visibility — in one place.
          </Typography>

          <Stack spacing={2} sx={{ mt: 5 }}>
            {CAPABILITIES.map(([n, title, desc]) => (
              <Box key={n} sx={{ display: 'flex', gap: 2, alignItems: 'baseline' }}>
                <Typography sx={{ fontFamily: fontMono, color: 'primary.main', fontSize: 13, fontWeight: 600 }}>
                  {n}
                </Typography>
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
                  <Typography variant="body2" color="text.secondary">{desc}</Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>

        <Typography sx={{ position: 'relative', zIndex: 1, fontFamily: fontMono, fontSize: 11, color: 'text.secondary' }}>
          <PrecisionManufacturingIcon sx={{ fontSize: 14, mr: 0.5, verticalAlign: 'middle' }} />
          Precision workshop management
        </Typography>
      </Box>

      {/* Form panel */}
      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 3, sm: 5 } }}>
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1.5, mb: 4 }}>
            <Logomark size={38} />
            <Typography sx={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 20 }}>WorkshopIQ</Typography>
          </Box>

          <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 26, letterSpacing: '-0.01em' }}>
            Sign in
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3, mt: 0.5 }}>
            Enter your credentials to continue.
          </Typography>

          {shutdown && (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              {SHUTDOWN_MSG}
            </Alert>
          )}

          {maintenance && !shutdown && (
            <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
              {MAINTENANCE_MSG}
            </Alert>
          )}

          {error && (
            <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <form onSubmit={submit}>
            <Typography variant="overline" component="label" sx={{ display: 'block', mb: 0.5 }}>
              Username
            </Typography>
            <TextField
              fullWidth
              autoFocus
              placeholder="you@workshop"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              sx={{ mb: 2 }}
            />

            <Typography variant="overline" component="label" sx={{ display: 'block', mb: 0.5 }}>
              Password
            </Typography>
            <TextField
              fullWidth
              type={show ? 'text' : 'password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

            <FormControlLabel
              sx={{ mt: 1.5, ml: 0 }}
              control={
                <Checkbox
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  size="small"
                  sx={{ py: 0.5 }}
                />
              }
              label={
                <Typography variant="body2" color="text.secondary">
                  Keep me signed in on this device
                </Typography>
              }
            />

            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={loading || !username || !password}
              sx={{ mt: 2, py: 1.2 }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <Typography sx={{ fontFamily: fontMono, fontSize: 11, color: 'text.disabled', mt: 4, textAlign: 'center' }}>
            WORKSHOPIQ · SECURE ACCESS
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
