"""Job lifecycle endpoints: jobs, notes, photos, documents, inspections."""
import mimetypes
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import (
    get_current_user,
    get_user_for_file,
    require_admin,
    require_staff,
)
from app.core.database import get_db
from app.models import (
    ClientJobAccess,
    Document,
    FinalInspection,
    Inspection,
    InspectionItem,
    InspectionReport,
    InspectionTemplate,
    Job,
    JobCheckin,
    JobEmailContact,
    NCR,
    Note,
    Photo,
    TimelineEvent,
    User,
    UserRole,
)
from app.schemas import (
    AssignClientsRequest,
    InspectionCreate,
    InspectionOut,
    InspectionUpdate,
    JobCreate,
    JobDetailOut,
    JobEmailContactIn,
    JobEmailSend,
    JobListOut,
    JobUpdate,
    NoteCreate,
    NoteOut,
    PhotoOut,
)
from app.services import email_service, file_service
from app.services.certificate_service import build_job_certificate
from app.services.job_pack_service import build_job_pack_zip
from app.services.settings_service import get_setting, next_job_number
from app.services.templates_data import JOB_STATUSES

router = APIRouter(prefix="/jobs", tags=["jobs"])


def actor_name(user: User) -> str:
    return user.full_name or user.username


async def log_event(
    db: AsyncSession, job_id: int, event_type: str, description: str, user: User
) -> None:
    db.add(
        TimelineEvent(
            job_id=job_id,
            event_type=event_type,
            description=description,
            actor_name=actor_name(user),
        )
    )


async def get_client_job_ids(db: AsyncSession, user_id: int) -> set[int]:
    result = await db.execute(
        select(ClientJobAccess.job_id).where(ClientJobAccess.user_id == user_id)
    )
    return set(result.scalars().all())


async def job_has_client_access(db: AsyncSession, job_id: int) -> bool:
    """True if at least one client has been granted access to this job.

    Actions that push work to the customer — releasing the final inspection,
    requesting a review, or skipping the inspection straight to review — require
    this. Without it the job would 'send' to nobody and just sit on the server.
    """
    result = await db.execute(
        select(ClientJobAccess.id).where(ClientJobAccess.job_id == job_id).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def assert_can_view(db: AsyncSession, job: Job, user: User) -> None:
    if user.role == UserRole.client.value:
        allowed = await get_client_job_ids(db, user.id)
        if job.id not in allowed:
            raise HTTPException(status_code=403, detail="Access denied")


async def load_job_detail(db: AsyncSession, job_id: int) -> Job | None:
    result = await db.execute(
        select(Job)
        .options(
            selectinload(Job.photos),
            selectinload(Job.documents),
            selectinload(Job.notes),
            selectinload(Job.timeline),
            selectinload(Job.inspections).selectinload(Inspection.items),
            selectinload(Job.client_access).selectinload(ClientJobAccess.user),
            selectinload(Job.final_inspection).selectinload(
                FinalInspection.attempts_log
            ),
            selectinload(Job.checkins),
            selectinload(Job.email_contacts),
        )
        .where(Job.id == job_id)
    )
    return result.scalar_one_or_none()


def serialize_detail(job: Job) -> JobDetailOut:
    data = JobDetailOut.model_validate(job)
    data.notes = sorted(job.notes, key=lambda n: n.created_at, reverse=True)
    data.timeline = sorted(job.timeline, key=lambda t: t.created_at, reverse=True)
    data.client_user_ids = [a.user_id for a in job.client_access]
    data.client_names = [
        (a.user.full_name or a.user.username)
        for a in job.client_access
        if a.user
    ]
    data.checked_in = any(c.checked_in for c in job.checkins)
    return data


# ---------------- Jobs ----------------
@router.get("", response_model=list[JobListOut])
async def list_jobs(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    query = select(Job).order_by(Job.sequence.desc())
    if user.role == UserRole.client.value:
        allowed = await get_client_job_ids(db, user.id)
        if not allowed:
            return []
        query = query.where(Job.id.in_(allowed))
    if status:
        query = query.where(Job.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=JobDetailOut, status_code=201)
async def create_job(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job_number, sequence = await next_job_number(db)
    job = Job(
        job_number=job_number,
        sequence=sequence,
        customer_name=payload.customer_name,
        contact_person=payload.contact_person,
        phone=payload.phone,
        email=payload.email,
        po_number=payload.po_number,
        eq_number=payload.eq_number,
        due_date=payload.due_date,
        description=payload.description,
        component_type=payload.component_type,
        quantity=max(1, payload.quantity or 1),
        status="Received",
        created_by_id=user.id,
    )
    if payload.date_received:
        job.date_received = payload.date_received
    db.add(job)
    await db.flush()
    db.add(JobCheckin(job_id=job.id, token=secrets.token_urlsafe(12)))
    await log_event(db, job.id, "created", f"Job {job_number} created", user)

    # Optionally grant client access at intake. Any staff member (not only
    # administrators) may set client access, mirroring the dedicated
    # assign-clients endpoint.
    if payload.client_user_ids:
        added = 0
        for uid in dict.fromkeys(payload.client_user_ids):
            client = await db.get(User, uid)
            if client and client.role == UserRole.client.value:
                db.add(ClientJobAccess(user_id=uid, job_id=job.id))
                added += 1
        if added:
            await log_event(
                db, job.id, "access", f"Client access granted to {added} user(s)", user
            )

    await db.commit()
    detail = await load_job_detail(db, job.id)
    return serialize_detail(detail)


@router.get("/{job_id}", response_model=JobDetailOut)
async def get_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await load_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)
    return serialize_detail(job)


@router.put("/{job_id}", response_model=JobDetailOut)
async def update_job(
    job_id: int,
    payload: JobUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if payload.status and payload.status != job.status:
        if payload.status not in JOB_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        # The workflow drives status automatically (check-in → Machining,
        # final inspection → Inspection/Completed, review → Closed). Non-admin
        # staff may only manually CLOSE a job (e.g. it was pulled/cancelled);
        # every other transition is left to the system.
        if user.role != UserRole.administrator.value and payload.status != "Closed":
            raise HTTPException(
                status_code=403,
                detail="Staff can only close a job manually — other statuses follow the workflow.",
            )
        old = job.status
        job.status = payload.status
        await log_event(
            db, job.id, "status_change", f"Status changed: {old} → {payload.status}", user
        )

    for field in (
        "customer_name",
        "contact_person",
        "phone",
        "email",
        "po_number",
        "eq_number",
        "description",
        "component_type",
        "notify_on_status_change",
        "notify_on_job_completion",
    ):
        value = getattr(payload, field)
        if value is not None:
            setattr(job, field, value)

    if payload.quantity is not None:
        job.quantity = max(1, int(payload.quantity))

    # due_date is special: allow explicitly clearing it (sending null) — only
    # touch it when the client actually included the field in the request.
    if "due_date" in payload.model_fields_set:
        job.due_date = payload.due_date

    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


@router.post("/{job_id}/whatsapp-log", response_model=JobDetailOut)
async def log_whatsapp(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Record that a staff member sent a WhatsApp update to the customer.

    The message itself is composed and opened client-side (a wa.me link), so
    this endpoint just leaves an audit trail on the job timeline.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await log_event(
        db, job.id, "whatsapp", "WhatsApp update sent to customer", user
    )
    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


@router.post("/{job_id}/email-contacts", response_model=JobDetailOut, status_code=201)
async def add_job_email_contact(
    job_id: int,
    payload: JobEmailContactIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Save a named email address against a job.

    A job can carry several of these — e.g. the buyer and a site foreman —
    so the Send Status/Completion Email dialog has someone to pick from and
    knows what name to greet them by.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    name = payload.name.strip()
    email = payload.email.strip()
    username = (payload.username or "").strip() or None
    if not name or not email:
        raise HTTPException(status_code=400, detail="Name and email are required")
    if "@" not in email:
        raise HTTPException(status_code=400, detail="That doesn't look like a valid email address")
    db.add(JobEmailContact(job_id=job.id, name=name, email=email, username=username))
    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


@router.delete("/{job_id}/email-contacts/{contact_id}", response_model=JobDetailOut)
async def delete_job_email_contact(
    job_id: int,
    contact_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    contact = await db.get(JobEmailContact, contact_id)
    if not contact or contact.job_id != job_id:
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.delete(contact)
    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


@router.post("/{job_id}/send-email", response_model=JobDetailOut)
async def send_job_email(
    job_id: int,
    payload: JobEmailSend,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    """Manually send a notification email to one of the job's saved contacts.

    Nothing in WorkshopIQ triggers this on its own — a staff/admin member
    opens the job, picks who on the job's contact list it's going to,
    reviews the drafted subject/body (composed client-side, the same way the
    WhatsApp message is, greeting whoever was picked by their saved name),
    and presses Send. Unlike the WhatsApp button, which just opens a wa.me
    link, this one actually sends via the SMTP account configured in
    Settings.
    """
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    contact = await db.get(JobEmailContact, payload.contact_id)
    if not contact or contact.job_id != job.id:
        raise HTTPException(
            status_code=400, detail="Pick a saved email contact for this job first."
        )

    if payload.kind == "completion":
        if not job.notify_on_job_completion:
            raise HTTPException(
                status_code=409,
                detail="Completion emails are turned off for this job — enable that toggle first.",
            )
    elif payload.kind == "status":
        if not job.notify_on_status_change:
            raise HTTPException(
                status_code=409,
                detail="Status-change emails are turned off for this job — enable that toggle first.",
            )
    else:
        raise HTTPException(status_code=400, detail="Invalid kind")

    subject = payload.subject.strip()
    body = payload.body.strip()
    if not subject or not body:
        raise HTTPException(status_code=400, detail="Subject and body are required")

    try:
        await email_service.send_email(db, [contact.email], subject, body)
    except email_service.EmailNotConfigured as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — surface the SMTP failure to staff
        raise HTTPException(status_code=502, detail=f"Send failed: {exc}")

    now = datetime.now(timezone.utc)
    if payload.kind == "completion":
        job.last_completion_email_at = now
        log_desc = f"Completion email sent to {contact.name} <{contact.email}>"
    else:
        job.last_status_email_at = now
        log_desc = f"Status update email sent to {contact.name} <{contact.email}>"
    await log_event(db, job.id, "email", log_desc, user)
    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    job = await load_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for photo in job.photos:
        file_service.delete_file(photo.filename)
    for doc in job.documents:
        file_service.delete_file(doc.filename)
    await db.delete(job)
    await db.commit()


@router.put("/{job_id}/clients", response_model=JobDetailOut)
async def assign_clients(
    job_id: int,
    payload: AssignClientsRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await load_job_detail(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for access in list(job.client_access):
        await db.delete(access)
    await db.flush()
    for uid in payload.user_ids:
        client = await db.get(User, uid)
        if client and client.role == UserRole.client.value:
            db.add(ClientJobAccess(user_id=uid, job_id=job_id))
    await log_event(db, job_id, "access", "Client access updated", user)
    await db.commit()
    detail = await load_job_detail(db, job_id)
    return serialize_detail(detail)


# ---------------- Notes ----------------
@router.post("/{job_id}/notes", response_model=NoteOut, status_code=201)
async def add_note(
    job_id: int,
    payload: NoteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Clients may leave notes, but only on jobs they're assigned to.
    await assert_can_view(db, job, user)

    note_type = payload.note_type
    if user.role == UserRole.client.value:
        # Clients post customer-facing notes only — never internal/staff types.
        if note_type not in {"customer", "query"}:
            note_type = "customer"

    note = Note(
        job_id=job_id,
        note_type=note_type,
        body=payload.body,
        author_id=user.id,
        author_name=actor_name(user),
    )
    db.add(note)
    await log_event(db, job_id, "note", f"{note_type.title()} note added", user)
    await db.commit()
    await db.refresh(note)
    return note


# ---------------- Photos ----------------
@router.post("/{job_id}/photos", response_model=list[PhotoOut], status_code=201)
async def upload_photos(
    job_id: int,
    files: list[UploadFile] = File(...),
    category: str = Form("general"),
    caption: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    # Anyone who can view the job may add photos: administrators, staff, and
    # clients assigned to this job. Photos are visible to everyone with view
    # access (see serve_file / assert_can_view), so a client's upload shows up
    # for staff and vice versa.
    await assert_can_view(db, job, user)
    saved: list[Photo] = []
    for upload in files:
        try:
            stored, original = await file_service.save_upload(
                upload, job_id, compact_images=True
            )
        except ValueError as exc:
            raise HTTPException(status_code=413, detail=str(exc))
        photo = Photo(
            job_id=job_id,
            filename=stored,
            original_name=original,
            category=category if category in {"before", "after", "general"} else "general",
            caption=caption,
            uploaded_by_id=user.id,
        )
        db.add(photo)
        saved.append(photo)
    await log_event(db, job_id, "photo", f"{len(saved)} photo(s) uploaded", user)
    await db.commit()
    for p in saved:
        await db.refresh(p)
    return saved


@router.delete("/{job_id}/photos/{photo_id}", status_code=204)
async def delete_photo(
    job_id: int,
    photo_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    photo = await db.get(Photo, photo_id)
    if not photo or photo.job_id != job_id:
        raise HTTPException(status_code=404, detail="Photo not found")
    file_service.delete_file(photo.filename)
    await db.delete(photo)
    await db.commit()


# ---------------- Documents ----------------
@router.post("/{job_id}/documents", status_code=201)
async def upload_documents(
    job_id: int,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for upload in files:
        try:
            stored, original = await file_service.save_upload(upload, job_id)
        except ValueError as exc:
            raise HTTPException(status_code=413, detail=str(exc))
        db.add(
            Document(
                job_id=job_id,
                filename=stored,
                original_name=original,
                content_type=upload.content_type,
                uploaded_by_id=user.id,
            )
        )
    await log_event(db, job_id, "document", "Document(s) uploaded", user)
    await db.commit()
    return {"status": "ok"}


@router.delete("/{job_id}/documents/{doc_id}", status_code=204)
async def delete_document(
    job_id: int,
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    doc = await db.get(Document, doc_id)
    if not doc or doc.job_id != job_id:
        raise HTTPException(status_code=404, detail="Document not found")

    # If this document is a filed inspection report, remove the report record
    # too — otherwise the Inspection Reports page keeps a "Filed" row pointing
    # at a PDF that no longer exists. Deleting the document IS deleting the
    # report; the certificate number is simply retired.
    linked_reports = (
        await db.execute(
            select(InspectionReport).where(InspectionReport.document_id == doc_id)
        )
    ).scalars().all()
    for report in linked_reports:
        await log_event(
            db,
            job_id,
            "inspection_report",
            f"Inspection report {report.certificate_number} deleted with its document",
            user,
        )
        await db.delete(report)

    file_service.delete_file(doc.filename)
    await db.delete(doc)
    await db.commit()


# ---------------- File serving ----------------
@router.get("/{job_id}/files/{filename}")
async def serve_file(
    job_id: int,
    filename: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_user_for_file),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)
    path = file_service.file_path(filename)
    if not path.exists() or not filename.startswith(f"job{job_id}_"):
        raise HTTPException(status_code=404, detail="File not found")

    # Prefer the stored document's recorded type / original name so the browser
    # (and Android in particular) receive a correct Content-Type and a friendly
    # filename, and render the file INLINE. Without an explicit inline
    # disposition + real media type, Android can't pick a viewer and fails with
    # "no app for this link".
    doc = (
        await db.execute(
            select(Document).where(
                Document.job_id == job_id, Document.filename == filename
            )
        )
    ).scalar_one_or_none()

    media_type = (
        (doc.content_type if doc and doc.content_type else None)
        or mimetypes.guess_type(str(path))[0]
        or "application/octet-stream"
    )
    display_name = (doc.original_name if doc and doc.original_name else None) or filename
    safe_name = display_name.replace('"', "").replace("\n", " ").replace("\r", " ").strip()
    if not safe_name:
        safe_name = filename

    return FileResponse(
        path,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'},
    )


# ---------------- Certificate / Job report (PDF) ----------------
@router.get("/{job_id}/certificate")
async def job_certificate(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Branded PDF for a job.

    Renders a Certificate of Conformance when the job's final inspection has
    passed, otherwise a neutral Job Report. Clients can download the document
    for any job they have access to (it's their deliverable); staff/admin for
    any job. Returns a real application/pdf payload — no headless browser.
    """
    result = await db.execute(
        select(Job)
        .options(
            selectinload(Job.inspections).selectinload(Inspection.items),
            selectinload(Job.final_inspection).selectinload(
                FinalInspection.attempts_log
            ),
            selectinload(Job.ncrs),
        )
        .where(Job.id == job_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)

    company = await get_setting(db, "company_name") or "WorkshopIQ"
    logo_path = None
    logo_name = await get_setting(db, "company_logo")
    if logo_name:
        candidate = file_service.file_path(logo_name)
        if candidate.exists():
            logo_path = candidate

    pdf = build_job_certificate(job, company, logo_path)

    passed = bool(job.final_inspection and job.final_inspection.result == "passed")
    kind = "Certificate" if passed else "Report"
    safe_no = job.job_number.replace("/", "-").replace(" ", "_")
    filename = f"{safe_no}_{kind}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------- Job pack (ZIP: cover doc + all photos + all documents) ----------------
@router.get("/{job_id}/pack")
async def job_pack(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Everything filed on this job, bundled into one ZIP.

    Contains the same branded cover PDF as ``/jobs/{id}/certificate``, plus
    every photo (grouped Before / After / General) and every document that
    has been uploaded or filed against the job — the complete record handed
    to the client once their job is done. Same access rule as the
    certificate: clients can pull it for any job they have access to,
    staff/admin for any job.
    """
    result = await db.execute(
        select(Job)
        .options(
            selectinload(Job.inspections).selectinload(Inspection.items),
            selectinload(Job.final_inspection).selectinload(
                FinalInspection.attempts_log
            ),
            selectinload(Job.ncrs),
            selectinload(Job.photos),
            selectinload(Job.documents),
        )
        .where(Job.id == job_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await assert_can_view(db, job, user)

    company = await get_setting(db, "company_name") or "WorkshopIQ"
    logo_path = None
    logo_name = await get_setting(db, "company_logo")
    if logo_name:
        candidate = file_service.file_path(logo_name)
        if candidate.exists():
            logo_path = candidate

    zip_bytes = build_job_pack_zip(job, company, logo_path)

    safe_no = job.job_number.replace("/", "-").replace(" ", "_")
    filename = f"{safe_no}_JobPack.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------- Inspections ----------------
@router.post("/{job_id}/inspections", response_model=InspectionOut, status_code=201)
async def create_inspection(
    job_id: int,
    payload: InspectionCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    job = await db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    inspection = Inspection(
        job_id=job_id,
        component_type=payload.component_type,
        title=payload.title or f"{payload.component_type} Inspection",
        inspector_id=user.id,
        inspector_name=actor_name(user),
    )
    db.add(inspection)
    await db.flush()

    # Load checklist from template
    result = await db.execute(
        select(InspectionTemplate)
        .options(selectinload(InspectionTemplate.items))
        .where(InspectionTemplate.component_type == payload.component_type)
    )
    template = result.scalar_one_or_none()
    if template:
        for item in template.items:
            db.add(
                InspectionItem(
                    inspection_id=inspection.id,
                    label=item.label,
                    order_index=item.order_index,
                )
            )
    await log_event(
        db, job_id, "inspection", f"{payload.component_type} inspection started", user
    )
    await db.commit()
    result = await db.execute(
        select(Inspection)
        .options(selectinload(Inspection.items))
        .where(Inspection.id == inspection.id)
    )
    return result.scalar_one()


@router.put(
    "/{job_id}/inspections/{inspection_id}", response_model=InspectionOut
)
async def update_inspection(
    job_id: int,
    inspection_id: int,
    payload: InspectionUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    result = await db.execute(
        select(Inspection)
        .options(selectinload(Inspection.items))
        .where(Inspection.id == inspection_id, Inspection.job_id == job_id)
    )
    inspection = result.scalar_one_or_none()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")

    if payload.title is not None:
        inspection.title = payload.title
    if payload.completed is not None:
        inspection.completed = payload.completed
    if payload.items:
        by_id = {i.id: i for i in inspection.items}
        for upd in payload.items:
            item = by_id.get(upd.id)
            if item:
                if upd.result is not None:
                    item.result = upd.result
                if upd.notes is not None:
                    item.notes = upd.notes
    await db.commit()
    result = await db.execute(
        select(Inspection)
        .options(selectinload(Inspection.items))
        .where(Inspection.id == inspection_id)
    )
    return result.scalar_one()


@router.delete("/{job_id}/inspections/{inspection_id}", status_code=204)
async def delete_inspection(
    job_id: int,
    inspection_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_staff),
):
    result = await db.execute(
        select(Inspection).where(
            Inspection.id == inspection_id, Inspection.job_id == job_id
        )
    )
    inspection = result.scalar_one_or_none()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    await db.delete(inspection)
    await db.commit()
