import { useState } from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import AndroidIcon from '@mui/icons-material/Android';
import { downloadAndroidApp, apiError } from '../api/client';

export default function AppDownload() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    setMsg('');
    try {
      await downloadAndroidApp();
      setMsg('Download started. Open the .apk on your Android device to install.');
    } catch (e) {
      setError(apiError(e, 'Download failed'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {msg && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMsg('')}>
          {msg}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
        <Button
          variant="contained"
          startIcon={downloading ? <CircularProgress size={18} color="inherit" /> : <AndroidIcon />}
          onClick={handleDownload}
          disabled={downloading}
        >
          {downloading ? 'Preparing download…' : 'Download Android App'}
        </Button>
        <Typography variant="body2" color="text.secondary">
          WorkshopIQ.apk
        </Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Installs the WorkshopIQ Android app. After downloading, open the file on
        the device — you may need to allow installs from unknown sources.
      </Typography>
    </Box>
  );
}
