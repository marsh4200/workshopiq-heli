import {
  Box,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useThemeMode, type ThemePreference } from '../context/ThemeModeContext';
import { useAuth } from '../context/AuthContext';
import { fontDisplay } from '../theme/theme';

interface Option {
  value: ThemePreference;
  label: string;
  blurb: string;
  icon: React.ReactNode;
  // A tiny preview of the finish (page bg, card surface, accent, text).
  preview: { bg: string; surface: string; accent: string; text: string; line: string };
}

const OPTIONS: Option[] = [
  {
    value: 'light',
    label: 'Light',
    blurb: 'Bright daylight finish — easy to read in well-lit spaces and on site.',
    icon: <LightModeIcon />,
    preview: { bg: '#eef2f8', surface: '#ffffff', accent: '#2563eb', text: '#0f172a', line: 'rgba(15,23,42,0.12)' },
  },
  {
    value: 'dark',
    label: 'Dark',
    blurb: 'The signature deep-graphite finish — gentle on the eyes in low light.',
    icon: <DarkModeIcon />,
    preview: { bg: '#0a0e16', surface: '#131b2c', accent: '#3b82f6', text: '#e8edf6', line: 'rgba(148,163,184,0.18)' },
  },
  {
    value: 'system',
    label: 'System',
    blurb: 'Follow your device — switches automatically with your phone or tablet.',
    icon: <SettingsBrightnessIcon />,
    preview: { bg: 'linear-gradient(135deg,#0a0e16 0 50%,#eef2f8 50% 100%)', surface: 'transparent', accent: '#3b82f6', text: '#94a3b8', line: 'rgba(148,163,184,0.18)' },
  },
];

function MiniPreview({ p }: { p: Option['preview'] }) {
  return (
    <Box
      sx={{
        height: 88,
        borderRadius: 2,
        p: 1.25,
        background: p.bg,
        border: `1px solid ${p.line}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ width: 22, height: 6, borderRadius: 3, background: p.accent }} />
        <Box sx={{ flex: 1, height: 6, borderRadius: 3, background: p.line }} />
      </Box>
      <Box
        sx={{
          flex: 1,
          borderRadius: 1.5,
          background: p.surface,
          border: `1px solid ${p.line}`,
          p: 0.75,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          justifyContent: 'center',
        }}
      >
        <Box sx={{ width: '70%', height: 5, borderRadius: 3, background: p.text, opacity: 0.85 }} />
        <Box sx={{ width: '45%', height: 5, borderRadius: 3, background: p.text, opacity: 0.4 }} />
      </Box>
    </Box>
  );
}

export default function Appearance() {
  const { preference, mode, setPreference, saving } = useThemeMode();
  const { user } = useAuth();

  return (
    <Box sx={{ maxWidth: 920, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <Typography variant="h5" sx={{ fontFamily: fontDisplay, fontWeight: 700 }}>
          Appearance
        </Typography>
        {saving && <Chip size="small" label="Saving…" variant="outlined" />}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Choose how WorkshopIQ looks for {user?.full_name || user?.username || 'you'}. This is your own
        personal setting — it follows your account on every device you sign in on and doesn&apos;t
        affect anyone else.
      </Typography>

      <Grid container spacing={2}>
        {OPTIONS.map((opt) => {
          const selected = preference === opt.value;
          return (
            <Grid key={opt.value} item xs={12} sm={4}>
              <Card
                onClick={() => setPreference(opt.value)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setPreference(opt.value);
                  }
                }}
                sx={{
                  cursor: 'pointer',
                  height: '100%',
                  position: 'relative',
                  outline: 'none',
                  borderColor: selected ? 'primary.main' : 'divider',
                  boxShadow: selected ? (t) => `0 0 0 2px ${t.palette.primary.main} inset` : 'none',
                  transition: 'border-color .15s ease, transform .15s ease, box-shadow .15s ease',
                  '&:hover': { transform: 'translateY(-2px)', borderColor: 'primary.main' },
                  '&:focus-visible': { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main} inset` },
                }}
              >
                {selected && (
                  <CheckCircleIcon
                    color="primary"
                    sx={{ position: 'absolute', top: 10, right: 10, fontSize: 22 }}
                  />
                )}
                <CardContent>
                  <MiniPreview p={opt.preview} />
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
                    <Box sx={{ color: selected ? 'primary.main' : 'text.secondary', display: 'flex' }}>
                      {opt.icon}
                    </Box>
                    <Typography sx={{ fontWeight: 700 }}>{opt.label}</Typography>
                    {opt.value === 'system' && (
                      <Chip
                        size="small"
                        label={`now: ${mode}`}
                        variant="outlined"
                        sx={{ ml: 'auto', textTransform: 'capitalize' }}
                      />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                    {opt.blurb}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 2.5 }}>
        Tip: the moon / sun button in the top bar flips between light and dark instantly.
      </Typography>
    </Box>
  );
}
