import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Rating,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import DescriptionIcon from '@mui/icons-material/Description';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import SendIcon from '@mui/icons-material/Send';
import StarBorderPurple500Icon from '@mui/icons-material/StarBorderPurple500';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import PhotoLibraryOutlinedIcon from '@mui/icons-material/PhotoLibraryOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import {
  getJob,
  updateJob,
  deleteJob,
  addNote,
  uploadPhotos,
  deletePhoto,
  uploadDocuments,
  deleteDocument,
  fetchFileBlob,
  fileUrl,
  createInspection,
  updateInspection,
  deleteInspection,
  fetchMeta,
  listClients,
  assignClients,
  listCostItems,
  addCostItem,
  deleteCostItem,
  getCheckin,
  getReview,
  requestReview,
  skipInspectionReview,
  getFinalInspection,
  releaseFinalInspection,
  cancelFinalInspection,
  submitFinalInspection,
  failFinalInspection,
  requestClosure,
  approveClosure,
  rejectClosure,
  logWhatsapp,
  sendJobEmail,
  addJobEmailContact,
  deleteJobEmailContact,
  downloadCertificate,
  downloadJobPack,
  apiError,
} from '../api/client';
import { StatusBadge, StatusBanner, ClosedBanner, ResultBadge, fmtDate, fmtDay, dueInfo, EmptyState, SectionHeader } from '../components/common';
import PhotoGallery from '../components/PhotoGallery';
import ReviewDialog from '../components/ReviewDialog';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useDeviceType } from '../hooks/useDeviceType';
import { isAndroid, printQrSheet } from '../utils/platform';
import type { CheckinStatus, Inspection, JobDetail as JobDetailT, JobCostItem, Review, User } from '../types';

const zarFmt = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
const fmtMoney = (n: number) => zarFmt.format(Number.isFinite(n) ? n : 0);

/**
 * Normalise a phone number to bare international digits for a wa.me link.
 * Leading "0" is swapped for the configured country code; "+"/"00" prefixes
 * are stripped. Returns "" if there's nothing usable.
 */
function normalizeMsisdn(raw?: string | null, countryCode = '27'): string {
  let d = (raw || '').replace(/[^\d+]/g, '');
  const cc = (countryCode || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (cc && !d.startsWith(cc)) d = cc + d;
  return d;
}

/** Compose a status-aware WhatsApp message for a customer. */
function whatsappMessage(job: JobDetailT, company: string, origin: string): string {
  const who = job.contact_person || job.customer_name || 'there';
  const head = `Hi ${who}, this is ${company}.`;
  let line: string;
  switch (job.status) {
    case 'Completed':
    case 'Awaiting Customer Review':
      line = `Your job ${job.job_number} is complete and ready for collection.`;
      break;
    case 'Inspection':
      line = `Your job ${job.job_number} has moved to final inspection.`;
      break;
    case 'Inspection Failed':
      line = `Your job ${job.job_number} needs rework after inspection — we'll keep you posted.`;
      break;
    case 'Machining':
      line = `Your job ${job.job_number} is now in production.`;
      break;
    case 'Closed':
      line = `Your job ${job.job_number} is now closed. Thank you for your business.`;
      break;
    default:
      line = `We've received your job ${job.job_number} and it's now logged.`;
  }
  return `${head} ${line}\nTrack progress: ${origin}`;
}

/**
 * Draft a status-aware notification email — staff review/edit this before
 * sending. `recipientName` is the saved name of whichever email contact was
 * picked on the job (falling back to the job's own contact/customer name if
 * that contact has none), so the greeting is always "Hi <that person>,"
 * rather than a guess. `loginUrl` is appended so the customer can log in to
 * the client portal and track the job themselves.
 */
function draftEmail(
  kind: 'status' | 'completion',
  job: JobDetailT,
  company: string,
  recipientName: string,
  loginUrl: string,
): { subject: string; body: string } {
  const who = recipientName || job.contact_person || job.customer_name || 'there';
  let line: string;
  if (kind === 'completion') {
    line = `Good news — job ${job.job_number} is complete and ready for collection.`;
  } else {
    switch (job.status) {
      case 'Inspection':
        line = `Your job ${job.job_number} has moved to final inspection.`;
        break;
      case 'Inspection Failed':
        line = `Your job ${job.job_number} needs rework after inspection — we'll keep you posted.`;
        break;
      case 'Machining':
        line = `Your job ${job.job_number} is now in production.`;
        break;
      case 'Completed':
        line = `Your job ${job.job_number} is complete.`;
        break;
      case 'Awaiting Customer Review':
        line = `Your job ${job.job_number} is complete and awaiting your review.`;
        break;
      case 'Closed':
        line = `Your job ${job.job_number} is now closed. Thank you for your business.`;
        break;
      default:
        line = `We've received your job ${job.job_number} and it's now logged.`;
    }
  }
  const subject =
    kind === 'completion'
      ? `${job.job_number} — your job is complete`
      : `${job.job_number} — status update: ${job.status}`;
  const body = `Hi ${who},\n\nThis is ${company}. ${line}\n\nIf you have any questions, please get in touch.\n\nLog in to track your job: ${loginUrl}\n\nThanks,\n${company}`;
  return { subject, body };
}

const NOTE_TYPES = [
  { value: 'internal', label: 'Internal' },
  { value: 'customer', label: 'Customer' },
  { value: 'query', label: 'Query' },
  { value: 'progress', label: 'Progress' },
  { value: 'action', label: 'Action' },
];

const NOTE_COLORS: Record<string, string> = {
  internal: '#64748b',
  customer: '#14b8a6',
  query: '#f59e0b',
  progress: '#3b82f6',
  action: '#a855f7',
};

/**
 * The tab labels shown for a job, in order. Kept as a pure helper so the
 * `?tab=<label>` deep link (used by the client inspection/review banners) and
 * the rendered tab bar always agree on the index for a given label.
 */
function buildTabs(readOnly: boolean, isAdmin: boolean): string[] {
  const tabs = ['Overview', 'Inspections'];
  if (!readOnly) tabs.push('Machine Check-In');
  tabs.push('Photos', 'Documents', 'Notes', 'Timeline', 'Final Inspection', 'Review');
  if (!readOnly) tabs.push('Costing', 'Client Access');
  return tabs;
}

export default function JobDetail() {
  const { id } = useParams();
  const jobId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // "Back to Jobs" should return to wherever the user actually came from —
  // e.g. a customer search or a status/closed filter on the Jobs list — not
  // reset to the plain, unfiltered /jobs page. `location.key` is 'default'
  // when this page was opened directly (refresh, deep link, new tab), in
  // which case there's no in-app history to go back to.
  const goBackToJobs = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/jobs');
  };
  const { isClient, isAdmin } = useAuth();
  const { isMobile } = useDeviceType();
  const readOnly = isClient;

  const [job, setJob] = useState<JobDetailT | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteJob(jobId);
      navigate('/jobs', { replace: true });
    } catch (e) {
      setError(apiError(e, 'Failed to delete job'));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const reload = useCallback(() => {
    return getJob(jobId)
      .then(setJob)
      .catch((e) => setError(apiError(e, 'Failed to load job')));
  }, [jobId]);

  useEffect(() => {
    setLoading(true);
    // Paint the job as soon as it loads. The status/component dropdown data
    // (fetchMeta) can arrive a beat later without holding up the whole page.
    reload().finally(() => setLoading(false));
    fetchMeta()
      .then((m) => {
        setStatuses(m.statuses);
        setComponentTypes(m.component_types);
      })
      .catch(() => undefined);
  }, [reload]);

  // Honour a ?tab=<label> deep link (e.g. the client banners link straight to
  // "Final Inspection"). Runs once the job is loaded so the tab list is final.
  useEffect(() => {
    const want = searchParams.get('tab');
    if (!want || !job) return;
    const idx = buildTabs(readOnly, isAdmin).indexOf(want);
    if (idx >= 0) setTab(idx);
  }, [searchParams, job, readOnly, isAdmin]);

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  if (!job)
    return <Typography color="error">{error || 'Job not found.'}</Typography>;

  const tabs = buildTabs(readOnly, isAdmin);

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Button startIcon={<ArrowBackIcon />} onClick={goBackToJobs}>
          Back to Jobs
        </Button>
        {isAdmin && (
          <Button
            color="error"
            variant="outlined"
            startIcon={<DeleteIcon />}
            onClick={() => setConfirmDelete(true)}
          >
            Delete Job
          </Button>
        )}
      </Stack>

      <Box sx={{ mb: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          sx={{ flexWrap: 'wrap', rowGap: 1 }}
        >
          <Typography variant="h4" fontWeight={800} sx={{ fontSize: { xs: '1.6rem', sm: '2.125rem' } }}>
            {job.job_number}
          </Typography>
          <StatusBanner status={job.status} />
        </Stack>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          {job.customer_name}
          {job.component_type ? ` · ${job.component_type}` : ''}
          {(job.quantity ?? 1) > 1 ? ` · Qty ${job.quantity}` : ''}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {isMobile ? (
        <TextField
          select
          fullWidth
          size="small"
          label="Section"
          value={tab}
          onChange={(e) => setTab(Number(e.target.value))}
          sx={{ mb: 3 }}
        >
          {tabs.map((t, i) => (
            <MenuItem key={t} value={i}>
              {t}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((t) => (
            <Tab key={t} label={t} />
          ))}
        </Tabs>
      )}

      {tabs[tab] === 'Overview' && (
        <OverviewTab
          job={job}
          statuses={statuses}
          componentTypes={componentTypes}
          readOnly={readOnly}
          onUpdate={reload}
          setError={setError}
        />
      )}
      {tabs[tab] === 'Machine Check-In' && <CheckInTab job={job} onUpdate={reload} />}
      {tabs[tab] === 'Inspections' && (
        <InspectionsTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Photos' && (
        <PhotosTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Documents' && (
        <DocumentsTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Notes' && (
        <NotesTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Timeline' && <TimelineTab job={job} />}
      {tabs[tab] === 'Final Inspection' && (
        <FinalInspectionTab job={job} readOnly={readOnly} onUpdate={reload} setError={setError} />
      )}
      {tabs[tab] === 'Review' && (
        <ReviewTab job={job} readOnly={readOnly} setError={setError} />
      )}
      {tabs[tab] === 'Costing' && <CostingTab job={job} setError={setError} />}
      {tabs[tab] === 'Client Access' && (
        <ClientAccessTab job={job} onUpdate={reload} setError={setError} />
      )}

      <Dialog open={confirmDelete} onClose={() => !deleting && setConfirmDelete(false)} fullWidth maxWidth="xs">
        <DialogTitle>Delete {job.job_number}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This permanently removes the job and everything attached to it —
            inspections, photos, documents, notes and timeline. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete Job'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ---------------- Overview ---------------- */
function OverviewTab({
  job,
  statuses,
  componentTypes,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  statuses: string[];
  componentTypes: string[];
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const { isAdmin } = useAuth();
  const { settings } = useSettings();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    customer_name: job.customer_name,
    contact_person: job.contact_person || '',
    phone: job.phone || '',
    email: job.email || '',
    po_number: job.po_number || '',
    eq_number: job.eq_number || '',
    component_type: job.component_type || '',
    quantity: String(job.quantity ?? 1),
    due_date: job.due_date || '',
    description: job.description || '',
  });
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closing, setClosing] = useState(false);

  const changeStatus = async (status: string) => {
    try {
      await updateJob(job.id, { status });
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to update status'));
    }
  };

  const notifyWhatsapp = () => {
    const cc = settings?.whatsapp_country_code || '27';
    const num = normalizeMsisdn(job.phone, cc);
    if (!num) {
      setError('No usable phone number on this job to message.');
      return;
    }
    const company = settings?.company_name || 'WorkshopIQ';
    const text = whatsappMessage(job, company, window.location.origin);
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    logWhatsapp(job.id)
      .then(() => onUpdate())
      .catch(() => undefined);
  };

  // Email contacts: a job can have several named addresses saved against it
  // (the buyer, a site foreman, ...). These are what the Send Email dialog
  // below picks a recipient from — not the single legacy "Email" field on
  // the job, which stays around just as a general contact detail.
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactUsername, setContactUsername] = useState('');
  const [addingContact, setAddingContact] = useState(false);
  const [contactError, setContactError] = useState('');

  const addContact = async () => {
    const name = contactName.trim();
    const email = contactEmail.trim();
    const username = contactUsername.trim();
    if (!name || !email) return;
    setAddingContact(true);
    setContactError('');
    try {
      await addJobEmailContact(job.id, name, email, username || undefined);
      setContactName('');
      setContactEmail('');
      setContactUsername('');
      await onUpdate();
    } catch (e) {
      setContactError(apiError(e, 'Could not save that email contact'));
    } finally {
      setAddingContact(false);
    }
  };

  const removeContact = async (contactId: number) => {
    try {
      await deleteJobEmailContact(job.id, contactId);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not remove that email contact'));
    }
  };

  // Email notifications: fully manual — the toggles below only decide whether
  // the Send buttons show up. Clicking one opens a dialog that first asks
  // which saved contact(s) it's going to, then drafts a preview/edit-able
  // subject and body greeting that person by their saved name; the email
  // only actually goes out once staff presses Send.
  //
  // More than one contact can be picked at once. With a single contact
  // selected the draft is personalized with their name exactly as before.
  // With several selected, the draft's greeting uses a literal "{name}"
  // placeholder (still editable like any other text) — at send time each
  // recipient gets their own separate email, addressed only to them, with
  // "{name}" swapped for their own saved name. Nothing is CC'd/BCC'd together.
  const [emailDialog, setEmailDialog] = useState<'status' | 'completion' | null>(null);
  const [emailContactIds, setEmailContactIds] = useState<number[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailDialogError, setEmailDialogError] = useState('');

  const draftFor = (kind: 'status' | 'completion', recipientName: string) => {
    const company = settings?.company_name || 'WorkshopIQ';
    return draftEmail(kind, job, company, recipientName, `${window.location.origin}/login`);
  };

  const openEmailDialog = (kind: 'status' | 'completion') => {
    setEmailDialogError('');
    setEmailDialog(kind);
    // Only one contact on file? Nothing to actually choose — pick it and
    // draft straight away. More than one: leave it unselected so staff have
    // to pick who this is going to before a subject/body even appears.
    if (job.email_contacts.length === 1) {
      const only = job.email_contacts[0];
      setEmailContactIds([only.id]);
      const { subject, body } = draftFor(kind, only.name);
      setEmailSubject(subject);
      setEmailBody(body);
    } else {
      setEmailContactIds([]);
      setEmailSubject('');
      setEmailBody('');
    }
  };

  const selectEmailContacts = (contactIds: number[]) => {
    if (!emailDialog) return;
    setEmailContactIds(contactIds);
    if (contactIds.length === 0) {
      setEmailSubject('');
      setEmailBody('');
    } else if (contactIds.length === 1) {
      const contact = job.email_contacts.find((c) => c.id === contactIds[0]);
      const { subject, body } = draftFor(emailDialog, contact?.name || '');
      setEmailSubject(subject);
      setEmailBody(body);
    } else {
      const { subject, body } = draftFor(emailDialog, '{name}');
      setEmailSubject(subject);
      setEmailBody(body);
    }
  };

  const sendEmailNow = async () => {
    if (!emailDialog || emailContactIds.length === 0) return;
    setSendingEmail(true);
    setEmailDialogError('');
    const failures: string[] = [];
    try {
      // Sent one at a time so each recipient's email is addressed only to
      // them (never CC'd/BCC'd together), and one failure doesn't stop the
      // rest from going out.
      for (const contactId of emailContactIds) {
        const contact = job.email_contacts.find((c) => c.id === contactId);
        const who = contact?.name || job.contact_person || job.customer_name || 'there';
        const login = contact?.username || '';
        const subject = emailSubject.split('{name}').join(who).split('{username}').join(login);
        const body = emailBody.split('{name}').join(who).split('{username}').join(login);
        try {
          await sendJobEmail(job.id, { kind: emailDialog, contact_id: contactId, subject, body });
        } catch (e) {
          failures.push(`${contact?.name || 'recipient'}: ${apiError(e, 'failed to send')}`);
        }
      }
      await onUpdate();
      if (failures.length === 0) {
        setEmailDialog(null);
      } else {
        setEmailDialogError(`Some emails didn't send — ${failures.join('; ')}`);
      }
    } finally {
      setSendingEmail(false);
    }
  };

  const toggleJobNotify = async (
    key: 'notify_on_status_change' | 'notify_on_job_completion',
    value: boolean,
  ) => {
    try {
      await updateJob(job.id, { [key]: value });
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not change the notification setting'));
    }
  };

  const [certBusy, setCertBusy] = useState(false);
  const certPassed = job.final_inspection?.result === 'passed';
  const handleCertificate = async () => {
    setCertBusy(true);
    try {
      await downloadCertificate(job.id, job.job_number, certPassed);
    } catch (e) {
      setError(apiError(e, 'Failed to generate the document'));
    } finally {
      setCertBusy(false);
    }
  };

  const jobFinished = ['Completed', 'Awaiting Customer Review', 'Closed'].includes(job.status);
  const [packBusy, setPackBusy] = useState(false);
  const handlePack = async () => {
    setPackBusy(true);
    try {
      await downloadJobPack(job.id, job.job_number);
    } catch (e) {
      setError(apiError(e, 'Failed to build the job pack'));
    } finally {
      setPackBusy(false);
    }
  };

  const saveDetails = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      body.quantity = Math.max(1, parseInt(form.quantity, 10) || 1);
      Object.keys(body).forEach((k) => {
        if (body[k] === '') body[k] = null;
      });
      await updateJob(job.id, body);
      setEditing(false);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Grid container spacing={3}>
        {job.status === 'Closed' && (
          <Grid item xs={12}>
            <ClosedBanner />
          </Grid>
        )}
      <Grid item xs={12} md={8}>
        <Card>
          <CardContent>
            <SectionHeader
              icon={<BadgeOutlinedIcon />}
              title="Job Details"
              action={
                !readOnly &&
                (editing ? (
                  <Stack direction="row" spacing={1}>
                    <Button size="small" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                    <Button size="small" variant="contained" onClick={saveDetails} disabled={saving}>
                      Save
                    </Button>
                  </Stack>
                ) : (
                  <Button size="small" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                ))
              }
            />

            {editing ? (
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField label="Customer" fullWidth value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Contact" fullWidth value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Phone" fullWidth value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Email" fullWidth value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="PO Number" fullWidth value={form.po_number} onChange={(e) => setForm((f) => ({ ...f, po_number: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="EQ Number" fullWidth value={form.eq_number} onChange={(e) => setForm((f) => ({ ...f, eq_number: e.target.value }))} helperText="Optional" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField select label="Component Type" fullWidth value={form.component_type} onChange={(e) => setForm((f) => ({ ...f, component_type: e.target.value }))}>
                    <MenuItem value="">— Not specified —</MenuItem>
                    {componentTypes.map((c) => (
                      <MenuItem key={c} value={c}>
                        {c}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Quantity" type="number" fullWidth inputProps={{ min: 1, step: 1, inputMode: 'numeric' }} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Due Date" type="date" fullWidth InputLabelProps={{ shrink: true }} value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} helperText="Optional — leave blank to clear" />
                </Grid>
                <Grid item xs={12}>
                  <TextField label="Description" fullWidth multiline minRows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </Grid>
              </Grid>
            ) : (
              <Table size="small">
                <TableBody>
                  <Row label="Customer" value={job.customer_name} />
                  <Row label="Contact Person" value={job.contact_person} />
                  <Row label="Phone" value={job.phone} />
                  <Row label="Email" value={job.email} />
                  <Row label="PO Number" value={job.po_number} />
                  <Row label="EQ Number" value={job.eq_number} />
                  <Row label="Component Type" value={job.component_type} />
                  <Row label="Quantity" value={String(job.quantity ?? 1)} />
                  <Row label="Date Received" value={fmtDay(job.date_received)} />
                  <TableRow>
                    <TableCell sx={{ border: 0, color: 'text.secondary', width: 160, verticalAlign: 'top' }}>
                      Due Date
                    </TableCell>
                    <TableCell sx={{ border: 0 }}>
                      {job.due_date ? (
                        (() => {
                          const d = dueInfo(
                            job.due_date,
                            job.status === 'Completed' || job.status === 'Closed',
                          );
                          return (
                            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                              <span>{d.label}</span>
                              {d.chip && <Chip size="small" color={d.color} label={d.chip} />}
                            </Stack>
                          );
                        })()
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                  <Row label="Created" value={fmtDate(job.created_at)} />
                  {!readOnly && job.client_names.length > 0 && (
                    <Row label="Client Access" value={job.client_names.join(', ')} />
                  )}
                  <TableCell sx={{ border: 0, pt: 2 }} colSpan={2}>
                    <Typography variant="caption" color="text.secondary">
                      Description
                    </Typography>
                    <Typography>{job.description || '—'}</Typography>
                  </TableCell>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={4}>
        <Card>
          <CardContent>
            <SectionHeader icon={<TuneOutlinedIcon />} title="Status" />
            {readOnly ? (
              <StatusBadge status={job.status} />
            ) : isAdmin ? (
              <TextField
                select
                fullWidth
                value={job.status}
                onChange={(e) => changeStatus(e.target.value)}
              >
                {(statuses.includes(job.status) ? statuses : [job.status, ...statuses]).map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <Stack spacing={1.25} alignItems="flex-start">
                <StatusBadge status={job.status} />
                <Typography variant="caption" color="text.secondary">
                  Status updates automatically as the job moves through check-in,
                  inspection and review.
                </Typography>
                {job.status !== 'Closed' && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    startIcon={<LockOutlinedIcon />}
                    onClick={() => setConfirmClose(true)}
                  >
                    Close Job
                  </Button>
                )}
              </Stack>
            )}
            <Divider sx={{ my: 2 }} />
            {!readOnly && job.phone && (
              <Button
                fullWidth
                variant="contained"
                startIcon={<WhatsAppIcon />}
                onClick={notifyWhatsapp}
                sx={{
                  mb: 2,
                  bgcolor: '#25D366',
                  color: '#0b3d2e',
                  fontWeight: 700,
                  '&:hover': { bgcolor: '#1da851' },
                }}
              >
                Notify on WhatsApp
              </Button>
            )}
            {!readOnly && (
              <Box sx={{ mb: 2 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                  <EmailOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    EMAIL CONTACTS
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                  Save each person who should be reachable by email on this job — the
                  Send Email button below asks which one(s) to use, and greets them by
                  the name saved here. Username / Login is optional — save it if this
                  person's login differs from their name, so it can be inserted into the
                  message with a "{'{username}'}" placeholder.
                </Typography>
                {job.email_contacts.length > 0 && (
                  <Stack spacing={0.5} sx={{ mb: 1 }}>
                    {job.email_contacts.map((c) => (
                      <Stack
                        key={c.id}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={{
                          px: 1,
                          py: 0.5,
                          borderRadius: 1,
                          bgcolor: 'action.hover',
                        }}
                      >
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {c.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                            {c.email}
                            {c.username ? ` · login: ${c.username}` : ''}
                          </Typography>
                        </Box>
                        <Tooltip title="Remove">
                          <IconButton size="small" onClick={() => removeContact(c.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ))}
                  </Stack>
                )}
                <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
                  <TextField
                    size="small"
                    label="Name"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label="Email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    sx={{ flex: 1 }}
                  />
                </Stack>
                <TextField
                  size="small"
                  fullWidth
                  label="Username / Login (optional)"
                  value={contactUsername}
                  onChange={(e) => setContactUsername(e.target.value)}
                  sx={{ mb: 0.5 }}
                />
                <Button
                  fullWidth
                  size="small"
                  startIcon={<AddIcon />}
                  disabled={addingContact || !contactName.trim() || !contactEmail.trim()}
                  onClick={addContact}
                >
                  {addingContact ? 'Adding…' : 'Add Email Contact'}
                </Button>
                {contactError && (
                  <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                    {contactError}
                  </Typography>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                  <SendIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>
                    EMAIL NOTIFICATIONS
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  These switches just decide which Send buttons show up below — nothing
                  is emailed until you press Send and confirm.
                </Typography>
                <Stack>
                  <FormControlLabel
                    sx={{ ml: -1 }}
                    control={
                      <Switch
                        size="small"
                        checked={job.notify_on_status_change}
                        onChange={(e) => toggleJobNotify('notify_on_status_change', e.target.checked)}
                      />
                    }
                    label={<Typography variant="body2">Status-change emails</Typography>}
                  />
                  <FormControlLabel
                    sx={{ ml: -1 }}
                    control={
                      <Switch
                        size="small"
                        checked={job.notify_on_job_completion}
                        onChange={(e) => toggleJobNotify('notify_on_job_completion', e.target.checked)}
                      />
                    }
                    label={<Typography variant="body2">Completion email</Typography>}
                  />
                </Stack>
                {job.email_contacts.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    Add an email contact above to enable sending.
                  </Typography>
                )}
                {job.email_contacts.length > 0 && job.notify_on_status_change && (
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    startIcon={<SendIcon />}
                    onClick={() => openEmailDialog('status')}
                    sx={{ mt: 1 }}
                  >
                    Send Status Email
                  </Button>
                )}
                {job.last_status_email_at && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    Last sent {fmtDate(job.last_status_email_at)}
                  </Typography>
                )}
                {job.email_contacts.length > 0 && job.notify_on_job_completion && job.status === 'Completed' && (
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    startIcon={<SendIcon />}
                    onClick={() => openEmailDialog('completion')}
                    sx={{ mt: 1 }}
                  >
                    Send Completion Email
                  </Button>
                )}
                {job.last_completion_email_at && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                    Last sent {fmtDate(job.last_completion_email_at)}
                  </Typography>
                )}
              </Box>
            )}
            <Button
              fullWidth
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleCertificate}
              disabled={certBusy}
              sx={{ mb: 2 }}
            >
              {certBusy
                ? 'Generating…'
                : certPassed
                ? 'Download Certificate'
                : 'Download Job Report'}
            </Button>
            {jobFinished && (
              <Button
                fullWidth
                variant="contained"
                startIcon={<Inventory2OutlinedIcon />}
                onClick={handlePack}
                disabled={packBusy}
                sx={{
                  mb: 2,
                  background: 'linear-gradient(135deg, #22c55e, #0ea5e9)',
                  color: '#04150c',
                  fontWeight: 700,
                  '&:hover': { background: 'linear-gradient(135deg, #16a34a, #0284c7)' },
                }}
              >
                {packBusy ? 'Packing…' : 'Download Job Pack (.zip)'}
              </Button>
            )}
            <Stack spacing={0.25}>
              <Stat icon={<FactCheckOutlinedIcon />} label="Inspections" value={job.inspections.length} />
              <Stat icon={<PhotoLibraryOutlinedIcon />} label="Photos" value={job.photos.length} />
              <Stat icon={<FolderOutlinedIcon />} label="Documents" value={job.documents.length} />
              <Stat icon={<StickyNote2OutlinedIcon />} label="Notes" value={job.notes.length} />
            </Stack>
          </CardContent>
        </Card>
      </Grid>
      </Grid>

      <Dialog open={confirmClose} onClose={() => !closing && setConfirmClose(false)} fullWidth maxWidth="xs">
        <DialogTitle>Close {job.job_number}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This marks the job as closed — use it when a job has been pulled or
            cancelled. Normal jobs close automatically once the workflow finishes.
            An administrator can reopen it if needed.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmClose(false)} disabled={closing}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="inherit"
            startIcon={<LockOutlinedIcon />}
            disabled={closing}
            onClick={async () => {
              setClosing(true);
              await changeStatus('Closed');
              setClosing(false);
              setConfirmClose(false);
            }}
          >
            {closing ? 'Closing…' : 'Close Job'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!emailDialog}
        onClose={() => !sendingEmail && setEmailDialog(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {emailDialog === 'completion' ? 'Send Completion Email' : 'Send Status Email'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Pick who this goes to — select more than one to send to several people
            at once, each in their own separate email. Review or edit the message
            before sending — nothing goes out until you press Send below.
          </Typography>
          <Stack spacing={2}>
            <FormControl fullWidth size="small">
              <InputLabel id="email-recipient-label">Send to</InputLabel>
              <Select
                labelId="email-recipient-label"
                label="Send to"
                multiple
                value={emailContactIds}
                onChange={(e) =>
                  selectEmailContacts(
                    typeof e.target.value === 'string'
                      ? e.target.value.split(',').map(Number)
                      : (e.target.value as number[]),
                  )
                }
                renderValue={(selected) =>
                  job.email_contacts
                    .filter((c) => (selected as number[]).includes(c.id))
                    .map((c) => c.name)
                    .join(', ')
                }
              >
                {job.email_contacts.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    <Checkbox size="small" checked={emailContactIds.includes(c.id)} sx={{ mr: 1 }} />
                    {c.name} &lt;{c.email}&gt;
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {emailContactIds.length > 0 && (
              <>
                <TextField
                  label="Subject"
                  fullWidth
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                />
                <TextField
                  label="Message"
                  fullWidth
                  multiline
                  minRows={6}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  helperText={
                    emailContactIds.length > 1
                      ? '"{name}" and "{username}" are swapped for each recipient\'s own saved name and login when sent.'
                      : job.email_contacts.find((c) => c.id === emailContactIds[0])?.username
                        ? 'Tip: type "{username}" to insert their saved login name.'
                        : undefined
                  }
                />
              </>
            )}
          </Stack>
          {emailDialogError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {emailDialogError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEmailDialog(null)} disabled={sendingEmail}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={<SendIcon />}
            disabled={
              sendingEmail || emailContactIds.length === 0 || !emailSubject.trim() || !emailBody.trim()
            }
            onClick={sendEmailNow}
          >
            {sendingEmail ? 'Sending…' : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <TableRow>
      <TableCell sx={{ border: 0, color: 'text.secondary', width: 160, verticalAlign: 'top' }}>
        {label}
      </TableCell>
      <TableCell sx={{ border: 0 }}>{value || '—'}</TableCell>
    </TableRow>
  );
}

function Stat({ icon, label, value }: { icon?: ReactNode; label: string; value: number }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      justifyContent="space-between"
      sx={{
        py: 0.65,
        px: 0.75,
        mx: -0.75,
        borderRadius: 1.5,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        {icon && (
          <Box sx={{ color: 'text.secondary', display: 'flex', '& svg': { fontSize: 18 } }}>{icon}</Box>
        )}
        <Typography color="text.secondary">{label}</Typography>
      </Stack>
      <Typography fontWeight={700}>{value}</Typography>
    </Stack>
  );
}

/* ---------------- Inspections ---------------- */
function InspectionsTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [componentTypes, setComponentTypes] = useState<string[]>([]);
  const [newType, setNewType] = useState(job.component_type || '');

  useEffect(() => {
    fetchMeta().then((m) => setComponentTypes(m.component_types)).catch(() => undefined);
  }, []);

  const start = async () => {
    try {
      await createInspection(job.id, newType);
      setCreateOpen(false);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to create inspection'));
    }
  };

  return (
    <Box>
      {!readOnly && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setNewType(job.component_type || componentTypes[0] || '');
              setCreateOpen(true);
            }}
          >
            New Inspection
          </Button>
        </Stack>
      )}

      {job.inspections.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState title="No inspections yet" subtitle="Start an inspection to load its checklist." />
        </Card>
      ) : (
        <Stack spacing={3}>
          {job.inspections.map((insp) => (
            <InspectionCard
              key={insp.id}
              jobId={job.id}
              inspection={insp}
              readOnly={readOnly}
              onUpdate={onUpdate}
              setError={setError}
            />
          ))}
        </Stack>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New Inspection</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Component Type"
            fullWidth
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            sx={{ mt: 1 }}
          >
            {componentTypes.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={start} disabled={!newType}>
            Start Inspection
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function InspectionCard({
  jobId,
  inspection,
  readOnly,
  onUpdate,
  setError,
}: {
  jobId: number;
  inspection: Inspection;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [items, setItems] = useState(inspection.items);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(inspection.items);
    setDirty(false);
  }, [inspection]);

  const setResult = (itemId: number, result: string) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, result } : i)));
    setDirty(true);
  };
  const setNotes = (itemId: number, notes: string) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, notes } : i)));
    setDirty(true);
  };

  const save = async (completed?: boolean) => {
    setSaving(true);
    try {
      await updateInspection(jobId, inspection.id, {
        completed: completed ?? inspection.completed,
        items: items.map((i) => ({ id: i.id, result: i.result ?? null, notes: i.notes ?? null })),
      });
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to save inspection'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Delete this inspection?')) return;
    try {
      await deleteInspection(jobId, inspection.id);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to delete inspection'));
    }
  };

  const passCount = items.filter((i) => i.result === 'pass').length;
  const failCount = items.filter((i) => i.result === 'fail').length;

  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              {inspection.component_type} Inspection
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {fmtDate(inspection.created_at)} · {passCount} pass · {failCount} fail
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={inspection.completed ? 'Completed' : 'In Progress'}
              size="small"
              color={inspection.completed ? 'success' : 'warning'}
              variant={inspection.completed ? 'filled' : 'outlined'}
            />
            {!readOnly && (
              <IconButton size="small" color="error" onClick={remove}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={2}>
          {items.map((item) => (
            <Box key={item.id}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                spacing={1}
              >
                <Typography sx={{ flex: 1 }}>{item.label}</Typography>
                {readOnly ? (
                  <ResultBadge result={item.result} />
                ) : (
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={item.result || null}
                    onChange={(_, v) => v && setResult(item.id, v)}
                  >
                    <ToggleButton value="pass" color="success">
                      Pass
                    </ToggleButton>
                    <ToggleButton value="fail" color="error">
                      Fail
                    </ToggleButton>
                    <ToggleButton value="na">N/A</ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Stack>
              {readOnly ? (
                item.notes ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {item.notes}
                  </Typography>
                ) : null
              ) : (
                <TextField
                  placeholder="Notes…"
                  size="small"
                  fullWidth
                  value={item.notes || ''}
                  onChange={(e) => setNotes(item.id, e.target.value)}
                  sx={{ mt: 1 }}
                />
              )}
              <Divider sx={{ mt: 2 }} />
            </Box>
          ))}
        </Stack>

        {!readOnly && (
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button onClick={() => save()} disabled={saving || !dirty}>
              Save
            </Button>
            <Button
              variant="contained"
              color={inspection.completed ? 'inherit' : 'success'}
              onClick={() => save(!inspection.completed)}
              disabled={saving}
            >
              {inspection.completed ? 'Reopen' : 'Mark Complete'}
            </Button>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Photos ---------------- */
function PhotosTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [category, setCategory] = useState('general');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);

  const doUpload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        await uploadPhotos(job.id, files, category, caption || undefined);
        setCaption('');
        await onUpdate();
      } catch (e) {
        setError(apiError(e, 'Failed to upload photos'));
      } finally {
        setUploading(false);
      }
    },
    [job.id, category, caption, onUpdate, setError],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': [] },
    onDrop: doUpload,
    disabled: uploading,
  });

  const onCameraInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) doUpload(Array.from(e.target.files));
  };

  const removePhoto = async (photoId: number) => {
    try {
      await deletePhoto(job.id, photoId);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to delete photo'));
    }
  };

  const before = job.photos.filter((p) => p.category === 'before');
  const after = job.photos.filter((p) => p.category === 'after');
  const general = job.photos.filter((p) => p.category !== 'before' && p.category !== 'after');

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <TextField
                select
                label="Category"
                size="small"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="before">Before</MenuItem>
                <MenuItem value="after">After</MenuItem>
                <MenuItem value="general">General</MenuItem>
              </TextField>
              <TextField
                label="Caption (optional)"
                size="small"
                fullWidth
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
              <Button
                component="label"
                variant="outlined"
                startIcon={<PhotoCameraIcon />}
                sx={{ whiteSpace: 'nowrap' }}
              >
                Camera
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  onChange={onCameraInput}
                />
              </Button>
            </Stack>
            <Box
              {...getRootProps()}
              sx={{
                border: '2px dashed',
                borderColor: isDragActive ? 'primary.main' : 'divider',
                borderRadius: 2,
                p: 4,
                textAlign: 'center',
                cursor: 'pointer',
                bgcolor: isDragActive ? 'action.hover' : 'transparent',
              }}
            >
              <input {...getInputProps()} />
              <CloudUploadIcon sx={{ fontSize: 40, opacity: 0.5 }} />
              <Typography sx={{ mt: 1 }}>
                {uploading
                  ? 'Uploading…'
                  : isDragActive
                    ? 'Drop photos here'
                    : 'Drag & drop photos, or click to browse'}
              </Typography>
            </Box>
          </CardContent>
        </Card>

      <Stack spacing={3}>
        <PhotoSection title="Before" photos={before} jobId={job.id} canDelete={!readOnly} onDelete={removePhoto} />
        <PhotoSection title="After" photos={after} jobId={job.id} canDelete={!readOnly} onDelete={removePhoto} />
        <PhotoSection title="General" photos={general} jobId={job.id} canDelete={!readOnly} onDelete={removePhoto} />
      </Stack>
    </Box>
  );
}

function PhotoSection({
  title,
  photos,
  jobId,
  canDelete,
  onDelete,
}: {
  title: string;
  photos: JobDetailT['photos'];
  jobId: number;
  canDelete: boolean;
  onDelete: (id: number) => void;
}) {
  if (!photos.length) return null;
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
        {title} ({photos.length})
      </Typography>
      <PhotoGallery jobId={jobId} photos={photos} canDelete={canDelete} onDelete={onDelete} />
    </Box>
  );
}

/* ---------------- Documents ---------------- */
function DocumentsTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const { isAdmin } = useAuth();
  const { isTouch } = useDeviceType();
  const [uploading, setUploading] = useState(false);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    try {
      await uploadDocuments(job.id, Array.from(e.target.files));
      await onUpdate();
    } catch (err) {
      setError(apiError(err, 'Failed to upload documents'));
    } finally {
      setUploading(false);
    }
  };

  const download = async (filename: string, originalName?: string | null) => {
    // Android (Chrome AND the APK WebView) cannot reliably save a blob: URL —
    // the download manager / WebView DownloadListener only understands real
    // http(s) URLs, so blob downloads silently do nothing. Hand Android the
    // real authenticated URL (?token=) and let the OS fetch + open it. Other
    // platforms keep the proven blob path.
    if (isAndroid()) {
      const a = document.createElement('a');
      a.href = fileUrl(job.id, filename);
      a.download = originalName || filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    try {
      const url = await fetchFileBlob(job.id, filename);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalName || filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(apiError(e, 'Failed to download document'));
    }
  };

  const view = async (filename: string, originalName?: string | null) => {
    // Android Chrome's inline PDF rendering is unreliable across versions —
    // some builds download, some show a blank tab. On any touch device we
    // therefore hand the file to the OS via a download (the same proven path
    // as the Download button), so the device's PDF/image app opens it. On
    // desktop we open the real authenticated URL inline in a new tab.
    if (isTouch) {
      await download(filename, originalName);
      return;
    }
    const a = document.createElement('a');
    a.href = fileUrl(job.id, filename);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const remove = async (docId: number) => {
    try {
      await deleteDocument(job.id, docId);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to delete document'));
    }
  };

  return (
    <Box>
      {!readOnly && (
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
          <Button component="label" variant="contained" startIcon={<CloudUploadIcon />}>
            {uploading ? 'Uploading…' : 'Upload Documents'}
            <input type="file" multiple hidden onChange={onFiles} />
          </Button>
        </Stack>
      )}
      {job.documents.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState title="No documents" subtitle="Quotes, drawings and reports appear here." />
        </Card>
      ) : (
        <Card>
          <Table>
            <TableBody>
              {job.documents.map((d) => (
                <TableRow key={d.id} hover>
                  <TableCell sx={{ width: 40 }}>
                    <DescriptionIcon color="action" />
                  </TableCell>
                  <TableCell>{d.original_name || d.filename}</TableCell>
                  <TableCell>{fmtDate(d.created_at)}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => view(d.filename, d.original_name)}
                      aria-label="View document"
                      title="View"
                    >
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => download(d.filename, d.original_name)}
                      aria-label="Download document"
                      title="Download"
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                    {isAdmin && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => remove(d.id)}
                        aria-label="Delete document"
                        title="Delete"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </Box>
  );
}

/* ---------------- Notes ---------------- */
function NotesTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  // Clients may post customer-facing notes only; staff get the full set.
  const noteTypeOptions = readOnly
    ? NOTE_TYPES.filter((t) => t.value === 'customer' || t.value === 'query')
    : NOTE_TYPES;
  const [noteType, setNoteType] = useState(readOnly ? 'customer' : 'internal');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  // Clients cannot see internal notes (backend also enforces); filter defensively.
  const visible = useMemo(
    () => (readOnly ? job.notes.filter((n) => n.note_type !== 'internal') : job.notes),
    [job.notes, readOnly],
  );

  const submit = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      await addNote(job.id, noteType, body.trim());
      setBody('');
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to add note'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Type"
                size="small"
                value={noteType}
                onChange={(e) => setNoteType(e.target.value)}
                sx={{ minWidth: 160 }}
              >
                {noteTypeOptions.map((t) => (
                  <MenuItem key={t.value} value={t.value}>
                    {t.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Note"
                size="small"
                fullWidth
                multiline
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Stack>
            <Stack direction="row" justifyContent="flex-end">
              <Button variant="contained" onClick={submit} disabled={saving || !body.trim()}>
                Add Note
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card sx={{ p: 2 }}>
          <EmptyState title="No notes yet" />
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {visible.map((n) => {
            const color = NOTE_COLORS[n.note_type] || '#64748b';
            return (
              <Card key={n.id} sx={{ borderLeft: `3px solid ${color}` }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Chip
                      label={NOTE_TYPES.find((t) => t.value === n.note_type)?.label || n.note_type}
                      size="small"
                      sx={{ bgcolor: `${color}22`, color, fontWeight: 600 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {n.author_name || 'System'} · {fmtDate(n.created_at)}
                    </Typography>
                  </Stack>
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>{n.body}</Typography>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}

/* ---------------- Check-In QR ---------------- */
function CheckInTab({ job, onUpdate }: { job: JobDetailT; onUpdate: () => Promise<void> }) {
  const [status, setStatus] = useState<CheckinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    getCheckin(job.id)
      .then((s) => {
        setStatus(s);
        // If the job has just been checked in but the parent job detail still
        // thinks it hasn't, refresh it so the Final Inspection submit unlocks.
        if (s.checked_in && !job.checked_in) {
          void onUpdate();
        }
      })
      .catch((e) => setErr(apiError(e, 'Failed to load check-in')))
      .finally(() => setLoading(false));
  }, [job.id, job.checked_in, onUpdate]);

  useEffect(() => {
    load();
  }, [load]);

  const download = () => {
    if (!status) return;
    const a = document.createElement('a');
    a.href = status.qr_png;
    a.download = `checkin-${job.job_number}.png`;
    a.click();
  };

  const print = () => {
    if (!status) return;
    // printQrSheet only fires the print dialog once the QR image has fully
    // loaded inside the print document — the old fixed 250ms delay raced the
    // image and produced sheets with a blank square instead of the code.
    printQrSheet({
      title: job.job_number,
      subtitle: job.customer_name,
      qrPng: status.qr_png,
      caption: status.checked_in
        ? 'Already checked in · WorkshopIQ'
        : 'Scan to check in · WorkshopIQ',
      stamp: status.checked_in ? 'CHECKED IN' : undefined,
    });
  };

  // Check-in only opens once a (normal) inspection has been completed. Jobs
  // already checked in fall through so their status still shows.
  const inspectionDone = job.inspections.some((i) => i.completed);
  if (!inspectionDone && !job.checked_in)
    return (
      <Card sx={{ p: 3 }}>
        <Stack spacing={2} alignItems="flex-start">
          <Stack direction="row" spacing={1} alignItems="center">
            <QrCode2Icon color="disabled" />
            <Typography variant="h6" fontWeight={700}>
              Check-In QR
            </Typography>
          </Stack>
          <Alert severity="info" variant="outlined" sx={{ width: '100%' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
              Inspection not completed yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The check-in QR code becomes available once this job's inspection has
              been completed. Mark the inspection complete on the Inspections tab,
              and the QR will appear here.
            </Typography>
          </Alert>
        </Stack>
      </Card>
    );

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );

  if (err || !status)
    return (
      <Card sx={{ p: 2 }}>
        <Alert severity="error">{err || 'No check-in available.'}</Alert>
      </Card>
    );

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <QrCode2Icon color="primary" />
              <Typography variant="h6" fontWeight={700}>
                Check-In QR
              </Typography>
            </Stack>
            <Box
              sx={{
                bgcolor: '#fff',
                borderRadius: 2,
                p: 2,
                display: 'grid',
                placeItems: 'center',
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: 260,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <img
                  src={status.qr_png}
                  alt="Check-in QR code"
                  style={{
                    width: '100%',
                    maxWidth: 260,
                    imageRendering: 'pixelated',
                    // Dim + desaturate the code once it's used so it's obviously
                    // not meant to be scanned again.
                    filter: status.checked_in ? 'grayscale(1) opacity(0.3)' : 'none',
                  }}
                />
                {status.checked_in && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <Box
                      sx={{
                        width: '135%',
                        transform: 'rotate(-9deg)',
                        bgcolor: 'success.main',
                        color: '#fff',
                        py: 1.25,
                        px: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1,
                        border: '2px solid rgba(255,255,255,0.9)',
                        boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
                      }}
                    >
                      <CheckCircleIcon sx={{ fontSize: 26 }} />
                      <Typography
                        sx={{
                          fontWeight: 900,
                          letterSpacing: 1.5,
                          fontSize: { xs: 18, sm: 22 },
                          lineHeight: 1,
                        }}
                      >
                        CHECKED IN
                      </Typography>
                    </Box>
                  </Box>
                )}
              </Box>
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 1.5, wordBreak: 'break-all', fontFamily: 'monospace' }}
            >
              {status.url}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={download} fullWidth>
                Download
              </Button>
              <Button variant="outlined" startIcon={<PrintIcon />} onClick={print} fullWidth>
                Print
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={7}>
        <Card>
          <CardContent>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="h6" fontWeight={700}>
                Status
              </Typography>
              <Button size="small" startIcon={<RefreshIcon />} onClick={load}>
                Refresh
              </Button>
            </Stack>

            {status.checked_in ? (
              <Box>
                <Chip label="Checked in" color="success" sx={{ mb: 2, fontWeight: 600 }} />
                <Table size="small">
                  <TableBody>
                    <Row label="Operator" value={status.operator_name} />
                    <Row label="Machine" value={status.machine} />
                    <Row
                      label="Checked in"
                      value={status.checked_in_at ? fmtDate(status.checked_in_at) : '—'}
                    />
                  </TableBody>
                </Table>
              </Box>
            ) : (
              <Box>
                <Chip label="Awaiting check-in" sx={{ mb: 2, fontWeight: 600 }} />
                <Typography variant="body2" color="text.secondary">
                  Print the QR and place it on the machine or job. The first person to scan it and
                  submit the form will be recorded here — and the code then locks (one-time).
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

/* ---------------- Timeline ---------------- */
function TimelineTab({ job }: { job: JobDetailT }) {
  if (!job.timeline.length)
    return (
      <Card sx={{ p: 2 }}>
        <EmptyState title="No activity yet" />
      </Card>
    );
  return (
    <Card>
      <CardContent>
        <Stack spacing={0}>
          {job.timeline.map((ev, idx) => (
            <Stack key={ev.id} direction="row" spacing={2}>
              <Stack alignItems="center">
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'primary.main', mt: 0.5 }} />
                {idx < job.timeline.length - 1 && (
                  <Box sx={{ width: 2, flexGrow: 1, bgcolor: 'divider', my: 0.5 }} />
                )}
              </Stack>
              <Box sx={{ pb: 3 }}>
                <Typography fontWeight={600}>{ev.description}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {ev.actor_name || 'System'} · {fmtDate(ev.created_at)}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ---------------- Final Inspection ---------------- */
function InspectionReport({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const fi = job.final_inspection || null;
  const log = fi?.attempts_log || [];
  const photos = job.photos || [];

  const before = photos.filter((p) => p.category === 'before');
  const after = photos.filter((p) => p.category === 'after');
  const general = photos.filter(
    (p) => p.category !== 'before' && p.category !== 'after',
  );

  const [uploading, setUploading] = useState(false);

  const addAfterPhotos = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      await uploadPhotos(job.id, files, 'after');
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to upload photos'));
    } finally {
      setUploading(false);
    }
  };

  const onPickAfter = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addAfterPhotos(Array.from(e.target.files));
    e.target.value = '';
  };

  const removePhoto = async (photoId: number) => {
    try {
      await deletePhoto(job.id, photoId);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to delete photo'));
    }
  };

  // Clients with nothing on record see nothing; staff always get the uploader.
  if (!log.length && !photos.length && readOnly) return null;
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6" fontWeight={800}>
            Inspection Report
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Full history of this job's final inspection — every attempt, in order,
            with the photos on record.
          </Typography>
          <Divider />
          {log.length > 0 && (
            <Stack spacing={1.25} sx={{ mt: 0.5 }}>
              {log.map((a) => {
                const failed = a.result === 'failed';
                return (
                  <Box
                    key={a.id}
                    sx={{
                      display: 'flex',
                      gap: 1.5,
                      p: 1.25,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: failed ? 'error.main' : 'success.main',
                      bgcolor: failed ? 'rgba(244,63,94,0.06)' : 'rgba(34,197,94,0.06)',
                    }}
                  >
                    <Box sx={{ minWidth: 78 }}>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Attempt {a.attempt_number}
                      </Typography>
                      <Chip
                        label={failed ? 'Failed' : 'Passed'}
                        size="small"
                        color={failed ? 'error' : 'success'}
                        sx={{ fontWeight: 700, mt: 0.25 }}
                      />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {failed && a.reason && (
                        <Typography sx={{ whiteSpace: 'pre-wrap' }}>{a.reason}</Typography>
                      )}
                      {failed && a.ncr_number && (
                        <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.25 }}>
                          NCR: {a.ncr_number}
                        </Typography>
                      )}
                      {!failed && (
                        <Typography color="text.secondary">
                          Signed off{a.internal_reference ? ` · ref ${a.internal_reference}` : ''}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        {a.inspector_name || '—'} · {fmtDate(a.created_at)}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          )}
          {photos.length > 0 && log.length > 0 && <Divider sx={{ mt: 0.5 }} />}

          {before.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, mt: 0.5 }}>
                Before photos ({before.length})
              </Typography>
              <PhotoGallery jobId={job.id} photos={before} canDelete={false} />
            </Box>
          )}

          <Box>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              flexWrap="wrap"
              useFlexGap
              spacing={1}
              sx={{ mb: 1, mt: 0.5 }}
            >
              <Typography variant="subtitle2" fontWeight={700}>
                During / after inspection photos ({after.length})
              </Typography>
              {!readOnly && (
                <Stack direction="row" spacing={1}>
                  <Button
                    component="label"
                    size="small"
                    variant="outlined"
                    startIcon={<PhotoCameraIcon />}
                    disabled={uploading}
                  >
                    Camera
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      hidden
                      onChange={onPickAfter}
                    />
                  </Button>
                  <Button
                    component="label"
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    disabled={uploading}
                  >
                    Add photos
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={onPickAfter}
                    />
                  </Button>
                </Stack>
              )}
            </Stack>
            {uploading && (
              <Typography variant="caption" color="text.secondary">
                Uploading…
              </Typography>
            )}
            {after.length > 0 ? (
              <PhotoGallery
                jobId={job.id}
                photos={after}
                canDelete={!readOnly}
                onDelete={removePhoto}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No inspection photos yet.
                {!readOnly ? ' Use Camera or Add photos to attach some.' : ''}
              </Typography>
            )}
          </Box>

          {general.length > 0 && (
            <Box>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, mt: 0.5 }}>
                Other photos ({general.length})
              </Typography>
              <PhotoGallery jobId={job.id} photos={general} canDelete={false} />
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function FinalInspectionTab({
  job,
  readOnly,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const fi = job.final_inspection || null;
  // Once the job has been sent to the customer for review (either the normal
  // way or via skip-inspection) it's "Awaiting Customer Review"; once done it's
  // "Closed". In both cases the inspection actions must not stay live: submit &
  // skip lock in both states; request closure stays available while awaiting a
  // review (as a fallback) but locks once the job is closed.
  const reviewSent = job.status === 'Awaiting Customer Review';
  const isClosed = job.status === 'Closed';
  const lockInspectionActions = reviewSent || isClosed;
  // Releasing the inspection or sending for review pushes work to the assigned
  // client — block it (and the server does too) until at least one is assigned.
  const hasClientAccess = job.client_user_ids.length > 0;
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [ncrNumber, setNcrNumber] = useState('');
  const [failing, setFailing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [offMachine, setOffMachine] = useState(false);

  // True when this release is sending a failed job back round for re-inspection.
  const isReinspect = !!fi && fi.result === 'failed';

  const openConfirm = () => {
    setOffMachine(false);
    setConfirmRelease(true);
  };

  const release = async () => {
    setBusy(true);
    try {
      await releaseFinalInspection(job.id);
      await onUpdate();
      setConfirmRelease(false);
      setOffMachine(false);
    } catch (e) {
      setError(apiError(e, 'Could not release final inspection'));
    } finally {
      setBusy(false);
    }
  };

  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelRelease = async () => {
    setBusy(true);
    try {
      await cancelFinalInspection(job.id);
      await onUpdate();
      setConfirmCancel(false);
    } catch (e) {
      setError(apiError(e, 'Could not cancel the inspection'));
    } finally {
      setBusy(false);
    }
  };

  const submitPass = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await submitFinalInspection(job.id, {
        inspector_name: name.trim(),
        internal_reference: reference.trim() || undefined,
      });
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not submit final inspection'));
    } finally {
      setBusy(false);
    }
  };

  const submitFail = async () => {
    if (!name.trim() || !reason.trim()) return;
    setBusy(true);
    try {
      await failFinalInspection(job.id, {
        inspector_name: name.trim(),
        reason: reason.trim(),
        ncr_number: ncrNumber.trim() || undefined,
      });
      setFailing(false);
      setReason('');
      setNcrNumber('');
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not record the failed inspection'));
    } finally {
      setBusy(false);
    }
  };

  // ---- Request for closure (client won't inspect → admin-approved pass) ----
  const { isAdmin } = useAuth();
  const [closureOpen, setClosureOpen] = useState(false);
  const [closureReason, setClosureReason] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const submitClosureRequest = async () => {
    setBusy(true);
    try {
      await requestClosure(job.id, { reason: closureReason.trim() || undefined });
      setClosureOpen(false);
      setClosureReason('');
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not request closure'));
    } finally {
      setBusy(false);
    }
  };

  const doApproveClosure = async () => {
    setBusy(true);
    try {
      await approveClosure(job.id);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not approve closure'));
    } finally {
      setBusy(false);
    }
  };

  const doRejectClosure = async () => {
    setBusy(true);
    try {
      await rejectClosure(job.id, { reason: rejectReason.trim() || undefined });
      setRejectOpen(false);
      setRejectReason('');
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not reject closure'));
    } finally {
      setBusy(false);
    }
  };

  // ---- Skip inspection & send for review (no inspector → client review is the
  // sign-off; submitting it auto-closes the job). Any staff, no approval. ----
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipConfirmed, setSkipConfirmed] = useState(false);

  const submitSkipReview = async () => {
    setBusy(true);
    try {
      await skipInspectionReview(job.id);
      setSkipOpen(false);
      setSkipConfirmed(false);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Could not send the job for review'));
    } finally {
      setBusy(false);
    }
  };

  // Reusable "Request closure" button for staff (shown alongside the normal
  // inspection actions, for when a client won't do the final inspection).
  const requestClosureButton = (
    <Button
      color="inherit"
      variant="outlined"
      onClick={() => {
        setClosureReason('');
        setClosureOpen(true);
      }}
      disabled={busy || isClosed}
    >
      Request closure
    </Button>
  );

  // Reusable "Skip inspection & send for review" button. For jobs with no
  // inspector coming out — sends straight to the client for review instead.
  const skipReviewButton = (
    <Button
      color="primary"
      variant="outlined"
      startIcon={<StarBorderPurple500Icon />}
      onClick={() => {
        setSkipConfirmed(false);
        setSkipOpen(true);
      }}
      disabled={busy || lockInspectionActions || !hasClientAccess}
    >
      Skip inspection &amp; send for review
    </Button>
  );

  // Shown wherever a client-facing action is offered but nobody's assigned yet.
  const clientAccessHint = !hasClientAccess ? (
    <Alert severity="warning" variant="outlined" sx={{ width: '100%' }}>
      No client has access to this job yet. Add at least one under the{' '}
      <strong>Client Access</strong> tab before releasing the inspection or sending
      it for review.
    </Alert>
  ) : null;

  // Shown after an admin has declined a previous closure request.
  const rejectedNotice =
    fi && fi.closure_status === 'rejected' ? (
      <Alert severity="info" variant="outlined" sx={{ width: '100%' }}>
        A previous closure request was declined
        {fi.closure_rejection_reason ? `: ${fi.closure_rejection_reason}` : ''}. You can
        request closure again or run the normal client inspection.
      </Alert>
    ) : null;

  let content: JSX.Element;

  if (fi?.completed) {
    // ---- Passed ----
    content = (
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                {fi.closure_status === 'approved' && (
                  <Chip
                    label="Internal closure"
                    color="warning"
                    size="small"
                    variant="outlined"
                  />
                )}
                <Chip label="Passed" color="success" size="small" />
              </Stack>
            </Stack>
            <Divider />
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Inspector
              </Typography>
              <Typography>{fi.inspector_name || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                Internal reference
              </Typography>
              <Typography>{fi.internal_reference || '—'}</Typography>
            </Box>
            {fi.attempts > 0 && (
              <Typography variant="caption" color="text.secondary">
                Passed after {fi.attempts} failed{' '}
                {fi.attempts === 1 ? 'inspection' : 'inspections'}.
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Submitted{fi.completed_at ? ` · ${fmtDate(fi.completed_at)}` : ''}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  } else if (fi && fi.closure_status === 'pending') {
    // ---- Closure requested — awaiting admin approval ----
    content = (
      <Card sx={{ borderColor: 'warning.main' }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              <Chip label="Closure pending" color="warning" size="small" />
            </Stack>
            <Alert severity="warning" variant="outlined">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                Closure requested
              </Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {fi.closure_reason || 'Client to skip the final inspection.'}
              </Typography>
            </Alert>
            <Typography variant="caption" color="text.secondary">
              Requested
              {fi.closure_requested_at ? ` · ${fmtDate(fi.closure_requested_at)}` : ''} ·
              awaiting admin approval
            </Typography>
            <Divider />
            {isAdmin ? (
              <>
                <Typography color="text.secondary">
                  Approving passes the final inspection internally (no client
                  sign-off) and moves the job straight to Closed. Rejecting
                  leaves the job exactly where it is.
                </Typography>
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    color="error"
                    variant="outlined"
                    onClick={() => {
                      setRejectReason('');
                      setRejectOpen(true);
                    }}
                    disabled={busy}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={doApproveClosure}
                    disabled={busy}
                  >
                    {busy ? 'Approving…' : 'Approve closure'}
                  </Button>
                </Stack>
              </>
            ) : (
              <Typography color="text.secondary">
                This job is awaiting an administrator's approval to close without a
                client final inspection.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  } else if (fi && fi.result === 'failed') {
    // ---- Failed — awaiting workshop fix + re-inspection ----
    content = (
      <Card sx={{ borderColor: 'error.main' }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              <Chip label="Failed" color="error" size="small" />
            </Stack>
            <Alert severity="error" variant="outlined">
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                Reason for failure
              </Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                {fi.failure_reason || '—'}
              </Typography>
              {fi.ncr_number && (
                <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
                  NCR: {fi.ncr_number}
                </Typography>
              )}
            </Alert>
            <Typography variant="caption" color="text.secondary">
              Failed by {fi.inspector_name || 'client'}
              {fi.failed_at ? ` · ${fmtDate(fi.failed_at)}` : ''} · attempt {fi.attempts}
            </Typography>
            <Divider />
            {readOnly ? (
              <Typography color="text.secondary">
                You marked this inspection as failed. The workshop has been notified
                and will address the issue before sending it back for re-inspection.
              </Typography>
            ) : (
              <>
                <Typography color="text.secondary">
                  Address the issue above, then send the job back for re-inspection.
                  This returns it to the Inspection stage and re-opens the sign-off
                  form for the client.
                </Typography>
                {clientAccessHint}
                <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
                  {skipReviewButton}
                  {requestClosureButton}
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={openConfirm}
                    disabled={busy || !hasClientAccess}
                  >
                    {busy ? 'Sending…' : 'Send for re-inspection'}
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  } else if (fi) {
    // ---- Released, awaiting client sign-off (pending / re-inspection) ----
    const isReinspection = fi.attempts > 0;
    if (readOnly) {
      content = (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              {isReinspection && fi.failure_reason && (
                <Alert severity="warning" variant="outlined">
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                    Re-inspection · previous failure
                  </Typography>
                  <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                    {fi.failure_reason}
                  </Typography>
                  {fi.ncr_number && (
                    <Typography variant="body2" sx={{ mt: 1, fontWeight: 700 }}>
                      NCR: {fi.ncr_number}
                    </Typography>
                  )}
                </Alert>
              )}
              <Typography color="text.secondary">
                Confirm the final inspection for this job. Enter the inspector's name,
                then pass it or, if there's a problem, fail it with a reason.
              </Typography>
              <TextField
                label="Inspector name & surname"
                size="small"
                fullWidth
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {!failing && (
                <TextField
                  label="Internal reference (optional)"
                  size="small"
                  fullWidth
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              )}
              {failing && (
                <TextField
                  label="Reason for failure"
                  size="small"
                  fullWidth
                  required
                  multiline
                  minRows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe what failed so the workshop can fix it"
                />
              )}
              {failing && (
                <TextField
                  label="NCR number (optional)"
                  size="small"
                  fullWidth
                  value={ncrNumber}
                  onChange={(e) => setNcrNumber(e.target.value)}
                  placeholder="e.g. NCR 0042 — link this failure to a raised NCR"
                />
              )}
              {!failing ? (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    color="error"
                    variant="outlined"
                    onClick={() => setFailing(true)}
                    disabled={busy}
                  >
                    Fail inspection
                  </Button>
                  <Button
                    variant="contained"
                    color="success"
                    onClick={submitPass}
                    disabled={busy || !name.trim()}
                  >
                    {busy ? 'Submitting…' : 'Pass inspection'}
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button
                    variant="text"
                    onClick={() => {
                      setFailing(false);
                      setReason('');
                      setNcrNumber('');
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={submitFail}
                    disabled={busy || !name.trim() || !reason.trim()}
                  >
                    {busy ? 'Submitting…' : 'Submit failed inspection'}
                  </Button>
                </Stack>
              )}
            </Stack>
          </CardContent>
        </Card>
      );
    } else {
      content = (
        <Card>
          <CardContent>
            <Stack spacing={2} alignItems="flex-start">
              <Typography variant="h6" fontWeight={800}>
                Final Inspection
              </Typography>
              <Chip
                label={`${
                  isReinspection
                    ? 'Awaiting client re-inspection'
                    : 'Awaiting client final inspection'
                } · released ${fmtDate(fi.requested_at)}`}
                variant="outlined"
              />
              {isReinspection && fi.failure_reason && (
                <Typography variant="body2" color="text.secondary">
                  Last failure: {fi.failure_reason}
                  {fi.ncr_number ? ` · NCR ${fi.ncr_number}` : ''}
                </Typography>
              )}
              {rejectedNotice}
              <Divider sx={{ width: '100%' }} />
              <Typography variant="body2" color="text.secondary">
                If the client won't do the final inspection, request closure. An
                admin approves it and the inspection is passed internally. Or, if
                this was released by mistake or there's no inspector on the
                client's side yet, cancel it and pull the job back.
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {skipReviewButton}
                {requestClosureButton}
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={() => setConfirmCancel(true)}
                  disabled={busy}
                >
                  Cancel inspection
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      );
    }
  } else {
    // ---- Not yet released ----
    content = (
      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Typography variant="h6" fontWeight={800}>
              Final Inspection
            </Typography>
            {readOnly ? (
              <Typography color="text.secondary">
                The final inspection isn't available yet. It will appear here once the
                workshop releases it.
              </Typography>
            ) : isClosed || reviewSent ? (
              <>
                <Alert
                  severity={isClosed ? 'success' : 'info'}
                  variant="outlined"
                  sx={{ width: '100%' }}
                >
                  {isClosed
                    ? 'This job is closed — no further inspection actions are needed.'
                    : 'This job has been sent to the customer for their review. When they submit it, the job closes automatically. If they don’t respond, you can still request closure.'}
                </Alert>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button variant="contained" onClick={openConfirm} disabled>
                    Submit final inspection
                  </Button>
                  {skipReviewButton}
                  {requestClosureButton}
                </Stack>
              </>
            ) : !job.checked_in ? (
              <Alert severity="info" variant="outlined" sx={{ width: '100%' }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Awaiting check-in
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  The final inspection can only be submitted once the job's QR code has
                  been scanned and the job is checked in. Print the QR from the Check-In
                  tab and have it scanned on the machine first.
                </Typography>
              </Alert>
            ) : (
              <>
                <Typography color="text.secondary">
                  Submitting the final inspection moves this job to the Inspection stage
                  and makes the sign-off form available to the assigned client. They can
                  pass it or fail it with a reason; the customer review unlocks only once
                  it passes.
                </Typography>
                {rejectedNotice}
                {clientAccessHint}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    variant="contained"
                    onClick={openConfirm}
                    disabled={busy || lockInspectionActions || !hasClientAccess}
                  >
                    {busy ? 'Submitting…' : 'Submit final inspection'}
                  </Button>
                  {skipReviewButton}
                  {requestClosureButton}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  Not every client inspects. If this one won't, use “Request closure”
                  (an admin approves it and the inspection passes internally), or “Skip
                  inspection &amp; send for review” to send it straight to the client —
                  their review then closes the job.
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2.5}>
      {content}
      <InspectionReport
        job={job}
        readOnly={readOnly}
        onUpdate={onUpdate}
        setError={setError}
      />

      <Dialog
        open={confirmRelease}
        onClose={() => !busy && setConfirmRelease(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>
          {isReinspect ? 'Send for re-inspection?' : 'Ready for inspection?'}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            {isReinspect
              ? 'This sends the job back to the Inspection stage and re-opens the client sign-off form.'
              : 'This moves the job to the Inspection stage and opens the sign-off form for the assigned client.'}
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={offMachine}
                onChange={(e) => setOffMachine(e.target.checked)}
              />
            }
            label="The job is off the machine and machining is finished."
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmRelease(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={release}
            disabled={!offMachine || busy}
          >
            {busy ? 'Submitting…' : 'Confirm & submit'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmCancel}
        onClose={() => !busy && setConfirmCancel(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Cancel this inspection?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {fi && fi.attempts > 0
              ? 'This puts the job back where it was before it was sent for re-inspection (Inspection Failed), keeping the failure on record.'
              : 'This pulls the job out of the Inspection stage and back to Machining. You can release it again later, or request closure instead.'}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmCancel(false)} disabled={busy}>
            Back
          </Button>
          <Button variant="contained" color="error" onClick={cancelRelease} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel inspection'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={closureOpen}
        onClose={() => !busy && setClosureOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Request closure?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            This asks an admin to pass the final inspection internally, without a
            client sign-off. They'll get a heads-up and can approve or decline it.
          </Typography>
          <TextField
            label="Reason (optional)"
            size="small"
            fullWidth
            multiline
            minRows={2}
            autoFocus
            value={closureReason}
            onChange={(e) => setClosureReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setClosureOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={submitClosureRequest} disabled={busy}>
            {busy ? 'Requesting…' : 'Request closure'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={skipOpen}
        onClose={() => !busy && setSkipOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Skip inspection & send for review?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            This skips the final inspection and sends the job straight to the client
            for their review. When they submit their rating, the job closes
            automatically. If they never review it, you can still request closure.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={skipConfirmed}
                onChange={(e) => setSkipConfirmed(e.target.checked)}
              />
            }
            label="I confirm we're skipping the final inspection for this job."
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSkipOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submitSkipReview}
            disabled={!skipConfirmed || busy}
          >
            {busy ? 'Sending…' : 'Send for review'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={rejectOpen}
        onClose={() => !busy && setRejectOpen(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Reject closure request?</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 1.5 }}>
            The job is left exactly where it is. Staff can re-request closure or run
            the normal client inspection.
          </Typography>
          <TextField
            label="Reason (optional)"
            size="small"
            fullWidth
            multiline
            minRows={2}
            autoFocus
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRejectOpen(false)} disabled={busy}>
            Back
          </Button>
          <Button variant="contained" color="error" onClick={doRejectClosure} disabled={busy}>
            {busy ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/* ---------------- Customer Review ---------------- */
function ReviewTab({
  job,
  readOnly,
  setError,
}: {
  job: JobDetailT;
  readOnly: boolean;
  setError: (s: string) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  // A review can only be requested once the final inspection is complete.
  const finalDone = !!job.final_inspection?.completed;

  const load = useCallback(() => {
    setLoading(true);
    return getReview(job.id)
      .then((r) => setReview(r))
      .catch((e) => setError(apiError(e, 'Failed to load review')))
      .finally(() => setLoading(false));
  }, [job.id, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRequest = async () => {
    setBusy(true);
    try {
      const r = await requestReview(job.id);
      setReview(r);
    } catch (e) {
      setError(apiError(e, 'Could not request review'));
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );

  // Completed — show the result to everyone
  if (review?.completed) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="h6" fontWeight={800}>
                Customer Review
              </Typography>
              <Chip label="Completed" color="success" size="small" />
            </Stack>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Rating value={review.rating || 0} readOnly />
              <Typography fontWeight={700}>{review.rating}/5</Typography>
            </Stack>
            <Divider />
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                What they were happy with
              </Typography>
              <Typography>{review.feedback || '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="subtitle2" color="text.secondary">
                How we could improve
              </Typography>
              <Typography>{review.improvement || '—'}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              Submitted by {review.reviewer_name || 'client'}
              {review.completed_at ? ` · ${fmtDate(review.completed_at)}` : ''}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  // Requested but not completed
  if (review) {
    return (
      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Typography variant="h6" fontWeight={800}>
              Customer Review
            </Typography>
            {readOnly ? (
              <>
                <Typography color="text.secondary">
                  Please leave a rating for this job. Your feedback helps us improve.
                </Typography>
                <Button variant="contained" onClick={() => setDialogOpen(true)}>
                  Leave review
                </Button>
              </>
            ) : (
              <Chip label={`Awaiting client review · requested ${fmtDate(review.requested_at)}`} variant="outlined" />
            )}
          </Stack>
        </CardContent>
        <ReviewDialog
          open={dialogOpen}
          jobId={job.id}
          jobNumber={job.job_number}
          customerName={job.customer_name}
          onClose={() => setDialogOpen(false)}
          onSubmitted={load}
        />
      </Card>
    );
  }

  // No review yet
  return (
    <Card>
      <CardContent>
        <Stack spacing={2} alignItems="flex-start">
          <Typography variant="h6" fontWeight={800}>
            Customer Review
          </Typography>
          {readOnly ? (
            <Typography color="text.secondary">
              No review has been requested for this job yet.
            </Typography>
          ) : (
            <>
              <Typography color="text.secondary">
                Request a satisfaction review from the assigned client. They'll be
                prompted to rate this job every time they log in until they submit.
              </Typography>
              {!finalDone && (
                <Typography variant="body2" color="text.secondary">
                  The final inspection must be completed before a review can be requested.
                </Typography>
              )}
              {job.client_user_ids.length === 0 && (
                <Typography variant="body2" color="warning.main">
                  Assign at least one client under the Client Access tab first —
                  otherwise there's nobody to send the review to.
                </Typography>
              )}
              <Button
                variant="contained"
                onClick={handleRequest}
                disabled={busy || !finalDone || job.client_user_ids.length === 0}
              >
                {busy ? 'Requesting…' : 'Request customer review'}
              </Button>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

/* ---------------- Costing (staff & admin only) ---------------- */
function CostingTab({
  job,
  setError,
}: {
  job: JobDetailT;
  setError: (s: string) => void;
}) {
  const [items, setItems] = useState<JobCostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ description: '', supplier: '', quantity: '1', unit_cost: '' });

  const load = useCallback(() => {
    setLoading(true);
    listCostItems(job.id)
      .then(setItems)
      .catch((e) => setError(apiError(e, 'Failed to load costing')))
      .finally(() => setLoading(false));
  }, [job.id, setError]);

  useEffect(() => {
    load();
  }, [load]);

  const total = useMemo(
    () => items.reduce((sum, i) => sum + (i.line_total || 0), 0),
    [items],
  );

  const add = async () => {
    if (!form.description.trim()) return;
    setSaving(true);
    try {
      await addCostItem(job.id, {
        description: form.description.trim(),
        supplier: form.supplier.trim() || undefined,
        quantity: Number(form.quantity) || 0,
        unit_cost: Number(form.unit_cost) || 0,
      });
      setForm({ description: '', supplier: '', quantity: '1', unit_cost: '' });
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to add cost line'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await deleteCostItem(job.id, id);
      load();
    } catch (e) {
      setError(apiError(e, 'Failed to delete cost line'));
    }
  };

  return (
    <Box>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <LockOutlinedIcon fontSize="small" color="disabled" />
            <Typography variant="body2" color="text.secondary">
              Internal supplier costing — visible to staff and administrators only. Clients never see this tab.
            </Typography>
          </Stack>
          <Grid container spacing={2} alignItems="flex-end">
            <Grid item xs={12} sm={4}>
              <TextField
                label="Description"
                size="small"
                fullWidth
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField
                label="Supplier"
                size="small"
                fullWidth
                value={form.supplier}
                onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField
                label="Qty"
                size="small"
                type="number"
                fullWidth
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField
                label="Unit cost (R)"
                size="small"
                type="number"
                fullWidth
                value={form.unit_cost}
                onChange={(e) => setForm((f) => ({ ...f, unit_cost: e.target.value }))}
              />
            </Grid>
            <Grid item xs={12} sm={1}>
              <Button
                variant="contained"
                fullWidth
                onClick={add}
                disabled={saving || !form.description.trim()}
                sx={{ height: 40 }}
              >
                Add
              </Button>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {loading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : items.length === 0 ? (
            <EmptyState title="No costing lines yet" subtitle="Add your supplier costs above." />
          ) : (
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ color: 'text.secondary' }}>Description</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>Supplier</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>Qty</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>Unit</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>Line total</TableCell>
                  <TableCell />
                </TableRow>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.description}</TableCell>
                    <TableCell>{i.supplier || '—'}</TableCell>
                    <TableCell align="right">{i.quantity}</TableCell>
                    <TableCell align="right">{fmtMoney(i.unit_cost)}</TableCell>
                    <TableCell align="right">{fmtMoney(i.line_total)}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => remove(i.id)} aria-label="Delete cost line">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={4} sx={{ border: 0 }} />
                  <TableCell align="right" sx={{ border: 0, fontWeight: 700, fontSize: '1rem' }}>
                    {fmtMoney(total)}
                  </TableCell>
                  <TableCell sx={{ border: 0 }} />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

/* ---------------- Client Access (staff & admin) ---------------- */
function ClientAccessTab({
  job,
  onUpdate,
  setError,
}: {
  job: JobDetailT;
  onUpdate: () => Promise<void>;
  setError: (s: string) => void;
}) {
  const [clients, setClients] = useState<User[]>([]);
  const [selected, setSelected] = useState<number[]>(job.client_user_ids);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listClients()
      .then(setClients)
      .catch((e) => setError(apiError(e, 'Failed to load clients')));
  }, [setError]);

  useEffect(() => {
    setSelected(job.client_user_ids);
  }, [job.client_user_ids]);

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const save = async () => {
    setSaving(true);
    try {
      await assignClients(job.id, selected);
      await onUpdate();
    } catch (e) {
      setError(apiError(e, 'Failed to assign clients'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" fontWeight={700}>
          Client Access
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Selected client users can view this job in their portal. They see status, progress,
          customer-facing notes, photos and documents — but cannot edit.
        </Typography>
        {clients.length === 0 ? (
          <EmptyState title="No client users" subtitle="Create client users on the Users page first." />
        ) : (
          <Stack>
            {clients.map((c) => (
              <FormControlLabel
                key={c.id}
                control={<Checkbox checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />}
                label={
                  <span>
                    {c.full_name || c.username}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      ({c.username})
                    </Typography>
                  </span>
                }
              />
            ))}
          </Stack>
        )}
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button variant="contained" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Access'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
