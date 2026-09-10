# Database

WorkshopIQ uses **PostgreSQL 16**. The schema is created automatically on first
launch by SQLAlchemy (`create_all`) — there is no manual migration step to run.

On first boot the backend also seeds:

- the default administrator (`admin` / `admin`, forced password change),
- default application settings (company name, job prefix, sequence, etc.),
- the 13 default inspection templates and their checklist items.

## Tables (overview)

| Table | Purpose |
| --- | --- |
| `users` | Accounts and roles (administrator / staff / client). |
| `settings` | Key/value application settings. |
| `jobs` | Core job records (number, customer, component type, status). |
| `client_job_access` | Links client users to the jobs they may view. |
| `photos` | Uploaded photos (before / after / general) per job. |
| `documents` | Uploaded documents per job. |
| `notes` | Timestamped notes by type (internal / customer / query / progress / action). |
| `timeline_events` | Automatic activity log per job. |
| `inspection_templates` / `template_items` | Per-component-type checklists. |
| `inspections` / `inspection_items` | Inspection instances and their results. |

## Reset

To wipe all data and start fresh:

```bash
docker compose down -v   # removes the db_data and uploads_data volumes
docker compose up -d --build
```
