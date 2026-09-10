"""Pydantic schemas for API I/O."""
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ---------- Auth ----------
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    must_change_password: bool = False
    role: str
    username: str


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


# ---------- Users ----------
class UserBase(BaseModel):
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: str = "staff"
    is_active: bool = True


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserOut(UserBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    must_change_password: bool
    theme_preference: str = "dark"
    last_login_at: Optional[datetime] = None
    terms_accepted_at: Optional[datetime] = None
    created_at: datetime


class PreferencesUpdate(BaseModel):
    """Self-service preference update — any authenticated user may set their own."""
    theme_preference: str


# ---------- Settings ----------
class SettingsOut(BaseModel):
    company_name: str
    company_logo: Optional[str] = None
    dashboard_branding: Optional[str] = None
    job_number_prefix: str
    email_host: Optional[str] = None
    email_port: Optional[str] = None
    email_user: Optional[str] = None
    email_from: Optional[str] = None
    # Never echoes the actual password back — just whether one is stored.
    email_password_set: bool = False
    whatsapp_country_code: Optional[str] = None
    github_repo_url: Optional[str] = None
    current_version: str
    available_version: Optional[str] = None
    backup_before_update: bool = True
    backup_keep: int = 2
    maintenance_mode: bool = False
    server_shutdown: bool = False


class SettingsUpdate(BaseModel):
    company_name: Optional[str] = None
    dashboard_branding: Optional[str] = None
    job_number_prefix: Optional[str] = None
    email_host: Optional[str] = None
    email_port: Optional[str] = None
    email_user: Optional[str] = None
    email_password: Optional[str] = None
    email_from: Optional[str] = None
    whatsapp_country_code: Optional[str] = None
    github_repo_url: Optional[str] = None
    backup_before_update: Optional[bool] = None
    backup_keep: Optional[int] = None
    maintenance_mode: Optional[bool] = None
    server_shutdown: Optional[bool] = None


class TestEmailRequest(BaseModel):
    """Optional override recipient; defaults to the requesting admin's own email."""
    to: Optional[str] = None


class TestEmailResult(BaseModel):
    success: bool
    detail: str


# ---------- Samba network-drive backup ----------
class SambaUpdate(BaseModel):
    server: Optional[str] = None
    share: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    subpath: Optional[str] = None
    auto_backup: Optional[bool] = None


class SambaStatusOut(BaseModel):
    server: Optional[str] = None
    share: Optional[str] = None
    username: Optional[str] = None
    subpath: Optional[str] = None
    password_set: bool = False
    auto_backup: bool = False
    configured: bool = False
    last_backup_at: Optional[str] = None
    last_backup_status: Optional[str] = None
    interval_hours: int = 6
    keep_copies: int = 2


class SambaConfigOut(BaseModel):
    ok: bool
    detail: str


class SambaBackupStartOut(BaseModel):
    ok: bool
    job_id: str
    detail: str


class SambaBackupProgressOut(BaseModel):
    state: str  # "idle" | "running" | "done" | "error"
    percent: int
    phase: str
    job_id: Optional[str] = None
    detail: Optional[str] = None
    error: Optional[str] = None


# ---------- Notes ----------
class NoteCreate(BaseModel):
    note_type: str = "internal"
    body: str


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    note_type: str
    body: str
    author_name: Optional[str] = None
    created_at: datetime


# ---------- Photos / Documents ----------
class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    original_name: Optional[str] = None
    category: str
    caption: Optional[str] = None
    created_at: datetime


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    original_name: Optional[str] = None
    content_type: Optional[str] = None
    created_at: datetime


# ---------- Timeline ----------
class TimelineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_type: str
    description: str
    actor_name: Optional[str] = None
    created_at: datetime


# ---------- Inspection templates ----------
class TemplateItemIn(BaseModel):
    label: str


class TemplateItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    order_index: int


class TemplateBase(BaseModel):
    component_type: str
    name: str


class TemplateCreate(TemplateBase):
    items: list[str] = []


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    items: Optional[list[str]] = None


class TemplateOut(TemplateBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    items: list[TemplateItemOut] = []


# ---------- Inspections ----------
class InspectionItemUpdate(BaseModel):
    id: int
    result: Optional[str] = None
    notes: Optional[str] = None


class InspectionItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    label: str
    result: Optional[str] = None
    notes: Optional[str] = None
    order_index: int


class InspectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    component_type: str
    title: Optional[str] = None
    inspector_name: Optional[str] = None
    completed: bool
    created_at: datetime
    items: list[InspectionItemOut] = []


class InspectionCreate(BaseModel):
    component_type: str
    title: Optional[str] = None


class InspectionUpdate(BaseModel):
    title: Optional[str] = None
    completed: Optional[bool] = None
    items: Optional[list[InspectionItemUpdate]] = None


# ---------- Jobs ----------
class JobBase(BaseModel):
    customer_name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    po_number: Optional[str] = None
    eq_number: Optional[str] = None
    due_date: Optional[date] = None
    description: Optional[str] = None
    component_type: Optional[str] = None
    quantity: int = 1


class JobCreate(JobBase):
    date_received: Optional[datetime] = None
    client_user_ids: list[int] = []


class JobUpdate(BaseModel):
    customer_name: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    po_number: Optional[str] = None
    eq_number: Optional[str] = None
    due_date: Optional[date] = None
    description: Optional[str] = None
    component_type: Optional[str] = None
    quantity: Optional[int] = None
    status: Optional[str] = None
    # Per-job manual email-notification toggles (see JobEmailSend below).
    notify_on_status_change: Optional[bool] = None
    notify_on_job_completion: Optional[bool] = None


class JobEmailContactIn(BaseModel):
    """A named email address to save against a job."""
    name: str
    email: str
    # Optional "their login/reference name" — separate from the display
    # name, for a {username} placeholder in drafted emails. Not tied to any
    # WorkshopIQ account.
    username: Optional[str] = None


class JobEmailContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    username: Optional[str] = None


class JobEmailSend(BaseModel):
    """Manual send — staff composed (or accepted) this subject/body themselves,
    and picked which of the job's saved email contacts it goes to."""
    kind: str  # "status" | "completion"
    contact_id: int
    subject: str
    body: str


class FinalInspectionAttemptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    attempt_number: int
    result: str  # "passed" | "failed"
    inspector_name: Optional[str] = None
    reason: Optional[str] = None
    ncr_number: Optional[str] = None
    internal_reference: Optional[str] = None
    created_at: datetime


class FinalInspectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_id: int
    requested_at: datetime
    completed: bool
    inspector_name: Optional[str] = None
    internal_reference: Optional[str] = None
    result: Optional[str] = None  # "passed" | "failed" | None (pending)
    failure_reason: Optional[str] = None
    ncr_number: Optional[str] = None
    attempts: int = 0
    failed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    # Request-for-closure (admin-approved internal pass) path.
    closure_status: Optional[str] = None  # None|"pending"|"approved"|"rejected"
    closure_reason: Optional[str] = None
    closure_requested_at: Optional[datetime] = None
    closure_decided_at: Optional[datetime] = None
    closure_rejection_reason: Optional[str] = None
    attempts_log: list[FinalInspectionAttemptOut] = []


class FinalInspectionSubmit(BaseModel):
    inspector_name: str
    internal_reference: Optional[str] = None


class FinalInspectionFail(BaseModel):
    inspector_name: str
    reason: str
    ncr_number: Optional[str] = None


class ClosureRequest(BaseModel):
    """Staff request to close a job out without a client final inspection."""

    reason: Optional[str] = None


class ClosureReject(BaseModel):
    """Admin declines a closure request, optionally with a reason."""

    reason: Optional[str] = None


# ---------- NCR (Non-Conformance Report) ----------
class NCRBase(BaseModel):
    title: str
    description: str
    category: str = "Other"
    severity: str = "Minor"
    source: str = "In-Process"
    disposition: str = "Pending"
    root_cause: Optional[str] = None
    corrective_action: Optional[str] = None
    assigned_to: Optional[str] = None
    job_id: Optional[int] = None


class NCRCreate(NCRBase):
    pass


class NCRUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    source: Optional[str] = None
    disposition: Optional[str] = None
    root_cause: Optional[str] = None
    corrective_action: Optional[str] = None
    assigned_to: Optional[str] = None
    status: Optional[str] = None
    job_id: Optional[int] = None


class NCRListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ncr_number: str
    title: str
    category: str
    severity: str
    status: str
    job_id: Optional[int] = None
    job_number: Optional[str] = None
    created_at: datetime


class NCROut(NCRListOut):
    description: str
    source: str
    disposition: str
    root_cause: Optional[str] = None
    corrective_action: Optional[str] = None
    assigned_to: Optional[str] = None
    raised_by_name: Optional[str] = None
    closed_by_name: Optional[str] = None
    updated_at: datetime
    closed_at: Optional[datetime] = None


class JobListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_number: str
    customer_name: str
    component_type: Optional[str] = None
    quantity: int = 1
    status: str
    date_received: datetime
    due_date: Optional[date] = None
    created_at: datetime
    po_number: Optional[str] = None
    eq_number: Optional[str] = None


class JobDetailOut(JobListOut):
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    po_number: Optional[str] = None
    eq_number: Optional[str] = None
    description: Optional[str] = None
    photos: list[PhotoOut] = []
    documents: list[DocumentOut] = []
    notes: list[NoteOut] = []
    timeline: list[TimelineOut] = []
    inspections: list[InspectionOut] = []
    client_user_ids: list[int] = []
    client_names: list[str] = []
    final_inspection: Optional[FinalInspectionOut] = None
    checked_in: bool = False
    notify_on_status_change: bool = False
    notify_on_job_completion: bool = False
    last_status_email_at: Optional[datetime] = None
    last_completion_email_at: Optional[datetime] = None
    email_contacts: list[JobEmailContactOut] = []


class AssignClientsRequest(BaseModel):
    user_ids: list[int]


# ---------- Customer directory (derived from jobs) ----------
class CustomerOut(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


# ---------- Job costing (staff/admin only) ----------
class JobCostItemBase(BaseModel):
    description: str
    supplier: Optional[str] = None
    quantity: float = 1
    unit_cost: float = 0
    note: Optional[str] = None


class JobCostItemCreate(JobCostItemBase):
    pass


class JobCostItemUpdate(BaseModel):
    description: Optional[str] = None
    supplier: Optional[str] = None
    quantity: Optional[float] = None
    unit_cost: Optional[float] = None
    note: Optional[str] = None


class JobCostItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_id: int
    description: str
    supplier: Optional[str] = None
    quantity: float
    unit_cost: float
    line_total: float
    note: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: datetime


# ---------- Dashboard ----------
class RecentActivityOut(BaseModel):
    """A timeline event enriched with its job reference for the dashboard feed."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    event_type: str
    description: str
    actor_name: Optional[str] = None
    created_at: datetime
    job_id: Optional[int] = None
    job_number: Optional[str] = None
    customer_name: Optional[str] = None


class DashboardStats(BaseModel):
    received: int
    machining: int
    completed: int
    closed: int
    total: int
    overdue: int = 0
    due_soon: int = 0
    status_breakdown: dict[str, int]
    recent_activity: list[RecentActivityOut]


# ---------- Reports ----------
class JobReportItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_number: str
    customer_name: str
    po_number: Optional[str] = None
    component_type: Optional[str] = None
    status: str
    date_received: datetime


class JobReportResponse(BaseModel):
    period: str  # "month" | "year" | "all"
    year: Optional[int] = None
    month: Optional[int] = None
    period_label: str  # e.g. "June 2026" or "2026"
    generated_at: datetime
    company_name: str
    total: int
    status_breakdown: dict[str, int]
    status_filter: Optional[str] = None
    customer_filter: Optional[str] = None
    jobs: list[JobReportItem] = []


# ---------- Customer reviews ----------
class ReviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_id: int
    requested_at: datetime
    completed: bool
    rating: Optional[int] = None
    feedback: Optional[str] = None
    improvement: Optional[str] = None
    reviewer_name: Optional[str] = None
    completed_at: Optional[datetime] = None


class ReviewSubmit(BaseModel):
    rating: int
    feedback: Optional[str] = None
    improvement: Optional[str] = None


class PendingReviewItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    job_id: int
    job_number: str
    customer_name: str


class PendingInspectionItem(BaseModel):
    """A final inspection released to the client and awaiting their sign-off.

    Drives the client login banner. ``is_reinspection`` is True when this job
    has already been failed at least once, so the banner can say "re-inspection"
    rather than a first-time "ready for inspection".
    """

    model_config = ConfigDict(from_attributes=True)
    job_id: int
    job_number: str
    customer_name: str
    attempts: int = 0
    is_reinspection: bool = False


class PendingClosureItem(BaseModel):
    """A job whose closure request is awaiting an admin decision.

    Drives the admin login banner so closure requests don't get missed.
    """

    model_config = ConfigDict(from_attributes=True)
    job_id: int
    job_number: str
    customer_name: str
    reason: Optional[str] = None
    requested_by: Optional[str] = None
    requested_at: Optional[datetime] = None


class ReviewNotification(BaseModel):
    review_id: int
    job_id: int
    job_number: str
    customer_name: str
    rating: Optional[int] = None
    reviewer_name: Optional[str] = None
    completed_at: Optional[datetime] = None


class MarkSeenRequest(BaseModel):
    review_ids: list[int] = []
