import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PrecisionManufacturingOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import {
  getCheckinLists,
  createCheckinItem,
  updateCheckinItem,
  deleteCheckinItem,
  apiError,
} from '../api/client';
import { EmptyState } from '../components/common';
import type { CheckinListItem } from '../types';

type Kind = 'operator' | 'machine';

function ListEditor({
  kind,
  title,
  icon,
  items,
  onChanged,
}: {
  kind: Kind;
  title: string;
  icon: React.ReactNode;
  items: CheckinListItem[];
  onChanged: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const label = draft.trim();
    if (!label) return;
    setBusy(true);
    setError('');
    try {
      await createCheckinItem(kind, label);
      setDraft('');
      await onChanged();
    } catch (e) {
      setError(apiError(e, 'Failed to add'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: CheckinListItem) => {
    if (!window.confirm(`Remove "${item.label}"?`)) return;
    setError('');
    try {
      await deleteCheckinItem(item.id);
      await onChanged();
    } catch (e) {
      setError(apiError(e, 'Failed to remove'));
    }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const a = items[idx];
    const b = items[target];
    setError('');
    try {
      await Promise.all([
        updateCheckinItem(a.id, { order_index: b.order_index }),
        updateCheckinItem(b.id, { order_index: a.order_index }),
      ]);
      await onChanged();
    } catch (e) {
      setError(apiError(e, 'Failed to reorder'));
    }
  };

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: '8px',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: 'primary.main',
              bgcolor: (theme) => `${theme.palette.primary.main}1c`,
              '& svg': { fontSize: 16 },
            }}
          >
            {icon}
          </Box>
          <Typography fontWeight={700}>{title}</Typography>
        </Stack>

        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 1.5 }}>
            {error}
          </Typography>
        )}

        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Nothing added yet — the check-in form won't work until at least one is added here.
          </Typography>
        )}

        <Stack spacing={0.75} sx={{ mb: 2 }}>
          {items.map((item, idx) => (
            <Stack
              key={item.id}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                px: 1.25,
                py: 0.5,
                borderRadius: 1.5,
                bgcolor: 'action.hover',
              }}
            >
              <Typography variant="body2" sx={{ flexGrow: 1 }}>
                {item.label}
              </Typography>
              <IconButton size="small" onClick={() => move(idx, -1)} disabled={idx === 0}>
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                onClick={() => move(idx, 1)}
                disabled={idx === items.length - 1}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => remove(item)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>

        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            placeholder={kind === 'operator' ? 'Add an operator…' : 'Add a machine…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={add}
            disabled={busy || !draft.trim()}
          >
            Add
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function CheckinLists() {
  const [operators, setOperators] = useState<CheckinListItem[]>([]);
  const [machines, setMachines] = useState<CheckinListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await getCheckinLists();
      setOperators(data.operators);
      setMachines(data.machines);
    } catch (e) {
      setError(apiError(e, 'Failed to load check-in lists'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Box>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        Check-in Lists
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        These are the operator and machine choices shown when someone scans a job's check-in QR
        code. Add, remove or reorder them here — changes apply immediately, no publish step.
      </Typography>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {!loading && (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={6}>
            <ListEditor
              kind="operator"
              title="Operators"
              icon={<PersonOutlineIcon />}
              items={operators}
              onChanged={load}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <ListEditor
              kind="machine"
              title="Machines"
              icon={<PrecisionManufacturingOutlinedIcon />}
              items={machines}
              onChanged={load}
            />
          </Grid>
        </Grid>
      )}

      {!loading && operators.length === 0 && machines.length === 0 && (
        <Card sx={{ mt: 2.5 }}>
          <EmptyState
            icon={<PrecisionManufacturingOutlinedIcon sx={{ fontSize: 40 }} />}
            title="No check-in lists set up yet"
            subtitle="Add at least one operator and one machine above — until then, scanning a check-in QR code will show a 'not set up' message."
          />
        </Card>
      )}
    </Box>
  );
}
