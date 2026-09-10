# WorkshopIQ — Usage Guide

## First login

1. Open `http://<host>:9918`.
2. Sign in with `admin` / `admin`.
3. Set a new password when prompted.

## Setting up

As an administrator, before bringing staff and clients on board:

1. **Settings** — set your company name, upload a logo, set the dashboard tagline and confirm the **job number prefix** (e.g. `Acme`). Optionally configure SMTP.
2. **Inspection Templates** — review the 13 default component checklists and tailor the items to your shop. Add, remove, reorder or rename items, or create new templates.
3. **Users** — create Staff accounts for your team and Client accounts for customers. New users are prompted to change their password on first login.

## Day-to-day (Staff / Admin)

- **New Job** — capture the customer and component details. A job number is assigned automatically.
- **Job detail tabs:**
  - *Overview* — edit job details and change the status (drives the timeline).
  - *Inspections* — start an inspection for the component type; the matching checklist loads. Mark each item Pass / Fail / N/A, add notes, then mark complete.
  - *Photos* — drag-and-drop or use the device camera; tag photos Before / After / General with captions.
  - *Documents* — attach quotes, drawings and reports.
  - *Notes* — log internal or customer-facing notes, queries, progress and actions.
  - *Timeline* — automatic history of everything that happened on the job.
  - *Client Access* (admin) — choose which client users can see the job.

## Client portal

Clients sign in and see only the jobs assigned to them. They get a read-only view of status, progress, customer-facing notes, photos and documents. Internal notes are never shown to clients.

## Customer reviews

On a job's **Review** tab, staff or admins can **Request a customer review**. From then on, every assigned client sees a banner at the top of the app on each login — *"How did we do on Job N?"* — that keeps reappearing until the review is submitted (it never auto-dismisses).

The client clicks **Leave review**, gives a 1-5 star rating, optionally notes what they were happy with and how the team could improve, and submits. That marks the job's review complete and the banner stops appearing. The result (stars + both comments + who submitted it and when) then shows on the job's Review tab for staff. Each submission is also recorded on the job timeline.

## Reports

Administrators and staff can generate basic job reports from the **Reports** page (clients can't access it). Choose **Monthly** or **Yearly**, pick the period, and optionally filter by status. The report lists each job's number, client name, PO number, component and status, ordered by date received.

Use **Print / Save PDF** to open a clean, branded printout (company name and logo) in a new tab that triggers the browser's print dialog — from there you can print on paper or save as PDF. Jobs are bucketed by the calendar month/year of their *date received*, using South African time (UTC+2 by default; configurable via `REPORT_TZ_OFFSET_HOURS`).

## Job numbering

Job numbers combine the configured prefix and a running sequence: `Job 1`, `Job 2`, … Changing the prefix in Settings does **not** reset the sequence — the next job simply uses the new prefix and the next number (e.g. switch to `Acme` and the next job becomes `Acme 3`).

## Backup & restore

Administrators get a **Backup & Restore** panel in Settings. **Download Backup** produces a single `.zip` containing everything — every job, user, setting and review, plus all uploaded photos and documents. Store it somewhere safe (off the server).

To recover after a crash or move to a new server: reinstall WorkshopIQ as normal, log in as the default administrator, then use **Restore from Backup** and upload that `.zip`. Restore overwrites all current data and uploads with the backup's contents (a typed confirmation is required first), then reloads. The database schema is recreated automatically on startup, so a backup restores cleanly onto a fresh install.

## Updating

Administrators use **Check for Updates** in Settings to compare the current and latest released versions, and **Apply Update** to back up, update and restart. The update dialog shows a live progress bar that tracks each phase — backup, fetch, rebuild, restart — to 100%, and keeps tracking (reconnecting automatically) while the containers restart. For the in-app button to take effect, the host must be running the update watcher:

```bash
./scripts/update.sh --watch
```

Alternatively, update directly on the host at any time:

```bash
./scripts/update.sh
```
