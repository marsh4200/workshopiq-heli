import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SaveIcon from '@mui/icons-material/Save';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import {
  listTemplates,
  updateTemplate,
  createTemplate,
  deleteTemplate,
  fetchMeta,
  apiError,
} from '../api/client';
import { EmptyState } from '../components/common';
import type { Template } from '../types';

export default function Templates() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  // local editable items per template id
  const [edits, setEdits] = useState<Record<number, string[]>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTpl, setNewTpl] = useState({ component_type: '', name: '', items: '' });

  const load = async () => {
    try {
      const [tpls, meta] = await Promise.all([listTemplates(), fetchMeta()]);
      setTemplates(tpls);
      setComponentTypes(meta.component_types);
      const e: Record<number, string[]> = {};
      const n: Record<number, string> = {};
      tpls.forEach((t) => {
        e[t.id] = t.items.map((i) => i.label);
        n[t.id] = t.name;
      });
      setEdits(e);
      setNames(n);
    } catch (err) {
      setError(apiError(err, 'Failed to load templates'));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setItem = (tid: number, idx: number, val: string) =>
    setEdits((prev) => {
      const arr = [...(prev[tid] || [])];
      arr[idx] = val;
      return { ...prev, [tid]: arr };
    });

  const addItem = (tid: number) =>
    setEdits((prev) => ({ ...prev, [tid]: [...(prev[tid] || []), ''] }));

  const removeItem = (tid: number, idx: number) =>
    setEdits((prev) => ({ ...prev, [tid]: (prev[tid] || []).filter((_, i) => i !== idx) }));

  const move = (tid: number, idx: number, dir: -1 | 1) =>
    setEdits((prev) => {
      const arr = [...(prev[tid] || [])];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return prev;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...prev, [tid]: arr };
    });

  const save = async (t: Template) => {
    setSavingId(t.id);
    setError('');
    setMsg('');
    try {
      const items = (edits[t.id] || []).map((s) => s.trim()).filter(Boolean);
      await updateTemplate(t.id, { name: names[t.id], items });
      setMsg(`Saved "${t.component_type}" checklist.`);
      await load();
    } catch (e) {
      setError(apiError(e, 'Failed to save template'));
    } finally {
      setSavingId(null);
    }
  };

  const remove = async (t: Template) => {
    if (!window.confirm(`Delete the "${t.component_type}" template?`)) return;
    try {
      await deleteTemplate(t.id);
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to delete template'));
    }
  };

  const doCreate = async () => {
    try {
      const items = newTpl.items
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await createTemplate(newTpl.component_type, newTpl.name || newTpl.component_type, items);
      setCreateOpen(false);
      setNewTpl({ component_type: '', name: '', items: '' });
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to create template'));
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h4" fontWeight={800}>
          Inspection Templates
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
          New Template
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Each component type has its own inspection checklist. Items are evaluated as Pass / Fail /
        N/A during inspections.
      </Typography>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}
      {msg && (
        <Typography color="success.main" sx={{ mb: 2 }}>
          {msg}
        </Typography>
      )}

      {templates.map((t) => (
        <Accordion key={t.id} sx={{ mb: 1.5 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: '100%' }}>
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
                <FactCheckOutlinedIcon />
              </Box>
              <Typography fontWeight={700}>{t.component_type}</Typography>
              <Chip label={`${(edits[t.id] || []).length} items`} size="small" variant="outlined" />
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              <TextField
                label="Template Name"
                size="small"
                value={names[t.id] ?? ''}
                onChange={(e) => setNames((p) => ({ ...p, [t.id]: e.target.value }))}
                sx={{ maxWidth: 360 }}
              />
              <Stack spacing={1}>
                {(edits[t.id] || []).map((label, idx) => (
                  <Stack key={idx} direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" sx={{ width: 24, color: 'text.secondary' }}>
                      {idx + 1}.
                    </Typography>
                    <TextField
                      size="small"
                      fullWidth
                      value={label}
                      onChange={(e) => setItem(t.id, idx, e.target.value)}
                    />
                    <IconButton size="small" onClick={() => move(t.id, idx, -1)} disabled={idx === 0}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => move(t.id, idx, 1)}
                      disabled={idx === (edits[t.id] || []).length - 1}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => removeItem(t.id, idx)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
              <Stack direction="row" spacing={1} justifyContent="space-between">
                <Button startIcon={<AddIcon />} onClick={() => addItem(t.id)}>
                  Add Item
                </Button>
                <Stack direction="row" spacing={1}>
                  <Tooltip title="Delete template">
                    <IconButton color="error" onClick={() => remove(t)}>
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                  <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={() => save(t)}
                    disabled={savingId === t.id}
                  >
                    {savingId === t.id ? 'Saving…' : 'Save Checklist'}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}

      {templates.length === 0 && (
        <Card>
          <EmptyState
            icon={<FactCheckOutlinedIcon sx={{ fontSize: 40 }} />}
            title="No templates yet"
            subtitle="Create a checklist template for each component type your workshop inspects."
          />
        </Card>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Inspection Template</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Component Type"
              fullWidth
              value={newTpl.component_type}
              onChange={(e) => setNewTpl((p) => ({ ...p, component_type: e.target.value }))}
              helperText="Or type a custom value below"
            >
              {componentTypes.map((c) => (
                <MenuItem key={c} value={c}>
                  {c}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Component Type (custom)"
              fullWidth
              value={newTpl.component_type}
              onChange={(e) => setNewTpl((p) => ({ ...p, component_type: e.target.value }))}
            />
            <TextField
              label="Template Name"
              fullWidth
              value={newTpl.name}
              onChange={(e) => setNewTpl((p) => ({ ...p, name: e.target.value }))}
            />
            <TextField
              label="Checklist Items (one per line)"
              fullWidth
              multiline
              minRows={5}
              value={newTpl.items}
              onChange={(e) => setNewTpl((p) => ({ ...p, items: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={doCreate} disabled={!newTpl.component_type.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
