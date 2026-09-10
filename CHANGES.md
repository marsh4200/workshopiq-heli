# WorkshopIQ — Ruben, Print QR, Android documents, mobile scroll lock

## Edited files (7) + new file (1)

### New
- `frontend/src/utils/platform.ts` — shared helpers: `isAndroid()` and
  `printQrSheet()`, a QR print routine that only fires the print dialog once
  the QR image has fully loaded inside the print document. Falls back to a
  hidden iframe if the popup is blocked.

### Backend
- `backend/app/api/checkin.py` — **Ruben** added to the check-in operator
  dropdown (OPERATORS list).
- `backend/app/api/inspection_report.py` — `/inspection-reports/blank.pdf`
  now also accepts `?token=` auth (same pattern as job documents), so
  Android can open it via a plain navigation.

### Frontend
- `frontend/src/pages/JobDetail.tsx`
  - Check-In QR **Print** now uses `printQrSheet` — the old fixed 250ms
    delay raced the image and printed a blank square instead of the code.
  - Documents tab: on **Android** (browser and the APK), View/Download hand
    the real authenticated URL (`?token=`) to the OS instead of a `blob:`
    URL — Android's download manager / WebView can't fetch blobs, which is
    why documents did nothing on Android while iPhone worked.
- `frontend/src/pages/InspectionReports.tsx` — new **Print QR** button in
  the QR dialog (prints the code itself with certificate number + job), next
  to the existing Print blank.
- `frontend/src/api/client.ts` — "Print blank" on Android opens the real
  `?token=` URL instead of a blob so the device's PDF viewer gets it.
- `frontend/src/index.css` + `frontend/src/components/Layout.tsx` — page is
  locked to vertical scrolling on phones. `overflow-x: hidden` on
  html/body/#root, `minWidth: 0` on the main flex column (a wide table no
  longer pushes the whole layout sideways), and on ≤900px cards scroll
  their own content horizontally so wide tables stay fully reachable
  inside the card while the page only moves up/down.

## Hot file-drop safe
No new dependencies, no DB migration. Drop the files in and rebuild the
frontend as usual. Frontend builds clean (`tsc -b && vite build` verified).
