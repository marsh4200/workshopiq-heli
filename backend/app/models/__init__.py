"""SQLAlchemy ORM models for WorkshopIQ."""
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, Enum):
    administrator = "administrator"
    staff = "staff"
    client = "client"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=UserRole.staff.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-user UI appearance preference: "light", "dark" or "system".
    # Stored server-side so each person's choice follows them across every
    # device they sign in on (phone, tablet, desktop).
    theme_preference: Mapped[str] = mapped_column(String(10), default="dark")
    # Timestamp of the user's most recent successful login. Null until they
    # have signed in at least once. Stamped on every successful /auth/login.
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When the user accepted the first-login terms of use (clients see the
    # welcome & terms notice before setting their password). Null = not yet.
    terms_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job_access: Mapped[list["ClientJobAccess"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Setting(Base):
    """Simple key/value store for application settings."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_number: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    sequence: Mapped[int] = mapped_column(Integer, index=True)

    customer_name: Mapped[str] = mapped_column(String(255))
    contact_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    po_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    eq_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    date_received: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    # Optional target/promised completion date (date only — no time/TZ games).
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    component_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # How many identical items came in under this job (default 1).
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(40), default="Received", index=True)

    # Per-job email-notification toggles (staff/admin, off by default). These
    # only decide whether the "Send Email" buttons appear on the job — sending
    # is always a manual click, never automatic. Emails go to this job's own
    # `email` field above, from the SMTP account configured in Settings.
    notify_on_status_change: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_on_job_completion: Mapped[bool] = mapped_column(Boolean, default=False)
    last_status_email_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_completion_email_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    photos: Mapped[list["Photo"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    notes: Mapped[list["Note"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    timeline: Mapped[list["TimelineEvent"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    inspections: Mapped[list["Inspection"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    client_access: Mapped[list["ClientJobAccess"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    cost_items: Mapped[list["JobCostItem"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    checkins: Mapped[list["JobCheckin"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    inspection_reports: Mapped[list["InspectionReport"]] = relationship(
        back_populates="job", cascade="all, delete-orphan"
    )
    review: Mapped["JobReview | None"] = relationship(
        back_populates="job", cascade="all, delete-orphan", uselist=False
    )
    final_inspection: Mapped["FinalInspection | None"] = relationship(
        back_populates="job", cascade="all, delete-orphan", uselist=False
    )
    ncrs: Mapped[list["NCR"]] = relationship(
        back_populates="job", passive_deletes=True
    )
    email_contacts: Mapped[list["JobEmailContact"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="JobEmailContact.created_at",
    )


class JobEmailContact(Base):
    """A named email address saved against a job.

    A job can have several of these — the buyer, a site foreman, the person
    who actually reads email — each with its own display name. The manual
    Send Status/Completion Email flow (see ``app/api/jobs.py``) requires
    picking one of these before it will send, and greets that person by the
    name saved here rather than guessing from ``Job.contact_person``.

    ``username`` is a free-text, optional "their login/reference name"
    field — not tied to WorkshopIQ's own auth (see ``User``/``ClientJobAccess``
    for actual portal accounts). It exists purely so a ``{username}``
    placeholder can be used in a drafted email alongside ``{name}``, the same
    way, when a recipient needs to be told a login name that's different from
    their display name.
    """

    __tablename__ = "job_email_contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["Job"] = relationship(back_populates="email_contacts")


class ClientJobAccess(Base):
    __tablename__ = "client_job_access"
    __table_args__ = (UniqueConstraint("user_id", "job_id", name="uq_client_job"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))

    user: Mapped["User"] = relationship(back_populates="job_access")
    job: Mapped["Job"] = relationship(back_populates="client_access")


class JobCostItem(Base):
    """A single internal supplier-cost line on a job.

    Staff/admin only — these rows are never serialized into the job-detail
    payload and are only reachable via the require_staff costing endpoints, so
    clients can never see them. They're also intentionally NOT written to the
    job timeline (which clients can view).
    """

    __tablename__ = "job_cost_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    description: Mapped[str] = mapped_column(String(255))
    supplier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=Decimal("1"))
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    job: Mapped["Job"] = relationship(back_populates="cost_items")

    @property
    def line_total(self) -> float:
        return float(self.quantity or 0) * float(self.unit_cost or 0)


class JobCheckin(Base):
    """One-time QR check-in token for a job.

    A token is created per job. Scanning the QR opens a public form; only on
    submit is the check-in recorded (operator + machine) and the token locked.
    """

    __tablename__ = "job_checkins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    checked_in: Mapped[bool] = mapped_column(Boolean, default=False)
    operator_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    machine: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scanner_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    checked_in_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["Job"] = relationship(back_populates="checkins")


class CheckinListItem(Base):
    """An entry in one of the two admin-editable QR check-in pick-lists.

    ``kind`` is ``"operator"`` or ``"machine"``. This is what the public
    check-in form's two dropdowns are built from — fully editable per
    deployment under Administration → Check-in Lists, instead of a fixed
    list baked into the code.
    """

    __tablename__ = "checkin_list_items"
    __table_args__ = (UniqueConstraint("kind", "label", name="uq_checkin_list_kind_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    label: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InspectionReport(Base):
    """A QR-driven inspection report attached to a job.

    Mirrors the ``JobCheckin`` one-time-token pattern: an admin generates a
    report token for a job, the QR points at a PUBLIC web form, and ONLY on
    submit is the report recorded, rendered to a PDF, filed into the job's
    Documents, and the token locked (one-time). To do another report you
    generate a fresh token.

    ``payload`` holds the full submitted report as JSON (header fields +
    measurement line items + sign-off) so the PDF can be (re)rendered and the
    structured data kept for reference.
    """

    __tablename__ = "inspection_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    certificate_number: Mapped[str] = mapped_column(String(60), index=True)
    sequence: Mapped[int] = mapped_column(Integer, default=0)

    # Header fields office staff set when the QR is generated — locked
    # (read-only) on the public phone form so the person on the floor can see
    # them but can't accidentally change them. Left blank means "not set at
    # generation time", in which case the form field is simply blank and
    # still locked.
    drawing_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    qcp_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    quantity: Mapped[str | None] = mapped_column(String(60), nullable=True)

    submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    inspector_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_signed_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    qcp_pass: Mapped[str | None] = mapped_column(String(4), nullable=True)   # Y / N
    qc_reject: Mapped[str | None] = mapped_column(String(4), nullable=True)  # Y / N
    rework: Mapped[str | None] = mapped_column(String(4), nullable=True)     # Y / N

    # Client-portal sign-off. Separate from ``customer_signed_name`` above
    # (which is the on-site customer name typed on the public QR form). These
    # are set when the assigned CLIENT signs the already-filed report from their
    # own login: on sign the report PDF is re-rendered with the drawn signature
    # embedded and the filed job document is replaced in place (option A).
    client_signed: Mapped[bool] = mapped_column(Boolean, default=False)
    client_signed_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_signature_png: Mapped[str | None] = mapped_column(Text, nullable=True)  # data URL
    client_signed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    client_signed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    payload: Mapped[str | None] = mapped_column(Text, nullable=True)         # JSON
    scanner_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    document_id: Mapped[int | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["Job"] = relationship(back_populates="inspection_reports")


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(255))
    original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str] = mapped_column(String(20), default="general")  # before/after/general
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    inspection_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("inspection_items.id", ondelete="SET NULL"), nullable=True
    )
    uploaded_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["Job"] = relationship(back_populates="photos")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String(255))
    original_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["Job"] = relationship(back_populates="documents")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    note_type: Mapped[str] = mapped_column(String(30), default="internal")
    # internal / customer / query / progress / action
    body: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    author_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["Job"] = relationship(back_populates="notes")


class TimelineEvent(Base):
    __tablename__ = "timeline_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    event_type: Mapped[str] = mapped_column(String(40))  # created / status_change / note / photo / inspection
    description: Mapped[str] = mapped_column(Text)
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    job: Mapped["Job"] = relationship(back_populates="timeline")


class InspectionTemplate(Base):
    __tablename__ = "inspection_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    component_type: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    items: Mapped[list["TemplateItem"]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="TemplateItem.order_index",
    )


class TemplateItem(Base):
    __tablename__ = "template_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(
        ForeignKey("inspection_templates.id", ondelete="CASCADE")
    )
    label: Mapped[str] = mapped_column(String(255))
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    template: Mapped["InspectionTemplate"] = relationship(back_populates="items")


class Inspection(Base):
    __tablename__ = "inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"))
    component_type: Mapped[str] = mapped_column(String(80))
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    inspector_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    inspector_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    job: Mapped["Job"] = relationship(back_populates="inspections")
    items: Mapped[list["InspectionItem"]] = relationship(
        back_populates="inspection",
        cascade="all, delete-orphan",
        order_by="InspectionItem.order_index",
    )


class InspectionItem(Base):
    __tablename__ = "inspection_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    inspection_id: Mapped[int] = mapped_column(
        ForeignKey("inspections.id", ondelete="CASCADE")
    )
    label: Mapped[str] = mapped_column(String(255))
    result: Mapped[str | None] = mapped_column(String(10), nullable=True)  # pass/fail/na
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    inspection: Mapped["Inspection"] = relationship(back_populates="items")


class JobReview(Base):
    """Customer satisfaction review for a job.

    One review request per job. Staff/admin request it; the assigned client
    fills in a 1-5 star rating plus free-text feedback. While ``completed`` is
    False the assigned client is nagged on every login; submitting flips it to
    True and the nag stops.
    """

    __tablename__ = "job_reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), unique=True, index=True
    )

    requested_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    completed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)  # what they liked
    improvement: Mapped[str | None] = mapped_column(Text, nullable=True)  # how to improve

    reviewer_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    reviewer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    job: Mapped["Job"] = relationship(back_populates="review")


class ReviewSeen(Base):
    """Tracks which staff/admin users have seen the 'review submitted' notice.

    The client nag is derived from completion state, but the staff/admin notice
    is a one-time-per-user alert: each user sees that a review came in exactly
    once (their first login after it), tracked independently per user.
    """

    __tablename__ = "review_notification_seen"
    __table_args__ = (
        UniqueConstraint("user_id", "review_id", name="uq_review_seen"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    review_id: Mapped[int] = mapped_column(
        ForeignKey("job_reviews.id", ondelete="CASCADE"), index=True
    )
    seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FinalInspection(Base):
    """Client-completed final sign-off for a job.

    One per job. Staff/admin "submit" (release) it, which moves the job into
    the Inspection stage and makes the form available to the assigned client.
    The client fills in the inspector's name (and an optional internal
    reference) and submits, marking it complete. A customer review can only be
    requested once this is complete.
    """

    __tablename__ = "final_inspections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), unique=True, index=True
    )

    requested_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )

    completed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    inspector_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    internal_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Outcome of the latest sign-off attempt:
    #   None     -> released, awaiting the client (pending / re-inspection)
    #   "passed" -> client approved it (completed is also True; review unlocks)
    #   "failed" -> client rejected it; the job sits in "Inspection Failed" until
    #               staff fix the issue and send it back for re-inspection.
    result: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Why the client rejected the most recent attempt (kept for context on the
    # next re-inspection; every failure is also logged to the timeline + notes).
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional NCR number relating this failure to a raised non-conformance
    # report. Free text (not a hard FK) since the NCR may be raised separately
    # and the reference just needs to point staff at it.
    ncr_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # How many times the client has rejected this job's final inspection.
    attempts: Mapped[int] = mapped_column(Integer, default=0)

    failed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    failed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    completed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # ---- Request for closure (client didn't / won't inspect) ----
    # A parallel path to the normal client sign-off: staff request closure, an
    # admin approves, and the inspection is then passed internally without the
    # client. The normal client submit/pass/fail flow above is unchanged.
    #   closure_status:
    #     None        -> no closure request
    #     "pending"   -> staff requested, awaiting an admin decision
    #     "approved"  -> admin approved; inspection passed internally
    #     "rejected"  -> admin declined; staff may re-request or inspect normally
    closure_status: Mapped[str | None] = mapped_column(String(10), nullable=True)
    closure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closure_requested_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    closure_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closure_decided_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    closure_decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    closure_rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    job: Mapped["Job"] = relationship(back_populates="final_inspection")
    attempts_log: Mapped[list["FinalInspectionAttempt"]] = relationship(
        back_populates="final_inspection",
        cascade="all, delete-orphan",
        order_by="FinalInspectionAttempt.attempt_number",
    )


class FinalInspectionAttempt(Base):
    """One row per pass/fail outcome of a job's final inspection.

    The FinalInspection record only carries the latest state; this log keeps the
    full history — every failed attempt with its reason, plus the final pass, in
    order — so an inspection report can show what happened and when.
    """

    __tablename__ = "final_inspection_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(
        ForeignKey("jobs.id", ondelete="CASCADE"), index=True
    )
    final_inspection_id: Mapped[int] = mapped_column(
        ForeignKey("final_inspections.id", ondelete="CASCADE"), index=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer, default=1)
    result: Mapped[str] = mapped_column(String(10))  # "passed" | "failed"
    inspector_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Optional NCR number relating this specific failed attempt to a raised
    # non-conformance report (mirrors FinalInspection.ncr_number, but kept
    # per-attempt so the full history shows which failure it belonged to).
    ncr_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    internal_reference: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    final_inspection: Mapped["FinalInspection"] = relationship(
        back_populates="attempts_log"
    )


class NCR(Base):
    """Non-Conformance Report — an internal quality record.

    Raised by staff/admin when something doesn't conform to requirements. It can
    optionally be linked to a job (a snapshot of the job number is also stored so
    the record survives if the job is later deleted). Follows a simple
    Open → In Progress → Closed lifecycle with the usual quality fields
    (category, severity, source, disposition, root cause, corrective action).
    """

    __tablename__ = "ncrs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ncr_number: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    sequence: Mapped[int] = mapped_column(Integer, index=True)

    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Snapshot of the linked job's number at creation, so the NCR still shows
    # which job it related to even if that job is later deleted.
    job_number: Mapped[str | None] = mapped_column(String(120), nullable=True)

    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(60), default="Other")
    severity: Mapped[str] = mapped_column(String(20), default="Minor")
    source: Mapped[str] = mapped_column(String(40), default="In-Process")
    disposition: Mapped[str] = mapped_column(String(40), default="Pending")
    root_cause: Mapped[str | None] = mapped_column(Text, nullable=True)
    corrective_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Open", index=True)

    raised_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    raised_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    closed_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    job: Mapped["Job | None"] = relationship(back_populates="ncrs")


class TrainingRecord(Base):
    """A signed record that a worker was trained on specific WorkshopIQ topics.

    Captured on a "store day" sign-off: pick the worker, tick which topics
    they were walked through, and get a drawn signature on screen. This is a
    compliance/audit trail only — it does not gate access to anything else in
    the app.
    """

    __tablename__ = "training_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Snapshot so the record still shows who was trained even if that user
    # account is later removed.
    worker_name: Mapped[str] = mapped_column(String(255))
    # JSON array of topic ids from the frontend's TRAINING_TOPICS list,
    # e.g. ["qr-checkin", "ncr"].
    topics: Mapped[str] = mapped_column(Text)
    # Drawn signature, captured as a base64 PNG data URI from an on-screen
    # canvas — no separate file storage needed for something this small.
    signature_png: Mapped[str] = mapped_column(Text)
    trained_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    trained_by_name: Mapped[str] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
