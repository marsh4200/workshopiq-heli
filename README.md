# WorkshopIQ

**Engineering Workshop Intake, Inspection & Client Portal**

WorkshopIQ is a self-hosted web application for engineering workshops to manage jobs from intake through inspection, production and collection — with a built-in client portal so customers can follow their own jobs in real time.

Built with **FastAPI + PostgreSQL** on the backend and **React + TypeScript + MUI** on the frontend, packaged with Docker and served on a single port (**9918**).

---

## Features

- **Authentication & roles** — JWT auth with three roles: Administrator, Staff and Client. The default `admin / admin` login is forced to change its password on first sign-in.
- **Client isolation** — Client users only ever see the jobs explicitly assigned to them, in a clean read-only portal.
- **Job intake** — Capture customer, contact, PO and component details. Job numbers are generated automatically from a configurable prefix; changing the prefix continues the running sequence (e.g. `Job 12` → change prefix → `Acme 13`).
- **Inspections** — 13 engineering component types, each with its own editable checklist. Every item is recorded as Pass / Fail / N/A with notes. Inspections can be marked complete or reopened.
- **Photos** — Drag-and-drop or mobile-camera capture, organised into Before / After / General, with captions, a full-screen lightbox viewer and timestamps.
- **Documents** — Attach quotes, drawings and reports to any job.
- **Notes & queries** — Timestamped notes typed as Internal, Customer, Query, Progress or Action. Clients never see internal notes.
- **Status workflow** — 11 lifecycle statuses with an automatic activity timeline.
- **Dashboard** — Live job counts, a status breakdown chart and a recent-activity feed, scoped per role.
- **Settings** — Company name, logo and branding, job-number prefix, SMTP email and an update source with a **Check for Updates / Apply Update** flow that backs up, pulls the latest release and restarts.

---

## Quick start

On a fresh Ubuntu/Debian server, one line installs Docker (if missing), clones and starts everything:

```bash
curl -fsSL https://raw.githubusercontent.com/marsh4200/workshopiq-heli/main/scripts/bootstrap.sh | bash
```

Or clone manually — `install.sh` installs Docker if it isn't already present:

```bash
git clone https://github.com/marsh4200/workshopiq-heli.git
cd workshopiq
bash scripts/install.sh
```

Then open **http://localhost:9918** and sign in with `admin` / `admin`. You will be prompted to set a new password immediately.

---

## Configuration

`install.sh` creates a `.env` from `.env.example` and generates a random `SECRET_KEY`. Edit `.env` to set production values:

| Variable | Purpose | Default |
| --- | --- | --- |
| `APP_PORT` | Public port | `9918` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials | `workshopiq` |
| `SECRET_KEY` | JWT signing key | random (set this!) |
| `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` | First-run admin | `admin` / `admin` |

---

## Architecture

```
Browser ──▶ nginx (port 9918)
              ├─ serves the React SPA (static)
              └─ proxies /api ─▶ FastAPI backend (port 8000) ─▶ PostgreSQL
                                          │
                                          └─ uploads volume (photos, docs, logo)
```

| Service | Image / build | Notes |
| --- | --- | --- |
| `frontend` | nginx + built SPA | The only published port (`9918`). Serves the UI and proxies the API. |
| `backend` | python:3.12-slim + FastAPI | Internal on `8000`. Creates schema and seeds defaults on first boot. |
| `db` | postgres:16-alpine | Data persisted in the `db_data` volume. |

The database schema is created automatically on first launch (SQLAlchemy), which also seeds the default admin, default settings and the 13 inspection templates.

---

## Repository structure

```
workshopiq/
├── backend/            FastAPI application
│   ├── app/
│   │   ├── api/        Route handlers (auth, jobs, users, templates, settings, dashboard)
│   │   ├── core/       Config, database, security, bootstrap
│   │   ├── models/     SQLAlchemy ORM models
│   │   ├── schemas/    Pydantic schemas
│   │   └── services/   Settings, templates data, file handling
│   └── requirements.txt
├── frontend/           React + TypeScript + Vite + MUI
│   └── src/
│       ├── api/        Axios client + typed endpoints
│       ├── components/ Layout, PhotoGallery, shared UI
│       ├── context/    Auth + Settings providers
│       ├── pages/      Dashboard, Jobs, JobDetail, Users, Templates, Settings, …
│       └── theme/      MUI dark theme
├── docker/             Dockerfiles + nginx config
├── database/           Schema reference
├── scripts/            install / backup / update
├── docs/               Additional documentation
├── docker-compose.yml
└── .env.example
```

---

## Operations

**Backup** — dumps the database and archives uploads to `backups/`:

```bash
./scripts/backup.sh
```

**Update manually** — backup, pull the latest release tag, rebuild and restart:

```bash
./scripts/update.sh
```

**In-app updates** — Administrators can use *Check for Updates* / *Apply Update* in Settings, which shows a live progress dialog. For the button to actually do anything, the host must run the update watcher. Install it once as a service (survives reboots):

```bash
./scripts/install-updater.sh
```

This registers `workshopiq-updater.service`, which backs up, pulls the latest tag, rebuilds and restarts when an update is requested — streaming progress back to the UI. The service user must be able to run Docker (the installer's `usermod -aG docker` handles this). Watch its logs with `sudo journalctl -u workshopiq-updater -f`.

**Common commands**

```bash
docker compose logs -f         # tail logs
docker compose restart         # restart services
docker compose down            # stop (data is preserved in volumes)
docker compose up -d --build   # rebuild after changes
```

---

## Default roles

| Role | Can do |
| --- | --- |
| **Administrator** | Everything: users, inspection templates, settings, updates, client access, all jobs. |
| **Staff** | Create and manage jobs, inspections, photos, documents and notes. |
| **Client** | Read-only view of assigned jobs — status, progress, customer notes, photos and documents. |

---

## Security notes

- Change `admin`'s password on first login (enforced) and set a strong `SECRET_KEY`.
- Set real database credentials in `.env` before exposing the service.
- Put WorkshopIQ behind HTTPS (a reverse proxy / tunnel) for any internet-facing deployment.
