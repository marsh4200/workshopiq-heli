export type Role = 'administrator' | 'staff' | 'client';

export interface User {
  id: number;
  username: string;
  email?: string | null;
  full_name?: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
  terms_accepted_at?: string | null;
  theme_preference?: 'light' | 'dark' | 'system';
  last_login_at?: string | null;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  must_change_password: boolean;
  role: Role;
  username: string;
}

export interface Note {
  id: number;
  note_type: string;
  body: string;
  author_name?: string | null;
  created_at: string;
}

export interface Photo {
  id: number;
  filename: string;
  original_name?: string | null;
  category: string;
  caption?: string | null;
  created_at: string;
}

export interface DocumentFile {
  id: number;
  filename: string;
  original_name?: string | null;
  content_type?: string | null;
  created_at: string;
}

export interface TimelineEvent {
  id: number;
  event_type: string;
  description: string;
  actor_name?: string | null;
  created_at: string;
}

export interface RecentActivity extends TimelineEvent {
  job_id?: number | null;
  job_number?: string | null;
  customer_name?: string | null;
}

export interface InspectionItem {
  id: number;
  label: string;
  result?: string | null;
  notes?: string | null;
  order_index: number;
}

export interface Inspection {
  id: number;
  component_type: string;
  title?: string | null;
  inspector_name?: string | null;
  completed: boolean;
  created_at: string;
  items: InspectionItem[];
}

export interface JobListItem {
  id: number;
  job_number: string;
  customer_name: string;
  component_type?: string | null;
  quantity?: number;
  status: string;
  date_received: string;
  due_date?: string | null;
  created_at: string;
  po_number?: string | null;
  eq_number?: string | null;
}

export interface JobEmailContact {
  id: number;
  name: string;
  email: string;
  username?: string | null;
}

export interface JobCostItem {
  id: number;
  job_id: number;
  description: string;
  supplier?: string | null;
  quantity: number;
  unit_cost: number;
  line_total: number;
  note?: string | null;
  created_by_name?: string | null;
  created_at: string;
}

export interface JobDetail extends JobListItem {
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  po_number?: string | null;
  eq_number?: string | null;
  description?: string | null;
  photos: Photo[];
  documents: DocumentFile[];
  notes: Note[];
  timeline: TimelineEvent[];
  inspections: Inspection[];
  client_user_ids: number[];
  client_names: string[];
  final_inspection?: FinalInspection | null;
  checked_in: boolean;
  notify_on_status_change: boolean;
  notify_on_job_completion: boolean;
  last_status_email_at?: string | null;
  last_completion_email_at?: string | null;
  email_contacts: JobEmailContact[];
}

export interface CheckinStatus {
  token: string;
  url: string;
  qr_png: string;
  checked_in: boolean;
  inspection_complete: boolean;
  operator_name?: string | null;
  machine?: string | null;
  checked_in_at?: string | null;
}

export interface CheckinListItem {
  id: number;
  kind: 'operator' | 'machine';
  label: string;
  order_index: number;
}

export interface CheckinLists {
  operators: CheckinListItem[];
  machines: CheckinListItem[];
}

export interface TemplateItem {
  id: number;
  label: string;
  order_index: number;
}

export interface Template {
  id: number;
  component_type: string;
  name: string;
  items: TemplateItem[];
}

export interface AppSettings {
  company_name: string;
  company_logo?: string | null;
  dashboard_branding?: string | null;
  job_number_prefix: string;
  email_host?: string | null;
  email_port?: string | null;
  email_user?: string | null;
  email_from?: string | null;
  email_password_set?: boolean;
  whatsapp_country_code?: string | null;
  github_repo_url?: string | null;
  current_version: string;
  available_version?: string | null;
  backup_before_update?: boolean;
  backup_keep?: number;
  maintenance_mode?: boolean;
  server_shutdown?: boolean;
}

export interface SambaStatus {
  server?: string | null;
  share?: string | null;
  username?: string | null;
  subpath?: string | null;
  password_set: boolean;
  auto_backup: boolean;
  configured: boolean;
  last_backup_at?: string | null;
  last_backup_status?: string | null;
  interval_hours: number;
  keep_copies: number;
}

export interface SambaUpdate {
  server?: string;
  share?: string;
  username?: string;
  password?: string;
  subpath?: string;
  auto_backup?: boolean;
}

export interface SambaActionResult {
  ok: boolean;
  detail: string;
}

export interface SambaBackupStart {
  ok: boolean;
  job_id: string;
  detail: string;
}

export interface SambaBackupProgress {
  state: 'idle' | 'running' | 'done' | 'error';
  percent: number;
  phase: string;
  job_id?: string | null;
  detail?: string | null;
  error?: string | null;
}

export interface BackupJobStart {
  ok: boolean;
  job_id: string;
}

export interface BackupProgress {
  state: 'running' | 'done' | 'error';
  percent: number;
  phase: string;
  filename?: string | null;
  size?: number | null;
  error?: string | null;
}

export interface DashboardStats {
  received: number;
  machining: number;
  completed: number;
  closed: number;
  total: number;
  overdue: number;
  due_soon: number;
  status_breakdown: Record<string, number>;
  recent_activity: RecentActivity[];
}

export interface Customer {
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface JobReportItem {
  id: number;
  job_number: string;
  customer_name: string;
  po_number?: string | null;
  component_type?: string | null;
  status: string;
  date_received: string;
}

export interface JobReportResponse {
  period: 'month' | 'year' | 'all';
  year?: number | null;
  month?: number | null;
  period_label: string;
  generated_at: string;
  company_name: string;
  total: number;
  status_breakdown: Record<string, number>;
  status_filter?: string | null;
  customer_filter?: string | null;
  jobs: JobReportItem[];
}

export interface Review {
  id: number;
  job_id: number;
  requested_at: string;
  completed: boolean;
  rating?: number | null;
  feedback?: string | null;
  improvement?: string | null;
  reviewer_name?: string | null;
  completed_at?: string | null;
}

export interface FinalInspectionAttempt {
  id: number;
  attempt_number: number;
  result: 'passed' | 'failed';
  inspector_name?: string | null;
  reason?: string | null;
  ncr_number?: string | null;
  internal_reference?: string | null;
  created_at: string;
}

export interface FinalInspection {
  id: number;
  job_id: number;
  requested_at: string;
  completed: boolean;
  inspector_name?: string | null;
  internal_reference?: string | null;
  result?: 'passed' | 'failed' | null;
  failure_reason?: string | null;
  ncr_number?: string | null;
  attempts: number;
  failed_at?: string | null;
  completed_at?: string | null;
  closure_status?: 'pending' | 'approved' | 'rejected' | null;
  closure_reason?: string | null;
  closure_requested_at?: string | null;
  closure_decided_at?: string | null;
  closure_rejection_reason?: string | null;
  attempts_log: FinalInspectionAttempt[];
}

export interface PendingReview {
  job_id: number;
  job_number: string;
  customer_name: string;
}

export interface PendingInspection {
  job_id: number;
  job_number: string;
  customer_name: string;
  attempts: number;
  is_reinspection: boolean;
}

export interface PendingClosure {
  job_id: number;
  job_number: string;
  customer_name: string;
  reason?: string | null;
  requested_by?: string | null;
  requested_at?: string | null;
}

export interface NCRListItem {
  id: number;
  ncr_number: string;
  title: string;
  category: string;
  severity: string;
  status: string;
  job_id?: number | null;
  job_number?: string | null;
  created_at: string;
}

export interface NCR extends NCRListItem {
  description: string;
  source: string;
  disposition: string;
  root_cause?: string | null;
  corrective_action?: string | null;
  assigned_to?: string | null;
  raised_by_name?: string | null;
  closed_by_name?: string | null;
  updated_at: string;
  closed_at?: string | null;
}

export interface NCRMeta {
  categories: string[];
  severities: string[];
  sources: string[];
  dispositions: string[];
  statuses: string[];
}

export interface ReviewNotification {
  review_id: number;
  job_id: number;
  job_number: string;
  customer_name: string;
  rating?: number | null;
  reviewer_name?: string | null;
  completed_at?: string | null;
}

export interface InspectionReportItem {
  id: number;
  job_id: number;
  job_number?: string | null;
  customer_name?: string | null;
  token: string;
  certificate_number: string;
  submitted: boolean;
  inspector_name?: string | null;
  qcp_pass?: string | null;
  qc_reject?: string | null;
  rework?: string | null;
  document_id?: number | null;
  drawing_number?: string | null;
  qcp_no?: string | null;
  quantity?: string | null;
  client_signed?: boolean;
  client_signed_name?: string | null;
  client_signed_at?: string | null;
  submitted_at?: string | null;
  created_at?: string | null;
}

export interface InspectionReportDetail extends InspectionReportItem {
  url: string;
  qr_png: string;
}

export interface PendingClientSignature {
  report_id: number;
  certificate_number: string;
  job_id: number;
  job_number?: string | null;
  customer_name?: string | null;
}

export interface TrainableWorker {
  id: number | null;
  full_name: string;
}

export interface TrainingRecordItem {
  id: number;
  user_id: number | null;
  worker_name: string;
  topics: string[];
  signature_png: string;
  trained_by_name: string;
  notes?: string | null;
  created_at: string;
}

export interface LicenseStatus {
  activated: boolean;
  reason?: string | null;
  server_id: string;
  client?: string;
  product?: string;
  license_id?: string;
  issued_at?: string;
  expires_at?: string | null;
  online_reason?: string | null;
  last_contact?: string | null;
  last_result?: string | null;
}
