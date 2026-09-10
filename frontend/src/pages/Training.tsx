import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SchoolOutlinedIcon from '@mui/icons-material/SchoolOutlined';
import EditNoteIcon from '@mui/icons-material/EditNote';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import DeleteIcon from '@mui/icons-material/Delete';
import { TRAINING_TOPICS, type TrainingTopic } from '../data/trainingTopics';
import { useDeviceType } from '../hooks/useDeviceType';
import SignaturePad from '../components/SignaturePad';
import {
  listTrainableWorkers,
  listTrainingRecords,
  createTrainingRecord,
  deleteTrainingRecord,
  apiError,
} from '../api/client';
import type { TrainableWorker, TrainingRecordItem } from '../types';

const TOPIC_TITLE: Record<string, string> = Object.fromEntries(
  TRAINING_TOPICS.map((t) => [t.id, t.title]),
);

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

// --------------------------- Topics tab ---------------------------

function TopicsTab() {
  const isMobile = useDeviceType().isMobile;
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [open, setOpen] = useState<TrainingTopic | null>(null);
  const [step, setStep] = useState(0);

  const openTopic = (t: TrainingTopic) => {
    setOpen(t);
    setStep(0);
  };
  const close = () => setOpen(null);

  const steps = open?.steps ?? [];
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 1.5,
        }}
      >
        {TRAINING_TOPICS.map((t) => (
          <Card
            key={t.id}
            variant="outlined"
            sx={{
              p: 2,
              cursor: 'pointer',
              transition: 'border-color 0.15s',
              '&:hover': { borderColor: 'primary.main' },
            }}
            onClick={() => openTopic(t)}
          >
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Box sx={{ color: 'primary.main', display: 'flex' }}>{t.icon}</Box>
              <Typography sx={{ fontWeight: 600, fontSize: 15 }}>{t.title}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {t.subtitle}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t.steps.length} steps
            </Typography>
          </Card>
        ))}
      </Box>

      <Dialog open={!!open} onClose={close} fullWidth maxWidth="xs" fullScreen={fullScreen}>
        {open && current && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
              <Box sx={{ color: 'primary.main', display: 'flex' }}>{open.icon}</Box>
              {open.title}
              <IconButton onClick={close} sx={{ position: 'absolute', right: 8, top: 8 }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 0.5 }}>{current.label}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {current.note}
              </Typography>
              {current.screen}

              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 2.5 }}>
                <Button
                  size="small"
                  startIcon={<ArrowBackIcon fontSize="small" />}
                  disabled={step === 0}
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                >
                  Back
                </Button>
                <Stack direction="row" spacing={0.75}>
                  {steps.map((_, i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: i === step ? 'primary.main' : 'action.disabledBackground',
                      }}
                    />
                  ))}
                </Stack>
                {isLast ? (
                  <Button size="small" onClick={close}>
                    Done
                  </Button>
                ) : (
                  <Button
                    size="small"
                    endIcon={<ArrowForwardIcon fontSize="small" />}
                    onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                  >
                    Next
                  </Button>
                )}
              </Stack>
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}

// --------------------------- Sign-off tab ---------------------------

function SignOffTab({ onSaved }: { onSaved: () => void }) {
  const [workers, setWorkers] = useState<TrainableWorker[]>([]);
  const [worker, setWorker] = useState<TrainableWorker | null>(null);
  const [workerInput, setWorkerInput] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [signaturePadKey, setSignaturePadKey] = useState(0);

  const loadWorkers = () => {
    listTrainableWorkers().then(setWorkers).catch((e) => setToast(apiError(e, 'Could not load workers')));
  };

  useEffect(() => {
    loadWorkers();
  }, []);

  const toggleTopic = (id: string) => {
    setTopics((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const reset = () => {
    setWorker(null);
    setWorkerInput('');
    setTopics([]);
    setNotes('');
    setSignature(null);
    setSignaturePadKey((k) => k + 1);
  };

  const submit = async () => {
    const name = (worker?.full_name || workerInput).trim();
    if (!name) {
      setToast('Enter or select a worker');
      return;
    }
    if (topics.length === 0) {
      setToast('Select at least one topic');
      return;
    }
    if (!signature) {
      setToast('A signature is required');
      return;
    }
    setSaving(true);
    try {
      await createTrainingRecord({
        worker_name: name,
        user_id: worker?.id ?? null,
        topics,
        signature_png: signature,
        notes: notes || undefined,
      });
      setToast('Training record saved');
      reset();
      loadWorkers();
      onSaved();
    } catch (e) {
      setToast(apiError(e, 'Could not save the record'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 480 }}>
      <Autocomplete
        freeSolo
        options={workers}
        getOptionLabel={(o) => (typeof o === 'string' ? o : o.full_name)}
        value={worker}
        inputValue={workerInput}
        onInputChange={(_, v) => setWorkerInput(v)}
        onChange={(_, v) => {
          if (typeof v === 'string') {
            setWorker(null);
            setWorkerInput(v);
          } else {
            setWorker(v);
            setWorkerInput(v?.full_name || '');
          }
        }}
        renderInput={(params) => (
          <TextField {...params} label="Worker" placeholder="Type a name or pick from the list" />
        )}
        sx={{ mb: 2.5 }}
      />

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        Trained on
      </Typography>
      <FormGroup sx={{ mb: 2.5 }}>
        {TRAINING_TOPICS.map((t) => (
          <FormControlLabel
            key={t.id}
            control={<Checkbox checked={topics.includes(t.id)} onChange={() => toggleTopic(t.id)} size="small" />}
            label={<Typography variant="body2">{t.title}</Typography>}
          />
        ))}
      </FormGroup>

      <TextField
        fullWidth
        multiline
        minRows={2}
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        sx={{ mb: 2.5 }}
      />

      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        Signature
      </Typography>
      <SignaturePad key={signaturePadKey} onChange={setSignature} />

      <Button
        variant="contained"
        fullWidth
        sx={{ mt: 2.5 }}
        disabled={saving}
        onClick={submit}
      >
        {saving ? 'Saving…' : 'Save training record'}
      </Button>

      <Snackbar
        open={!!toast}
        autoHideDuration={3500}
        onClose={() => setToast('')}
        message={toast}
      />
    </Box>
  );
}

// --------------------------- Report tab ---------------------------

function ReportTab({ records, loading, onDeleted }: { records: TrainingRecordItem[]; loading: boolean; onDeleted: () => void }) {
  const [viewSig, setViewSig] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const remove = async (id: number) => {
    try {
      await deleteTrainingRecord(id);
      onDeleted();
    } catch (e) {
      setToast(apiError(e, 'Could not delete record'));
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (records.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No training records yet. Log one from the Sign off tab.
      </Typography>
    );
  }

  return (
    <Box>
      <Stack spacing={1.25}>
        {records.map((r) => (
          <Card key={r.id} variant="outlined" sx={{ p: 1.75 }}>
            <Stack direction="row" alignItems="flex-start" spacing={1.5}>
              <Avatar sx={{ width: 36, height: 36, fontSize: 14 }}>
                {r.worker_name.slice(0, 2).toUpperCase()}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{r.worker_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {fmtDate(r.created_at)}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.75, mb: 0.75 }}>
                  {r.topics.map((id) => (
                    <Chip key={id} label={TOPIC_TITLE[id] || id} size="small" />
                  ))}
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block">
                  Trained by {r.trained_by_name}
                  {r.notes ? ` · ${r.notes}` : ''}
                </Typography>
              </Box>
              <Stack alignItems="center" spacing={0.5}>
                <Tooltip title="View signature">
                  <IconButton size="small" onClick={() => setViewSig(r.signature_png)}>
                    <EditNoteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete record">
                  <IconButton size="small" color="error" onClick={() => remove(r.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>

      <Dialog open={!!viewSig} onClose={() => setViewSig(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Signature
          <IconButton onClick={() => setViewSig(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {viewSig && (
            <Box
              component="img"
              src={viewSig}
              alt="Signature"
              sx={{ width: '100%', bgcolor: '#fff', borderRadius: 1, p: 1 }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={3500} onClose={() => setToast('')} message={toast} />
    </Box>
  );
}

// --------------------------- Page ---------------------------

export default function Training() {
  const [tab, setTab] = useState(0);
  const [records, setRecords] = useState<TrainingRecordItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecords = () => {
    setLoading(true);
    listTrainingRecords()
      .then(setRecords)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadRecords();
  }, []);

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1 }}>
        <SchoolOutlinedIcon color="action" />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Training
        </Typography>
      </Stack>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5 }}>
        <Tab label="Topics" />
        <Tab label="Sign off" />
        <Tab label={`Report${records.length ? ` (${records.length})` : ''}`} />
      </Tabs>

      {tab === 0 && <TopicsTab />}
      {tab === 1 && (
        <>
          <Alert severity="info" icon={<FactCheckOutlinedIcon fontSize="small" />} sx={{ mb: 2.5, maxWidth: 480 }}>
            Pick the worker, tick what they were walked through, and get them to sign on screen.
          </Alert>
          <SignOffTab onSaved={loadRecords} />
        </>
      )}
      {tab === 2 && <ReportTab records={records} loading={loading} onDeleted={loadRecords} />}
    </Box>
  );
}
