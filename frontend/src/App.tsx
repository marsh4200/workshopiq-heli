import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Box } from '@mui/material';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Activate from './pages/Activate';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import ClientHome from './pages/ClientHome';
import ClientReviews from './pages/ClientReviews';
import Jobs from './pages/Jobs';
import NewJob from './pages/NewJob';
import JobDetail from './pages/JobDetail';
import NCRs from './pages/NCRs';
import ClosureRequests from './pages/ClosureRequests';
import InspectionReports from './pages/InspectionReports';
import ClientInspectionReports from './pages/ClientInspectionReports';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Templates from './pages/Templates';
import CheckinLists from './pages/CheckinLists';
import Settings from './pages/Settings';
import Appearance from './pages/Appearance';
import Samba from './pages/Samba';
import Training from './pages/Training';
import { useAuth } from './context/AuthContext';
import { getLicenseStatus } from './api/client';
import type { LicenseStatus } from './types';

// Clients get their own sign-off view of inspection reports; staff/admin get
// the full generate/manage page. Same route, role-branched.
function InspectionReportsRoute() {
  const { isClient } = useAuth();
  return isClient ? <ClientInspectionReports /> : <InspectionReports />;
}

// Clients get a friendly portal home (needs-you cards + job folders); staff and
// admin keep the operations dashboard. Same route, role-branched.
function HomeRoute() {
  const { isClient } = useAuth();
  return isClient ? <ClientHome /> : <Dashboard />;
}

export default function App() {
  // Gate the entire app behind license activation. Checked once on load
  // (and again whenever Activate reports a fresh status); every other
  // /api route already refuses server-side if this comes back unactivated,
  // so this is what keeps an unlicensed install from ever reaching the
  // login screen or anything past it.
  const [license, setLicense] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLicenseStatus()
      .then((s) => {
        if (!cancelled) setLicense(s);
      })
      .catch(() => {
        if (!cancelled) setLicense({ activated: false, reason: 'not_activated', server_id: '' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!license) {
    // Still checking — an empty dark screen avoids a white flash before the
    // real UI (or the activation screen) is ready to render.
    return <Box sx={{ minHeight: '100vh', bgcolor: '#0a0e16' }} />;
  }

  if (!license.activated) {
    return <Activate status={license} onActivated={setLicense} />;
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<HomeRoute />} />
        <Route
          path="/reviews"
          element={
            <ProtectedRoute roles={['client']}>
              <ClientReviews />
            </ProtectedRoute>
          }
        />
        <Route path="/jobs" element={<Jobs />} />
        <Route
          path="/jobs/new"
          element={
            <ProtectedRoute roles={['administrator', 'staff']}>
              <NewJob />
            </ProtectedRoute>
          }
        />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route
          path="/ncrs"
          element={
            <ProtectedRoute roles={['administrator', 'staff']}>
              <NCRs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/closure-requests"
          element={
            <ProtectedRoute roles={['administrator']}>
              <ClosureRequests />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inspection-reports"
          element={
            <ProtectedRoute>
              <InspectionReportsRoute />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute roles={['administrator', 'staff']}>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="/templates"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Templates />
            </ProtectedRoute>
          }
        />
        <Route
          path="/checkin-lists"
          element={
            <ProtectedRoute roles={['administrator']}>
              <CheckinLists />
            </ProtectedRoute>
          }
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="/appearance" element={<Appearance />} />
        <Route
          path="/samba"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Samba />
            </ProtectedRoute>
          }
        />
        <Route
          path="/training"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Training />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
