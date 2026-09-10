import { useEffect, useState } from 'react';
import {
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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  apiError,
} from '../api/client';
import { fmtDate, fmtDay } from '../components/common';
import { useAuth } from '../context/AuthContext';
import { useDeviceType } from '../hooks/useDeviceType';
import type { Role, User } from '../types';

const ROLES: { value: Role; label: string }[] = [
  { value: 'administrator', label: 'Administrator' },
  { value: 'staff', label: 'Staff' },
  { value: 'client', label: 'Client' },
];

const ROLE_COLORS: Record<Role, string> = {
  administrator: '#a855f7',
  staff: '#3b82f6',
  client: '#14b8a6',
};

export default function Users() {
  const { user: me } = useAuth();
  const isMobile = useDeviceType().isMobile;
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<{ open: boolean; editing?: User }>({ open: false });
  const [form, setForm] = useState({
    username: '',
    full_name: '',
    email: '',
    role: 'staff' as Role,
    password: '',
    is_active: true,
  });
  const [saving, setSaving] = useState(false);

  const load = () =>
    listUsers()
      .then(setUsers)
      .catch((e) => setError(apiError(e, 'Failed to load users')));

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm({ username: '', full_name: '', email: '', role: 'staff', password: '', is_active: true });
    setDialog({ open: true });
  };

  const openEdit = (u: User) => {
    setForm({
      username: u.username,
      full_name: u.full_name || '',
      email: u.email || '',
      role: u.role,
      password: '',
      is_active: u.is_active,
    });
    setDialog({ open: true, editing: u });
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (dialog.editing) {
        const body: Record<string, unknown> = {
          full_name: form.full_name || null,
          email: form.email || null,
          role: form.role,
          is_active: form.is_active,
        };
        if (form.password) body.password = form.password;
        await updateUser(dialog.editing.id, body);
      } else {
        await createUser({
          username: form.username,
          full_name: form.full_name || null,
          email: form.email || null,
          role: form.role,
          password: form.password,
          is_active: form.is_active,
        });
      }
      setDialog({ open: false });
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to save user'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u: User) => {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to delete user'));
    }
  };

  const roleChip = (role: Role) => (
    <Chip
      label={ROLES.find((r) => r.value === role)?.label || role}
      size="small"
      sx={{
        bgcolor: `${ROLE_COLORS[role]}22`,
        color: ROLE_COLORS[role],
        border: `1px solid ${ROLE_COLORS[role]}55`,
        fontWeight: 600,
      }}
    />
  );

  const statusChip = (active: boolean) => (
    <Chip
      label={active ? 'Active' : 'Inactive'}
      size="small"
      color={active ? 'success' : 'default'}
      variant={active ? 'filled' : 'outlined'}
    />
  );

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1.5}
        sx={{ mb: 3 }}
      >
        <Typography variant="h4" fontWeight={800} sx={{ fontSize: { xs: '1.6rem', sm: '2.125rem' } }}>
          Users
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={openCreate}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {isMobile ? 'New' : 'New User'}
        </Button>
      </Stack>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {isMobile ? (
        // Phone / APK: a table this wide would clip off-screen (the main
        // column hides horizontal overflow), so the Edit/Delete actions become
        // unreachable. Render one card per user instead, matching the rest of
        // the app's mobile pattern.
        <Stack spacing={1.5}>
          {users.map((u) => (
            <Card key={u.id} sx={{ p: 1.75 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={800} noWrap>
                    {u.username}
                  </Typography>
                  {u.full_name && (
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {u.full_name}
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <IconButton size="small" onClick={() => openEdit(u)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    disabled={u.id === me?.id}
                    onClick={() => remove(u)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }} useFlexGap>
                {roleChip(u.role)}
                {statusChip(u.is_active)}
              </Stack>

              {u.email && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} noWrap>
                  {u.email}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                Last login: {u.last_login_at ? fmtDate(u.last_login_at) : 'Never'}
                {' · '}Created {fmtDay(u.created_at)}
              </Typography>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Username</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Last login</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} hover>
                  <TableCell sx={{ fontWeight: 700 }}>{u.username}</TableCell>
                  <TableCell>{u.full_name || '—'}</TableCell>
                  <TableCell>{u.email || '—'}</TableCell>
                  <TableCell>{roleChip(u.role)}</TableCell>
                  <TableCell>{statusChip(u.is_active)}</TableCell>
                  <TableCell>{u.last_login_at ? fmtDate(u.last_login_at) : 'Never'}</TableCell>
                  <TableCell>{fmtDay(u.created_at)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(u)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={u.id === me?.id ? 'Cannot delete yourself' : 'Delete'}>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={u.id === me?.id}
                          onClick={() => remove(u)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog
        open={dialog.open}
        onClose={() => setDialog({ open: false })}
        fullWidth
        maxWidth="sm"
        fullScreen={isMobile}
      >
        <DialogTitle>{dialog.editing ? `Edit ${dialog.editing.username}` : 'New User'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Username"
              fullWidth
              disabled={!!dialog.editing}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
            <TextField
              label="Full Name"
              fullWidth
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
            <TextField
              label="Email"
              type="email"
              fullWidth
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <TextField
              select
              label="Role"
              fullWidth
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
            >
              {ROLES.map((r) => (
                <MenuItem key={r.value} value={r.value}>
                  {r.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={dialog.editing ? 'New Password (leave blank to keep)' : 'Password'}
              type="password"
              fullWidth
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              helperText={
                dialog.editing
                  ? undefined
                  : form.role === 'administrator'
                    ? 'Administrators keep this password (no forced change).'
                    : 'User will be prompted to change this on first login.'
              }
            />
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography>Active</Typography>
              <Switch
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialog({ open: false })}>Cancel</Button>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
