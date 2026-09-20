import axios from 'axios';
import { getToken, clearToken } from './token';
import type {
  AppSettings,
  BackupJobStart,
  BackupProgress,
  CheckinLists,
  CheckinListItem,
  CheckinStatus,
  Customer,
  DashboardStats,
  FinalInspection,
  Inspection,
  InspectionReportItem,
  InspectionReportDetail,
  PendingClientSignature,
  JobDetail,
  JobListItem,
  JobCostItem,
  JobReportResponse,
  LicenseStatus,
  LoginResponse,
  Note,
  Photo,
  PendingReview,
  PendingInspection,
  PendingClosure,
  NCR,
  NCRListItem,
  NCRMeta,
  Review,
  ReviewNotification,
  SambaStatus,
  SambaUpdate,
  SambaActionResult,
  SambaBackupStart,
  SambaBackupProgress,
  Template,
  TrainableWorker,
  TrainingRecordItem,
  User,
} from '../types';

const api = axios.create({ baseURL: '/api', timeout: 30000 });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Defeat aggressive mobile WebView/browser disk caching of GET responses
  // (e.g. a stale /api/jobs list showing an old count). A unique param makes
  // every GET a distinct URL the cache can't satisfy from disk.
  if ((config.method || 'get').toLowerCase() === 'get') {
    config.params = { ...(config.params || {}), _: Date.now() };
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      clearToken();
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    // Maintenance mode / server shutdown: the server refuses non-admin requests
    // with a tagged 503. Drop the session and send the person to the login
    // screen, where a banner explains what's going on. Shutdown is flagged
    // separately so login shows the "server shut down" wording.
    const maintData = error.response?.data as
      | { maintenance?: boolean; shutdown?: boolean }
      | undefined;
    if (
      error.response?.status === 503 &&
      (maintData?.maintenance || maintData?.shutdown) &&
      !error.config?.url?.includes('/auth/login')
    ) {
      if (maintData?.shutdown) sessionStorage.setItem('wiq-shutdown', '1');
      else sessionStorage.setItem('wiq-maintenance', '1');
      clearToken();
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export const apiError = (e: unknown, fallback = 'Something went wrong'): string => {
  if (axios.isAxiosError(e)) {
    if (e.code === 'ECONNABORTED') return 'The server took too long to respond. Please try again.';
    if (e.code === 'ERR_NETWORK') return 'Network error — could not reach the server.';
    const d = e.response?.data?.detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  }
  return fallback;
};

// License activation. Both endpoints are reachable even on an unlicensed
// install (see the license_gate middleware) — that's the only door in.
export const getLicenseStatus = async () =>
  (await api.get<LicenseStatus>('/license/status')).data;
export const activateLicense = async (license_key: string) =>
  (await api.post<LicenseStatus>('/license/activate', { license_key })).data;
// Ask the AR Smart Home licence server for this install's key.
export const requestLicense = async () =>
  (await api.post<LicenseStatus>('/license/request')).data;

// Auth
export const login = async (username: string, password: string) => {
  const form = new URLSearchParams({ username, password });
  const { data } = await api.post<LoginResponse>('/auth/login', form);
  return data;
};
export const fetchMe = async () => (await api.get<User>('/auth/me')).data;
export const changePassword = (current_password: string, new_password: string) =>
  api.post('/auth/change-password', { current_password, new_password });
export const acceptTerms = async () => (await api.post<User>('/auth/accept-terms')).data;
// Self-service appearance preference (any role). Returns the updated user.
export const updatePreferences = async (theme_preference: 'light' | 'dark' | 'system') =>
  (await api.patch<User>('/auth/preferences', { theme_preference })).data;

// Users
export const listUsers = async () => (await api.get<User[]>('/users')).data;
export const listClients = async () => (await api.get<User[]>('/users/clients')).data;
export const createUser = (body: Partial<User> & { password: string }) =>
  api.post<User>('/users', body);
export const updateUser = (id: number, body: Record<string, unknown>) =>
  api.put<User>(`/users/${id}`, body);
export const deleteUser = (id: number) => api.delete(`/users/${id}`);

// Meta
export const fetchMeta = async () =>
  (await api.get<{ component_types: string[]; statuses: string[] }>('/templates/meta')).data;

// Customer directory (derived from existing jobs — powers intake autocomplete)
export const listCustomers = async (q?: string) =>
  (await api.get<Customer[]>('/customers', { params: q ? { q } : {} })).data;

// Jobs
export const listJobs = async (status?: string) =>
  (await api.get<JobListItem[]>('/jobs', { params: status ? { status } : {} })).data;
export const getJob = async (id: number) => (await api.get<JobDetail>(`/jobs/${id}`)).data;
export const createJob = async (body: Record<string, unknown>) =>
  (await api.post<JobDetail>('/jobs', body)).data;
export const updateJob = async (id: number, body: Record<string, unknown>) =>
  (await api.put<JobDetail>(`/jobs/${id}`, body)).data;
export const deleteJob = (id: number) => api.delete(`/jobs/${id}`);
export const assignClients = async (id: number, user_ids: number[]) =>
  (await api.put<JobDetail>(`/jobs/${id}/clients`, { user_ids })).data;

// ---- Job costing (staff/admin only) ----
export const listCostItems = async (jobId: number) =>
  (await api.get<JobCostItem[]>(`/jobs/${jobId}/costs`)).data;
export const addCostItem = async (
  jobId: number,
  body: { description: string; supplier?: string; quantity: number; unit_cost: number; note?: string },
) => (await api.post<JobCostItem>(`/jobs/${jobId}/costs`, body)).data;
export const updateCostItem = async (
  jobId: number,
  itemId: number,
  body: Record<string, unknown>,
) => (await api.put<JobCostItem>(`/jobs/${jobId}/costs/${itemId}`, body)).data;
export const deleteCostItem = (jobId: number, itemId: number) =>
  api.delete(`/jobs/${jobId}/costs/${itemId}`);

// Check-in QR
export const getCheckin = async (jobId: number) =>
  (await api.get<CheckinStatus>(`/jobs/${jobId}/checkin`)).data;

// Notes
export const addNote = async (jobId: number, note_type: string, body: string) =>
  (await api.post<Note>(`/jobs/${jobId}/notes`, { note_type, body })).data;

export const logWhatsapp = async (jobId: number) =>
  (await api.post<JobDetail>(`/jobs/${jobId}/whatsapp-log`, {})).data;

export const addJobEmailContact = async (
  jobId: number,
  name: string,
  email: string,
  username?: string,
) => (await api.post<JobDetail>(`/jobs/${jobId}/email-contacts`, { name, email, username })).data;

export const deleteJobEmailContact = async (jobId: number, contactId: number) =>
  (await api.delete<JobDetail>(`/jobs/${jobId}/email-contacts/${contactId}`)).data;

export const sendJobEmail = async (
  jobId: number,
  body: { kind: 'status' | 'completion'; contact_id: number; subject: string; body: string },
) => (await api.post<JobDetail>(`/jobs/${jobId}/send-email`, body)).data;

// Photos & documents
export const uploadPhotos = async (
  jobId: number,
  files: File[],
  category: string,
  caption?: string,
) => {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  fd.append('category', category);
  if (caption) fd.append('caption', caption);
  return (await api.post<Photo[]>(`/jobs/${jobId}/photos`, fd)).data;
};
export const deletePhoto = (jobId: number, photoId: number) =>
  api.delete(`/jobs/${jobId}/photos/${photoId}`);
export const uploadDocuments = async (jobId: number, files: File[]) => {
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  return api.post(`/jobs/${jobId}/documents`, fd);
};
export const deleteDocument = (jobId: number, docId: number) =>
  api.delete(`/jobs/${jobId}/documents/${docId}`);
export const fileUrl = (jobId: number, filename: string) => {
  // Real authenticated URL (token in query) so a document can be opened
  // directly in a new tab and handed to the OS viewer. Android cannot open a
  // blob: URL as a top-level navigation, so we avoid blobs for "view".
  const token = getToken();
  return `/api/jobs/${jobId}/files/${encodeURIComponent(filename)}?token=${encodeURIComponent(token || '')}`;
};
export const fetchFileBlob = async (jobId: number, filename: string) => {
  const { data } = await api.get(`/jobs/${jobId}/files/${filename}`, { responseType: 'blob' });
  return URL.createObjectURL(data);
};

// Branded job certificate / report (PDF). Streams a real application/pdf and
// triggers a browser download. Works for staff/admin and for clients on jobs
// they have access to.
export const downloadCertificate = async (jobId: number, jobNumber: string, passed: boolean) => {
  const res = await api.get(`/jobs/${jobId}/certificate`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  const safe = jobNumber.replace(/[/ ]/g, '_');
  a.download = `${safe}_${passed ? 'Certificate' : 'Report'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Complete "job pack" ZIP — cover certificate/report + every photo and
// document filed on the job. Same access rule as the certificate above.
export const downloadJobPack = async (jobId: number, jobNumber: string) => {
  const res = await api.get(`/jobs/${jobId}/pack`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  const safe = jobNumber.replace(/[/ ]/g, '_');
  a.download = `${safe}_JobPack.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Inspections
export const createInspection = async (jobId: number, component_type: string, title?: string) =>
  (await api.post<Inspection>(`/jobs/${jobId}/inspections`, { component_type, title })).data;
export const updateInspection = async (
  jobId: number,
  inspectionId: number,
  body: Record<string, unknown>,
) => (await api.put<Inspection>(`/jobs/${jobId}/inspections/${inspectionId}`, body)).data;
export const deleteInspection = (jobId: number, inspectionId: number) =>
  api.delete(`/jobs/${jobId}/inspections/${inspectionId}`);

// Check-in lists (operators / machines shown on the public QR check-in form)
export const getCheckinLists = async () => (await api.get<CheckinLists>('/checkin-lists')).data;
export const createCheckinItem = (kind: 'operator' | 'machine', label: string) =>
  api.post<CheckinListItem>('/checkin-lists', { kind, label });
export const updateCheckinItem = (id: number, body: { label?: string; order_index?: number }) =>
  api.put<CheckinListItem>(`/checkin-lists/${id}`, body);
export const deleteCheckinItem = (id: number) => api.delete(`/checkin-lists/${id}`);

// Templates
export const listTemplates = async () => (await api.get<Template[]>('/templates')).data;
export const createTemplate = (component_type: string, name: string, items: string[]) =>
  api.post<Template>('/templates', { component_type, name, items });
export const updateTemplate = (id: number, body: { name?: string; items?: string[] }) =>
  api.put<Template>(`/templates/${id}`, body);
export const deleteTemplate = (id: number) => api.delete(`/templates/${id}`);

// Settings
export const getSettings = async () => (await api.get<AppSettings>('/settings')).data;
export const updateSettings = async (body: Record<string, unknown>) =>
  (await api.put<AppSettings>('/settings', body)).data;
export const checkUpdates = async () => (await api.post<AppSettings>('/settings/check-updates')).data;
export const applyUpdate = async () => (await api.post('/settings/apply-update')).data;
export const getUpdateStatus = async () =>
  (await api.get<{ status: string; log: string; pct?: number | null }>('/settings/update-status')).data;
export const uploadLogo = async (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return (await api.post<AppSettings>('/settings/logo', fd)).data;
};
export const sendTestEmail = async (to?: string) =>
  (await api.post<{ success: boolean; detail: string }>('/settings/test-email', { to })).data;

// Backup & restore (admin)
export const startBackup = async () =>
  (await api.post<BackupJobStart>('/settings/backup/start')).data;

export const getBackupProgress = async (jobId: string) =>
  (await api.get<BackupProgress>(`/settings/backup/progress/${jobId}`)).data;

const saveBlob = (data: Blob, name: string) => {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Download the finished backup zip for a completed job.
// ``expectedSize`` — the zip size reported by the build job, used as the
// progress total when the proxy strips Content-Length from the response.
// ``onProgress(loaded, total)`` — fires as bytes arrive so the UI bar can
// track the actual transfer instead of freezing at 100% while it happens.
export const downloadBackupResult = async (
  jobId: string,
  fallbackName?: string,
  expectedSize?: number,
  onProgress?: (loaded: number, total?: number) => void,
) => {
  const res = await api.get(`/settings/backup/download/${jobId}`, {
    responseType: 'blob',
    timeout: 600000,
    onDownloadProgress: (e) => {
      if (!onProgress) return;
      const total =
        (typeof e.total === 'number' && e.total > 0 ? e.total : undefined) ??
        (expectedSize && expectedSize > 0 ? expectedSize : undefined);
      onProgress(e.loaded, total);
    },
  });
  const cd = res.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] || fallbackName || `workshopiq-backup-${Date.now()}.zip`;
  saveBlob(res.data as Blob, name);
};

export const downloadBackup = async () => {
  const res = await api.get('/settings/backup', { responseType: 'blob', timeout: 600000 });
  const cd = res.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] || `workshopiq-backup-${Date.now()}.zip`;
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// Android app (.apk) download (admin)
export const downloadAndroidApp = async () => {
  const res = await api.get('/settings/app/android', { responseType: 'blob', timeout: 120000 });
  const cd = res.headers['content-disposition'] || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const name = match?.[1] || 'WorkshopIQ.apk';
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const restoreBackup = async (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return (
    await api.post('/settings/restore', fd, { timeout: 600000 })
  ).data as {
    status: string;
    restored_from_version?: string;
    created_at?: string;
    counts: Record<string, number>;
  };
};

// Samba network-drive backup (admin)
export const getSamba = async () =>
  (await api.get<SambaStatus>('/settings/samba')).data;
export const updateSamba = async (body: SambaUpdate) =>
  (await api.put<SambaStatus>('/settings/samba', body)).data;
export const testSamba = async () =>
  (await api.post<SambaActionResult>('/settings/samba/test')).data;
export const backupNowSamba = async () =>
  (await api.post<SambaBackupStart>('/settings/samba/backup-now')).data;
export const getSambaBackupProgress = async () =>
  (await api.get<SambaBackupProgress>('/settings/samba/backup-progress')).data;

// Dashboard
export const getDashboard = async () => (await api.get<DashboardStats>('/dashboard')).data;

// Reports
export const getJobReport = async (params: {
  period: 'month' | 'year' | 'all';
  year?: number;
  month?: number;
  status?: string;
  customer?: string;
}) => (await api.get<JobReportResponse>('/reports/jobs', { params })).data;

// Customer reviews
export const requestReview = async (jobId: number) =>
  (await api.post<Review>(`/jobs/${jobId}/review`)).data;
// Skip the final inspection and send the job straight to the client for a
// review (any staff, no admin approval). Submitting the review auto-closes it.
export const skipInspectionReview = async (jobId: number) =>
  (await api.post<Review>(`/jobs/${jobId}/review/skip-inspection`)).data;
export const getReview = async (jobId: number) =>
  (await api.get<Review | null>(`/jobs/${jobId}/review`)).data;
export const submitReview = async (
  jobId: number,
  body: { rating: number; feedback?: string; improvement?: string },
) => (await api.put<Review>(`/jobs/${jobId}/review`, body)).data;
export const getPendingReviews = async () =>
  (await api.get<PendingReview[]>('/reviews/pending')).data;

// Final inspection
export const getFinalInspection = async (jobId: number) =>
  (await api.get<FinalInspection | null>(`/jobs/${jobId}/final-inspection`)).data;
export const releaseFinalInspection = async (jobId: number) =>
  (await api.post<FinalInspection>(`/jobs/${jobId}/final-inspection`)).data;
export const cancelFinalInspection = async (jobId: number) =>
  (await api.post<FinalInspection | null>(`/jobs/${jobId}/final-inspection/cancel`)).data;
export const submitFinalInspection = async (
  jobId: number,
  body: { inspector_name: string; internal_reference?: string },
) => (await api.put<FinalInspection>(`/jobs/${jobId}/final-inspection`, body)).data;
export const failFinalInspection = async (
  jobId: number,
  body: { inspector_name: string; reason: string; ncr_number?: string },
) => (await api.post<FinalInspection>(`/jobs/${jobId}/final-inspection/fail`, body)).data;
export const getPendingInspections = async () =>
  (await api.get<PendingInspection[]>('/final-inspection/pending')).data;

// Request for closure (client won't inspect → admin-approved internal pass)
export const requestClosure = async (jobId: number, body: { reason?: string }) =>
  (await api.post<FinalInspection>(`/jobs/${jobId}/final-inspection/closure-request`, body))
    .data;
export const approveClosure = async (jobId: number) =>
  (await api.post<FinalInspection>(`/jobs/${jobId}/final-inspection/closure-approve`)).data;
export const rejectClosure = async (jobId: number, body: { reason?: string }) =>
  (await api.post<FinalInspection>(`/jobs/${jobId}/final-inspection/closure-reject`, body))
    .data;
export const getPendingClosures = async () =>
  (await api.get<PendingClosure[]>('/final-inspection/closure-pending')).data;
export const getReviewNotifications = async () =>
  (await api.get<ReviewNotification[]>('/reviews/notifications')).data;
export const markReviewNotificationsSeen = async (review_ids: number[]) =>
  api.post('/reviews/notifications/seen', { review_ids });

// NCRs (Non-Conformance Reports)
export const fetchNCRMeta = async () => (await api.get<NCRMeta>('/ncrs/meta')).data;
export const listNCRs = async (params?: { status?: string; job_id?: number }) =>
  (await api.get<NCRListItem[]>('/ncrs', { params: params || {} })).data;
export const getNCR = async (id: number) => (await api.get<NCR>(`/ncrs/${id}`)).data;
export const createNCR = async (body: Record<string, unknown>) =>
  (await api.post<NCR>('/ncrs', body)).data;
export const updateNCR = async (id: number, body: Record<string, unknown>) =>
  (await api.put<NCR>(`/ncrs/${id}`, body)).data;
export const deleteNCR = (id: number) => api.delete(`/ncrs/${id}`);

export default api;

// Inspection reports — QR-driven, file straight to job documents.
export const listInspectionReports = async () =>
  (await api.get<InspectionReportItem[]>('/inspection-reports')).data;

export const generateInspectionReport = async (
  job_id: number,
  opts?: { drawing_number?: string; qcp_no?: string; quantity?: string },
) =>
  (
    await api.post<InspectionReportDetail>('/inspection-reports/generate', {
      job_id,
      ...opts,
    })
  ).data;

export const getInspectionReport = async (id: number) =>
  (await api.get<InspectionReportDetail>(`/inspection-reports/${id}`)).data;

export const deleteInspectionReport = (id: number) =>
  api.delete(`/inspection-reports/${id}`);

// Client portal: reports on the client's assigned jobs, sign-off, and the
// login nag for reports still awaiting their signature.
export const listMyInspectionReports = async () =>
  (await api.get<InspectionReportItem[]>('/inspection-reports/mine')).data;

export const signInspectionReport = async (
  id: number,
  body: { signed_name: string; signature_png: string | null },
) => (await api.post<InspectionReportItem>(`/inspection-reports/${id}/client-sign`, body)).data;

export const getPendingClientSignatures = async () =>
  (await api.get<PendingClientSignature[]>('/inspection-reports/pending-signatures')).data;

// Public, no-auth form URL the QR points at (also used for "fill on screen").
export const inspectionReportFormUrl = (token: string) =>
  `${window.location.origin}/api/inspection-report/${token}`;

// Training sign-off records — a compliance trail of who's been trained on
// which WorkshopIQ topics, with a drawn signature. Not a permission gate.
export const listTrainableWorkers = async () =>
  (await api.get<TrainableWorker[]>('/training-records/workers')).data;

export const listTrainingRecords = async () =>
  (await api.get<TrainingRecordItem[]>('/training-records')).data;

export const createTrainingRecord = async (payload: {
  worker_name: string;
  user_id?: number | null;
  topics: string[];
  signature_png: string;
  notes?: string;
}) => (await api.post<TrainingRecordItem>('/training-records', payload)).data;

export const deleteTrainingRecord = (id: number) =>
  api.delete(`/training-records/${id}`);

// Blank printable sheet (PDF) — opened in a new tab for printing.
export const openBlankInspectionReport = async () => {
  // Android (Chrome and the APK WebView) can't open a blob: URL in a new
  // tab — the tab comes up blank / "no app for this link". Hand Android the
  // real authenticated URL (?token=, same pattern as job documents) so the
  // OS downloads and opens it in the device's PDF viewer.
  if (/android/i.test(navigator.userAgent)) {
    const token = getToken();
    const a = document.createElement('a');
    a.href = `/api/inspection-reports/blank.pdf?token=${encodeURIComponent(token || '')}`;
    a.download = 'Inspection Report (blank).pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }
  const res = await api.get('/inspection-reports/blank.pdf', { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
};
