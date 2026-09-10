import type { ReactNode } from 'react';
import EngineeringIcon from '@mui/icons-material/Engineering';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import GavelOutlinedIcon from '@mui/icons-material/GavelOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined';

export interface TrainingStep {
  label: string;
  note: string;
  screen: ReactNode;
}

export interface TrainingTopic {
  id: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
  steps: TrainingStep[];
}

// Shared building blocks for the little recreated "screens" below, so every
// step frames the same way regardless of what it's showing.
const Screen = ({ children }: { children: ReactNode }) => (
  <div
    style={{
      background: 'var(--mui-palette-background-default, rgba(127,127,127,0.06))',
      borderRadius: 10,
      padding: 14,
    }}
  >
    {children}
  </div>
);

const StatusChip = ({ label, active }: { label: string; active?: boolean }) => (
  <span
    style={{
      display: 'inline-block',
      fontSize: 11,
      fontWeight: 600,
      padding: '3px 8px',
      borderRadius: 999,
      marginRight: 6,
      marginBottom: 6,
      border: active ? '1px solid currentColor' : '1px solid rgba(127,127,127,0.3)',
      opacity: active ? 1 : 0.45,
    }}
  >
    {label}
  </span>
);

const Card = ({ children, accent }: { children: ReactNode; accent?: boolean }) => (
  <div
    style={{
      background: 'rgba(127,127,127,0.08)',
      border: accent ? '2px solid currentColor' : '1px solid rgba(127,127,127,0.25)',
      borderRadius: 8,
      padding: '10px 12px',
      marginBottom: 8,
      fontSize: 13,
    }}
  >
    {children}
  </div>
);

const Field = ({ label, value }: { label: string; value: string }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </div>
    <div
      style={{
        fontSize: 13,
        border: '1px solid rgba(127,127,127,0.3)',
        borderRadius: 6,
        padding: '6px 8px',
        marginTop: 2,
      }}
    >
      {value}
    </div>
  </div>
);

export const TRAINING_TOPICS: TrainingTopic[] = [
  {
    id: 'job-lifecycle',
    title: 'Job lifecycle',
    subtitle: 'Received to closed, start to finish',
    icon: <EngineeringIcon />,
    steps: [
      {
        label: '1. A job comes in',
        note: 'New jobs start at Received. This is what the team sees on the board.',
        screen: (
          <Screen>
            <Card accent>
              EVEJOB 42 · ADMO
              <div style={{ opacity: 0.7, fontSize: 12, marginTop: 2 }}>
                2 off VRN 500 plate feed chute
              </div>
            </Card>
            <div>
              <StatusChip label="Received" active />
              <StatusChip label="Machining" />
              <StatusChip label="Inspection" />
              <StatusChip label="Completed" />
              <StatusChip label="Closed" />
            </div>
          </Screen>
        ),
      },
      {
        label: '2. Work moves it along',
        note: 'As machining starts and finishes, update the status dropdown on the job — the timeline logs every change automatically.',
        screen: (
          <Screen>
            <div>
              <StatusChip label="Received" />
              <StatusChip label="Machining" active />
              <StatusChip label="Inspection" />
              <StatusChip label="Completed" />
              <StatusChip label="Closed" />
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              Timeline: status changed Received → Machining
            </div>
          </Screen>
        ),
      },
      {
        label: '3. Inspection and completion',
        note: 'Once the final inspection passes, the job moves to Completed (or Awaiting Customer Review if a sign-off is needed).',
        screen: (
          <Screen>
            <div>
              <StatusChip label="Machining" />
              <StatusChip label="Inspection" />
              <StatusChip label="Completed" active />
              <StatusChip label="Awaiting Customer Review" />
              <StatusChip label="Closed" />
            </div>
          </Screen>
        ),
      },
      {
        label: '4. Closed',
        note: 'Closure request gets approved (see the Final inspection topic) and the job locks in as Closed.',
        screen: (
          <Screen>
            <div>
              <StatusChip label="Completed" />
              <StatusChip label="Awaiting Customer Review" />
              <StatusChip label="Closed" active />
            </div>
          </Screen>
        ),
      },
    ],
  },
  {
    id: 'qr-checkin',
    title: 'QR machine check-in',
    subtitle: 'Scan with your phone to put a job on a machine',
    icon: <QrCode2Icon />,
    steps: [
      {
        label: '1. The QR unlocks after inspection',
        note: "Every job gets its own one-time check-in QR code. It only becomes available once the job's inspection has been completed — until then the Check-In tab shows a waiting notice.",
        screen: (
          <Screen>
            <Field label="Job" value="EVEJOB 42 — ADMO" />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  border: '2px solid currentColor',
                  borderRadius: 8,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 10,
                  opacity: 0.8,
                }}
              >
                QR
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Check-In tab → the job's unique QR code
              </div>
            </div>
          </Screen>
        ),
      },
      {
        label: '2. Print it onto the job card',
        note: 'Use Print (or Download) on the Check-In tab and attach the QR to the job traveler / paperwork that moves with the work.',
        screen: (
          <Screen>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, border: '2px solid currentColor', borderRadius: 6, padding: 6, textAlign: 'center', fontSize: 12 }}>
                Print
              </div>
              <div style={{ flex: 1, border: '1px solid rgba(127,127,127,0.3)', borderRadius: 6, padding: 6, textAlign: 'center', fontSize: 12 }}>
                Download
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              QR travels with the job to the floor
            </div>
          </Screen>
        ),
      },
      {
        label: '3. Pull out your phone and scan',
        note: 'When you are about to start the job, open your phone camera and point it at the QR on the job card. No app, no login — the check-in page opens straight in the browser.',
        screen: (
          <Screen>
            <div
              style={{
                background: '#111',
                borderRadius: 8,
                aspectRatio: '1.4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#888',
                fontSize: 12,
              }}
            >
              📱 Camera → QR on the job card
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              Tap the link that pops up
            </div>
          </Screen>
        ),
      },
      {
        label: '4. Pick your name and the machine',
        note: 'The form shows the job number so you know you scanned the right card. Choose your operator name and the machine you are loading the job onto from the dropdowns.',
        screen: (
          <Screen>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Machine check-in — EVEJOB 42</div>
            <Field label="Operator name" value="Kevin" />
            <Field label="Machine" value="Gemini Lathe" />
          </Screen>
        ),
      },
      {
        label: '5. Tap Check in',
        note: 'Nothing is recorded until you submit. On submit the job is checked in on that machine and its status moves to Machining automatically.',
        screen: (
          <Screen>
            <div style={{ border: '2px solid currentColor', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 13, marginBottom: 8 }}>
              Check in
            </div>
            <div>
              <StatusChip label="Received" />
              <StatusChip label="Machining" active />
              <StatusChip label="Inspection" />
            </div>
          </Screen>
        ),
      },
      {
        label: '6. Logged and locked',
        note: 'The timeline records who checked in, on which machine, and when. The QR is one-time — scanning it again shows "already checked in", and the code on the job page gets a CHECKED IN stamp.',
        screen: (
          <Screen>
            <div style={{ fontSize: 13 }}>✓ Checked in</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
              Kevin on Gemini Lathe · 2 min ago
            </div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 8 }}>
              Timeline: Checked in on Gemini Lathe
            </div>
          </Screen>
        ),
      },
    ],
  },
  {
    id: 'final-inspection',
    title: 'Final inspection',
    subtitle: 'Gates, closure requests, sign-off',
    icon: <GavelOutlinedIcon />,
    steps: [
      {
        label: '1. Run the final inspection',
        note: 'Once machining is done, open the final inspection checklist on the job.',
        screen: (
          <Screen>
            <Field label="Status" value="Inspection" />
            <div style={{ border: '2px solid currentColor', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 13 }}>
              Run final inspection
            </div>
          </Screen>
        ),
      },
      {
        label: '2. Pass or fail the gate',
        note: 'The checklist has to pass before a closure request can be raised — fail it and the job goes back to Machining instead.',
        screen: (
          <Screen>
            <Card>Dimension verification — Pass</Card>
            <Card>Visual finish — Pass</Card>
            <Card>Photos attached — Pass</Card>
          </Screen>
        ),
      },
      {
        label: '3. Request closure',
        note: 'Passing the gate surfaces a Request closure button. Staff raise it; it goes to an admin for approval.',
        screen: (
          <Screen>
            <div style={{ fontSize: 13, marginBottom: 8 }}>Closure requested</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Awaiting admin approval</div>
          </Screen>
        ),
      },
      {
        label: '4. Admin approves',
        note: 'From Closure Requests (admin only), approve or reject. Approving sets the job to Closed.',
        screen: (
          <Screen>
            <Card accent>EVEJOB 42 — closure pending</Card>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, border: '1px solid rgba(127,127,127,0.3)', borderRadius: 6, padding: 6, textAlign: 'center', fontSize: 12 }}>
                Reject
              </div>
              <div style={{ flex: 1, border: '2px solid currentColor', borderRadius: 6, padding: 6, textAlign: 'center', fontSize: 12 }}>
                Approve
              </div>
            </div>
          </Screen>
        ),
      },
    ],
  },
  {
    id: 'inspection-reports',
    title: 'Inspection reports',
    subtitle: 'Generating and filling QR reports',
    icon: <FactCheckOutlinedIcon />,
    steps: [
      {
        label: '1. Generate a report',
        note: 'From Inspection Reports, pick the job — this allocates a certificate number and a QR code.',
        screen: (
          <Screen>
            <Field label="Job" value="EVEJOB 42 — ADMO" />
            <div style={{ border: '2px solid currentColor', borderRadius: 8, padding: 8, textAlign: 'center', fontSize: 13 }}>
              Generate
            </div>
          </Screen>
        ),
      },
      {
        label: '2. Scan or open the link',
        note: 'Anyone with the QR (or the link) gets a no-login form, pre-filled with the job header.',
        screen: (
          <Screen>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
              <div style={{ width: 64, height: 64, border: '1px solid rgba(127,127,127,0.4)', borderRadius: 6 }} />
            </div>
            <Field label="Certificate" value="ECE 260012" />
          </Screen>
        ),
      },
      {
        label: '3. Fill it in and submit',
        note: 'Measurement rows, QCP pass/reject/rework, and a signature. Submitting is what actually files it.',
        screen: (
          <Screen>
            <Field label="Thickness on the O/D — Act" value="25,43" />
            <Field label="Inspector" value="Kevin" />
          </Screen>
        ),
      },
      {
        label: '4. Filed automatically',
        note: 'On submit it renders to PDF, files itself into the job Documents, and writes to the timeline. No manual upload step.',
        screen: (
          <Screen>
            <Card>Inspection Report ECE 260012.pdf — added to Documents</Card>
          </Screen>
        ),
      },
    ],
  },
  {
    id: 'ncr',
    title: 'NCR module',
    subtitle: 'Logging and tracking non-conformance',
    icon: <ReportProblemOutlinedIcon />,
    steps: [
      {
        label: '1. Raise an NCR',
        note: 'From NCRs, start a new one — link it to a job if it relates to one.',
        screen: (
          <Screen>
            <Field label="Title" value="Bore diameter out of tolerance" />
            <Field label="Linked job" value="EVEJOB 42" />
          </Screen>
        ),
      },
      {
        label: '2. Classify it',
        note: 'Category, severity and source describe what happened and where it was caught.',
        screen: (
          <Screen>
            <div>
              <StatusChip label="Dimensional" active />
              <StatusChip label="Material" />
              <StatusChip label="Workmanship" />
            </div>
            <div>
              <StatusChip label="Minor" />
              <StatusChip label="Major" active />
              <StatusChip label="Critical" />
            </div>
          </Screen>
        ),
      },
      {
        label: '3. Decide the disposition',
        note: 'Use as is, rework, repair, scrap, or return to supplier — plus root cause and corrective action.',
        screen: (
          <Screen>
            <div>
              <StatusChip label="Use As Is" />
              <StatusChip label="Rework" active />
              <StatusChip label="Scrap" />
            </div>
          </Screen>
        ),
      },
      {
        label: '4. Work it to closed',
        note: 'Status moves Open → In Progress → Closed as the corrective action gets done.',
        screen: (
          <Screen>
            <div>
              <StatusChip label="Open" />
              <StatusChip label="In Progress" active />
              <StatusChip label="Closed" />
            </div>
          </Screen>
        ),
      },
    ],
  },
  {
    id: 'costing',
    title: 'Costing tab',
    subtitle: 'Entering time, materials, totals',
    icon: <RequestQuoteOutlinedIcon />,
    steps: [
      {
        label: '1. Open the Costing tab',
        note: "On a job, the Costing tab is staff/admin only — clients never see these figures.",
        screen: (
          <Screen>
            <Field label="Job" value="EVEJOB 42 — ADMO" />
          </Screen>
        ),
      },
      {
        label: '2. Add a cost line',
        note: 'Description, supplier, quantity and unit cost — one line per item or service.',
        screen: (
          <Screen>
            <Field label="Description" value="500mm plate, 25mm stock" />
            <Field label="Supplier" value="BAL Steel" />
          </Screen>
        ),
      },
      {
        label: '3. Running total',
        note: 'Quantity × unit cost rolls up automatically as you add lines.',
        screen: (
          <Screen>
            <Card>Plate stock · 2 × R1,450.00</Card>
            <Card>Machining time · 6 × R320.00</Card>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>Total: R4,820.00</div>
          </Screen>
        ),
      },
    ],
  },
];
