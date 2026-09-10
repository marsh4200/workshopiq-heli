import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import BorderColorOutlinedIcon from '@mui/icons-material/BorderColorOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WorkIcon from '@mui/icons-material/Engineering';
import { useNavigate } from 'react-router-dom';
import { apiError, listMyInspectionReports, signInspectionReport } from '../api/client';
import { PageHeader, EmptyState, fmtDate } from '../components/common';
import SignaturePad from '../components/SignaturePad';
import { useAuth } from '../context/AuthContext';
import type { InspectionReportItem } from '../types';

/**
 * Client view of inspection reports. The workshop files the report on their
 * side; here the assigned client sees the reports on their jobs and signs the
 * ones still awaiting their signature. Signing re-files the report (with their
 * signature on it) back on the workshop's system.
 */
export default function ClientInspectionReports() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState<InspectionReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  // Sign dialog state.
  const [active, setActive] = useState<InspectionReportItem | null>(null);
  const [name, setName] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [padKey, setPadKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await listMyInspectionReports());
    } catch (e) {
      setToast(apiError(e, 'Could not load reports'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openSign = (r: InspectionReportItem) => {
    setActive(r);
    setName((user?.full_name || '').trim());
    setSignature(null);
    setPadKey((k) => k + 1);
  };

  const closeSign = () => {
    if (saving) return;
    setActive(null);
  };

  const submit = async () => {
    if (!active) return;
    const typed = name.trim();
    if (!typed && !signature) {
      setToast('Type your name or draw your signature');
      return;
    }
    setSaving(true);
    try {
      await signInspectionReport(active.id, { signed_name: typed, signature_png: signature });
      setToast(`${active.certificate_number} signed`);
      setActive(null);
      await load();
    } catch (e) {
      setToast(apiError(e, 'Could not submit signature'));
    } finally {
      setSaving(false);
    }
  };

  const pending = useMemo(() => reports.filter((r) => !r.client_signed), [reports]);
  const signed = useMemo(() => reports.filter((r) => r.client_signed), [reports]);

  const ReportCard = ({ r }: { r: InspectionReportItem }) => (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>{r.certificate_number}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {r.job_number}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Filed {fmtDate(r.submitted_at)}
            {r.inspector_name ? ` · Inspector ${r.inspector_name}` : ''}
          </Typography>
        </Box>
        {r.client_signed ? (
          <Chip
            icon={<CheckCircleOutlineIcon />}
            label="Signed"
            size="small"
            sx={{ bgcolor: '#22c55e1f', color: '#22c55e', fontWeight: 700 }}
          />
        ) : (
          <Chip
            label="Awaiting your signature"
            size="small"
            sx={{ bgcolor: '#f59e0b1f', color: '#f59e0b', fontWeight: 700 }}
          />
        )}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
        {r.client_signed ? (
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Signed{r.client_signed_name ? ` by ${r.client_signed_name}` : ''}
            {r.client_signed_at ? ` on ${fmtDate(r.client_signed_at)}` : ''}
          </Typography>
        ) : (
          <Button
            variant="contained"
            size="small"
            startIcon={<BorderColorOutlinedIcon />}
            onClick={() => openSign(r)}
          >
            Sign inspection report
          </Button>
        )}
        <Button size="small" startIcon={<WorkIcon />} onClick={() => navigate(`/jobs/${r.job_id}`)}>
          Open job
        </Button>
      </Stack>
    </Card>
  );

  return (
    <Box>
      <PageHeader
        eyebrow="Quality"
        title="Inspection Reports"
        subtitle="Reports the workshop has filed on your jobs. Sign the ones awaiting your signature — your signature is added to the report and filed back automatically."
      />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : reports.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState
            icon={<FactCheckIcon sx={{ fontSize: 44, opacity: 0.5 }} />}
            title="No inspection reports yet"
            subtitle="When the workshop files an inspection report on one of your jobs, it will appear here for you to sign."
          />
        </Card>
      ) : (
        <Stack spacing={2}>
          {pending.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Awaiting your signature ({pending.length})
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                {pending.map((r) => (
                  <ReportCard key={r.id} r={r} />
                ))}
              </Stack>
            </Box>
          )}
          {signed.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                Signed ({signed.length})
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 0.5 }}>
                {signed.map((r) => (
                  <ReportCard key={r.id} r={r} />
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      )}

      {/* Sign dialog */}
      <Dialog open={!!active} onClose={closeSign} fullWidth maxWidth="sm">
        <DialogTitle>Sign {active?.certificate_number}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {active?.job_number} · confirming you've reviewed and accept this inspection report.
          </Typography>
          <TextField
            label="Your name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          <Button onClick={closeSign} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={submit} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit signature'}
          </Button>
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
