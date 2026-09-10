import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/Print';
import SummarizeIcon from '@mui/icons-material/SummarizeOutlined';
import TimelineIcon from '@mui/icons-material/TimelineOutlined';
import { getJobReport, getJob, listJobs, listCustomers, fetchMeta, apiError } from '../api/client';
import { StatusBadge, STATUS_COLORS, fmtDay, fmtDate, EmptyState } from '../components/common';
import { useSettings } from '../context/SettingsContext';
import { useDeviceType } from '../hooks/useDeviceType';
import PersonSearchIcon from '@mui/icons-material/PersonSearchOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';
import { Autocomplete } from '@mui/material';
import type { JobReportResponse, JobListItem, JobDetail, Customer } from '../types';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const now = new Date();
const YEARS = Array.from({ length: 7 }, (_, i) => now.getFullYear() - i);

// Statuses eligible for an individual timeline report.
const INDIVIDUAL_STATUSES = ['Machining', 'Inspection', 'Closed'];

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );

const resultLabel = (r?: string | null) =>
  !r ? 'Pending' : r === 'na' ? 'N/A' : r.charAt(0).toUpperCase() + r.slice(1);

export default function Reports() {
  const [tab, setTab] = useState(0);

  return (
    <Box>
      <Typography variant="h4" fontWeight={800} sx={{ mb: 2 }}>
        Reports
      </Typography>

      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Period Reports" />
        <Tab label="Customer Report" />
        <Tab label="Individual Job Report" />
      </Tabs>

      {tab === 0 ? <PeriodReports /> : tab === 1 ? <CustomerReport /> : <IndividualReport />}
    </Box>
  );
}

/* ===================================================================== */
/* Customer report — every job for one customer, all time or per year.   */
/* ===================================================================== */
function CustomerReport() {
  const { settings } = useSettings();
  const isMobile = useDeviceType().isMobile;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState('');
  const [scope, setScope] = useState<'all' | 'year'>('all');
  const [year, setYear] = useState(now.getFullYear());
  const [status, setStatus] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);

  const [report, setReport] = useState<JobReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch(() => undefined);
    fetchMeta()
      .then((m) => setStatuses(m.statuses))
      .catch(() => undefined);
  }, []);

  const generate = async () => {
    if (!customer.trim()) {
      setError('Pick a customer first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getJobReport({
        period: scope === 'all' ? 'all' : 'year',
        year: scope === 'year' ? year : undefined,
        status: status || undefined,
        customer: customer.trim(),
      });
      setReport(data);
    } catch (e) {
      setError(apiError(e, 'Failed to generate report'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const logoUrl = settings?.company_logo
    ? `/api/settings/logo/${settings.company_logo}`
    : '';

  const handlePrint = () => {
    if (!report) return;
    const company = report.company_name || 'WorkshopIQ';
    const title = 'Customer Job Report';
    const generated = new Date(report.generated_at).toLocaleString();
    const customerName = report.customer_filter || customer;

    const rows = report.jobs
      .map(
        (j, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="mono">${escapeHtml(j.job_number)}</td>
          <td>${escapeHtml(j.po_number || '—')}</td>
          <td>${escapeHtml(j.component_type || '—')}</td>
          <td>${escapeHtml(j.status)}</td>
          <td>${new Date(j.date_received).toLocaleDateString()}</td>
        </tr>`,
      )
      .join('');

    const breakdown = Object.entries(report.status_breakdown)
      .filter(([, c]) => c > 0)
      .map(([st, c]) => `<span class="pill">${escapeHtml(st)}: <b>${c}</b></span>`)
      .join('');

    const filterLine = report.status_filter
      ? `<div class="meta">Filtered by status: <b>${escapeHtml(report.status_filter)}</b></div>`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(company)} — ${title} — ${escapeHtml(customerName)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    color: #111; margin: 32px; font-size: 12px;
  }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 14px; }
  header img { height: 52px; width: auto; object-fit: contain; }
  .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .brand .sub { color: #555; font-size: 12px; margin-top: 2px; }
  .report-title { text-align: right; margin-left: auto; }
  .report-title .t { font-size: 15px; font-weight: 700; }
  .report-title .p { font-size: 18px; font-weight: 800; }
  .meta { color: #555; margin-top: 4px; font-size: 11px; }
  .summary { margin: 16px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .total { font-size: 14px; font-weight: 700; margin-right: 8px; }
  .pill { border: 1px solid #ccc; border-radius: 999px; padding: 2px 10px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  td.num { color: #888; width: 28px; }
  td.mono { font-family: 'SF Mono', Consolas, monospace; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; color: #777; font-size: 10px; display: flex; justify-content: space-between; }
  .empty { padding: 40px; text-align: center; color: #777; }
  @media print {
    body { margin: 14mm; }
    @page { size: A4; margin: 12mm; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <header>
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" onerror="this.style.display='none'" />` : ''}
    <div class="brand">
      <h1>${escapeHtml(company)}</h1>
      <div class="sub">Customer Job Report</div>
    </div>
    <div class="report-title">
      <div class="t">${escapeHtml(customerName)}</div>
      <div class="p">${escapeHtml(report.period_label)}</div>
      ${filterLine}
    </div>
  </header>

  <div class="summary">
    <span class="total">${report.total} job${report.total === 1 ? '' : 's'}</span>
    ${breakdown}
  </div>

  ${
    report.jobs.length
      ? `<table>
    <thead>
      <tr>
        <th>#</th><th>Job #</th><th>PO Number</th>
        <th>Component</th><th>Status</th><th>Received</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
      : `<div class="empty">No jobs recorded for this customer.</div>`
  }

  <footer>
    <span>Generated ${escapeHtml(generated)}</span>
    <span>${escapeHtml(company)} · WorkshopIQ</span>
  </footer>
  <script>
    window.onload = function () { window.focus(); window.print(); };
  </script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
      setError('Could not open print window — please allow pop-ups for this site.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const activeBreakdown = useMemo(
    () =>
      report
        ? Object.entries(report.status_breakdown).filter(([, c]) => c > 0)
        : [],
    [report],
  );

  return (
    <Box>
      <Card sx={{ p: { xs: 2, md: 2.5 }, mb: 3 }}>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Autocomplete
              freeSolo
              options={customers.map((c) => c.name)}
              inputValue={customer}
              onInputChange={(_, v) => setCustomer(v)}
              sx={{ minWidth: 260, flex: 1 }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Customer"
                  helperText="Pick a customer, or type the exact name as it appears on their jobs"
                />
              )}
            />
            <TextField
              select
              label="Scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'all' | 'year')}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">All time</MenuItem>
              <MenuItem value="year">Single year</MenuItem>
            </TextField>
            {scope === 'year' && (
              <TextField
                select
                label="Year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                sx={{ minWidth: 140 }}
              >
                {YEARS.map((y) => (
                  <MenuItem key={y} value={y}>
                    {y}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              label="Status (optional)"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {statuses.map((st) => (
                <MenuItem key={st} value={st}>
                  {st}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              onClick={generate}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <PersonSearchIcon />}
              sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
            >
              Generate
            </Button>
          </Stack>
        </Stack>
      </Card>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {!report && !loading && !error && (
        <Card>
          <EmptyState
            icon={<PersonSearchIcon sx={{ fontSize: 40 }} />}
            title="Pick a customer to report on"
            subtitle="Choose a customer above and generate a report covering all of their jobs."
          />
        </Card>
      )}

      {report && (
        <Card sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={2}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                {report.customer_filter || customer} · {report.period_label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {report.total} job{report.total === 1 ? '' : 's'}
                {report.status_filter ? ` · ${report.status_filter}` : ''}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={handlePrint}
              disabled={!report.total}
            >
              Print / Save PDF
            </Button>
          </Stack>

          {activeBreakdown.length > 0 && (
            <>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                {activeBreakdown.map(([st, c]) => (
                  <Chip key={st} label={`${st}: ${c}`} size="small" variant="outlined" />
                ))}
              </Stack>
              <Divider sx={{ mb: 2 }} />
            </>
          )}

          {report.jobs.length === 0 ? (
            <EmptyState
              icon={<PersonSearchIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
              title="No jobs for this customer"
              subtitle="Check the customer name matches how it was captured on the jobs."
            />
          ) : isMobile ? (
            <Stack spacing={1.5}>
              {report.jobs.map((j) => (
                <Card key={j.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography fontWeight={800}>{j.job_number}</Typography>
                    <StatusBadge status={j.status} />
                  </Stack>
                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      PO: {j.po_number || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {fmtDay(j.date_received)}
                    </Typography>
                  </Stack>
                </Card>
              ))}
            </Stack>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job #</TableCell>
                  <TableCell>PO Number</TableCell>
                  <TableCell>Component</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Received</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.jobs.map((j) => (
                  <TableRow key={j.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{j.job_number}</TableCell>
                    <TableCell>{j.po_number || '—'}</TableCell>
                    <TableCell>{j.component_type || '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={j.status} />
                    </TableCell>
                    <TableCell>{fmtDay(j.date_received)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </Box>
  );
}

/* ===================================================================== */
/* Period reports — the original monthly / yearly summary (unchanged).   */
/* ===================================================================== */
function PeriodReports() {
  const { settings } = useSettings();
  const isMobile = useDeviceType().isMobile;

  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [status, setStatus] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);

  const [report, setReport] = useState<JobReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMeta()
      .then((m) => setStatuses(m.statuses))
      .catch(() => undefined);
  }, []);

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getJobReport({
        period,
        year,
        month: period === 'month' ? month : undefined,
        status: status || undefined,
      });
      setReport(data);
    } catch (e) {
      setError(apiError(e, 'Failed to generate report'));
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  const logoUrl = settings?.company_logo
    ? `/api/settings/logo/${settings.company_logo}`
    : '';

  const handlePrint = () => {
    if (!report) return;
    const company = report.company_name || 'WorkshopIQ';
    const title = `${period === 'month' ? 'Monthly' : 'Yearly'} Job Report`;
    const generated = new Date(report.generated_at).toLocaleString();

    const rows = report.jobs
      .map(
        (j, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="mono">${escapeHtml(j.job_number)}</td>
          <td>${escapeHtml(j.customer_name)}</td>
          <td>${escapeHtml(j.po_number || '—')}</td>
          <td>${escapeHtml(j.component_type || '—')}</td>
          <td>${escapeHtml(j.status)}</td>
          <td>${new Date(j.date_received).toLocaleDateString()}</td>
        </tr>`,
      )
      .join('');

    const breakdown = Object.entries(report.status_breakdown)
      .filter(([, c]) => c > 0)
      .map(([s, c]) => `<span class="pill">${escapeHtml(s)}: <b>${c}</b></span>`)
      .join('');

    const filterLine = report.status_filter
      ? `<div class="meta">Filtered by status: <b>${escapeHtml(report.status_filter)}</b></div>`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(company)} — ${title} — ${escapeHtml(report.period_label)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    color: #111; margin: 32px; font-size: 12px;
  }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 14px; }
  header img { height: 52px; width: auto; object-fit: contain; }
  .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .brand .sub { color: #555; font-size: 12px; margin-top: 2px; }
  .report-title { text-align: right; margin-left: auto; }
  .report-title .t { font-size: 15px; font-weight: 700; }
  .report-title .p { font-size: 18px; font-weight: 800; }
  .meta { color: #555; margin-top: 4px; font-size: 11px; }
  .summary { margin: 16px 0; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .total { font-size: 14px; font-weight: 700; margin-right: 8px; }
  .pill { border: 1px solid #ccc; border-radius: 999px; padding: 2px 10px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { background: #f3f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  td.num { color: #888; width: 28px; }
  td.mono { font-family: 'SF Mono', Consolas, monospace; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; color: #777; font-size: 10px; display: flex; justify-content: space-between; }
  .empty { padding: 40px; text-align: center; color: #777; }
  @media print {
    body { margin: 14mm; }
    @page { size: A4; margin: 12mm; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <header>
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" onerror="this.style.display='none'" />` : ''}
    <div class="brand">
      <h1>${escapeHtml(company)}</h1>
      <div class="sub">Workshop Job Report</div>
    </div>
    <div class="report-title">
      <div class="t">${title}</div>
      <div class="p">${escapeHtml(report.period_label)}</div>
      ${filterLine}
    </div>
  </header>

  <div class="summary">
    <span class="total">${report.total} job${report.total === 1 ? '' : 's'}</span>
    ${breakdown}
  </div>

  ${
    report.jobs.length
      ? `<table>
    <thead>
      <tr>
        <th>#</th><th>Job #</th><th>Client</th><th>PO Number</th>
        <th>Component</th><th>Status</th><th>Received</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
      : `<div class="empty">No jobs recorded for this period.</div>`
  }

  <footer>
    <span>Generated ${escapeHtml(generated)}</span>
    <span>${escapeHtml(company)} · WorkshopIQ</span>
  </footer>
  <script>
    window.onload = function () { window.focus(); window.print(); };
  </script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
      setError('Could not open print window — please allow pop-ups for this site.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const activeBreakdown = useMemo(
    () =>
      report
        ? Object.entries(report.status_breakdown).filter(([, c]) => c > 0)
        : [],
    [report],
  );

  return (
    <Box>
      {/* Controls */}
      <Card sx={{ p: { xs: 2, md: 2.5 }, mb: 3 }}>
        <Stack spacing={2}>
          <ToggleButtonGroup
            color="primary"
            exclusive
            value={period}
            onChange={(_e, v) => v && setPeriod(v)}
            size="small"
          >
            <ToggleButton value="month" sx={{ px: 3 }}>
              Monthly
            </ToggleButton>
            <ToggleButton value="year" sx={{ px: 3 }}>
              Yearly
            </ToggleButton>
          </ToggleButtonGroup>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            {period === 'month' && (
              <TextField
                select
                label="Month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                sx={{ minWidth: 180 }}
              >
                {MONTHS.map((m, i) => (
                  <MenuItem key={m} value={i + 1}>
                    {m}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              label="Year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              sx={{ minWidth: 140 }}
            >
              {YEARS.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Status (optional)"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {statuses.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              onClick={generate}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <SummarizeIcon />}
              sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
            >
              Generate
            </Button>
          </Stack>
        </Stack>
      </Card>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {!report && !loading && !error && (
        <Card>
          <EmptyState
            icon={<SummarizeIcon sx={{ fontSize: 40 }} />}
            title="No report generated yet"
            subtitle="Pick a period above and generate a summary of jobs completed in that window."
          />
        </Card>
      )}

      {/* Results */}
      {report && (
        <Card sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={2}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="h6" fontWeight={800}>
                {period === 'month' ? 'Monthly' : 'Yearly'} Report · {report.period_label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {report.total} job{report.total === 1 ? '' : 's'}
                {report.status_filter ? ` · ${report.status_filter}` : ''}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<PrintIcon />}
              onClick={handlePrint}
              disabled={!report.total}
            >
              Print / Save PDF
            </Button>
          </Stack>

          {activeBreakdown.length > 0 && (
            <>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                {activeBreakdown.map(([s, c]) => (
                  <Chip key={s} label={`${s}: ${c}`} size="small" variant="outlined" />
                ))}
              </Stack>
              <Divider sx={{ mb: 2 }} />
            </>
          )}

          {report.jobs.length === 0 ? (
            <EmptyState
              icon={<SummarizeIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
              title="No jobs for this period"
              subtitle="Try a different month or year."
            />
          ) : isMobile ? (
            <Stack spacing={1.5}>
              {report.jobs.map((j) => (
                <Card key={j.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography fontWeight={800}>{j.job_number}</Typography>
                    <StatusBadge status={j.status} />
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {j.customer_name}
                  </Typography>
                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      PO: {j.po_number || '—'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {fmtDay(j.date_received)}
                    </Typography>
                  </Stack>
                </Card>
              ))}
            </Stack>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job #</TableCell>
                  <TableCell>Client</TableCell>
                  <TableCell>PO Number</TableCell>
                  <TableCell>Component</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Received</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.jobs.map((j) => (
                  <TableRow key={j.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>{j.job_number}</TableCell>
                    <TableCell>{j.customer_name}</TableCell>
                    <TableCell>{j.po_number || '—'}</TableCell>
                    <TableCell>{j.component_type || '—'}</TableCell>
                    <TableCell>
                      <StatusBadge status={j.status} />
                    </TableCell>
                    <TableCell>{fmtDay(j.date_received)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </Box>
  );
}

/* ===================================================================== */
/* Individual job report — pick customer → pick job → print timeline.    */
/* ===================================================================== */
function IndividualReport() {
  const { settings } = useSettings();

  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [customer, setCustomer] = useState('');
  const [jobId, setJobId] = useState<number | ''>('');

  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');

  // Load every job once, then filter to the eligible statuses client-side.
  useEffect(() => {
    setLoadingJobs(true);
    listJobs()
      .then((all) => setJobs(all.filter((j) => INDIVIDUAL_STATUSES.includes(j.status))))
      .catch((e) => setError(apiError(e, 'Failed to load jobs')))
      .finally(() => setLoadingJobs(false));
  }, []);

  // Unique customer names (alphabetical) among eligible jobs.
  const customers = useMemo(
    () => Array.from(new Set(jobs.map((j) => j.customer_name))).sort((a, b) =>
      a.localeCompare(b),
    ),
    [jobs],
  );

  // Jobs for the chosen customer, newest first.
  const customerJobs = useMemo(
    () =>
      jobs
        .filter((j) => j.customer_name === customer)
        .sort((a, b) => +new Date(b.date_received) - +new Date(a.date_received)),
    [jobs, customer],
  );

  // Load full detail when a job is selected.
  useEffect(() => {
    if (jobId === '') {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    setError('');
    getJob(jobId)
      .then(setDetail)
      .catch((e) => {
        setError(apiError(e, 'Failed to load job'));
        setDetail(null);
      })
      .finally(() => setLoadingDetail(false));
  }, [jobId]);

  const logoUrl = settings?.company_logo
    ? `/api/settings/logo/${settings.company_logo}`
    : '';

  const handlePrint = () => {
    if (!detail) return;
    const company = settings?.company_name || 'WorkshopIQ';
    const generated = new Date().toLocaleString();
    const statusColor = STATUS_COLORS[detail.status] || '#64748b';

    // Timeline oldest → newest, so the report reads as the job's life story.
    const events = [...detail.timeline].sort(
      (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
    );

    const detailRow = (label: string, value?: string | null) =>
      `<tr><td class="k">${escapeHtml(label)}</td><td class="v">${escapeHtml(value || '—')}</td></tr>`;

    const detailsTable = `
      <table class="kv">
        ${detailRow('Customer', detail.customer_name)}
        ${detailRow('Contact', detail.contact_person)}
        ${detailRow('Phone', detail.phone)}
        ${detailRow('Email', detail.email)}
        ${detailRow('PO Number', detail.po_number)}
        ${detailRow('EQ Number', detail.eq_number)}
        ${detailRow('Component', detail.component_type)}
        ${detailRow('Date Received', detail.date_received ? new Date(detail.date_received).toLocaleDateString() : '—')}
        ${detailRow('Created', detail.created_at ? new Date(detail.created_at).toLocaleString() : '—')}
      </table>`;

    const descBlock = detail.description
      ? `<div class="section"><h2>Description</h2><p class="desc">${escapeHtml(detail.description)}</p></div>`
      : '';

    const timelineBlock = events.length
      ? `<div class="section"><h2>Timeline</h2><ul class="timeline">
          ${events
            .map(
              (ev) => `<li>
                <div class="dot"></div>
                <div class="evt">
                  <div class="evt-desc">${escapeHtml(ev.description)}</div>
                  <div class="evt-meta">${escapeHtml(ev.actor_name || 'System')} · ${escapeHtml(new Date(ev.created_at).toLocaleString())}</div>
                </div>
              </li>`,
            )
            .join('')}
        </ul></div>`
      : `<div class="section"><h2>Timeline</h2><p class="muted">No activity recorded.</p></div>`;

    const inspectionsBlock = detail.inspections.length
      ? `<div class="section"><h2>Inspections</h2>
          ${detail.inspections
            .map((insp) => {
              const pass = insp.items.filter((i) => i.result === 'pass').length;
              const fail = insp.items.filter((i) => i.result === 'fail').length;
              const itemRows = insp.items
                .map(
                  (it) => `<tr>
                    <td>${escapeHtml(it.label)}</td>
                    <td>${escapeHtml(resultLabel(it.result))}</td>
                    <td>${escapeHtml(it.notes || '')}</td>
                  </tr>`,
                )
                .join('');
              return `<div class="insp">
                <div class="insp-head">
                  <b>${escapeHtml(insp.title || insp.component_type)}</b>
                  <span class="muted"> — ${escapeHtml(insp.inspector_name || '—')} · ${insp.completed ? 'Completed' : 'In progress'} · ${pass} pass / ${fail} fail</span>
                </div>
                ${
                  insp.items.length
                    ? `<table class="items"><thead><tr><th>Item</th><th>Result</th><th>Notes</th></tr></thead><tbody>${itemRows}</tbody></table>`
                    : ''
                }
              </div>`;
            })
            .join('')}
        </div>`
      : '';

    const fi = detail.final_inspection;
    const finalBlock =
      fi && fi.attempts_log && fi.attempts_log.length
        ? `<div class="section"><h2>Final Inspection</h2>
            <table class="items">
              <thead><tr><th>#</th><th>Result</th><th>Inspector</th><th>Reference / Reason</th><th>When</th></tr></thead>
              <tbody>
                ${fi.attempts_log
                  .map(
                    (a) => `<tr>
                      <td>${a.attempt_number}</td>
                      <td>${escapeHtml(a.result === 'passed' ? 'Passed' : 'Failed')}</td>
                      <td>${escapeHtml(a.inspector_name || '—')}</td>
                      <td>${escapeHtml(a.reason || a.internal_reference || '—')}</td>
                      <td>${escapeHtml(new Date(a.created_at).toLocaleString())}</td>
                    </tr>`,
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : '';

    const notesBlock = detail.notes.length
      ? `<div class="section"><h2>Notes</h2><ul class="notes">
          ${detail.notes
            .map(
              (n) => `<li>
                <div class="note-body">${escapeHtml(n.body)}</div>
                <div class="evt-meta">${escapeHtml(n.note_type)} · ${escapeHtml(n.author_name || 'System')} · ${escapeHtml(new Date(n.created_at).toLocaleString())}</div>
              </li>`,
            )
            .join('')}
        </ul></div>`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(company)} — Job Report — ${escapeHtml(detail.job_number)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    color: #111; margin: 32px; font-size: 12px;
  }
  header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 14px; }
  header img { height: 52px; width: auto; object-fit: contain; }
  .brand h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
  .brand .sub { color: #555; font-size: 12px; margin-top: 2px; }
  .report-title { text-align: right; margin-left: auto; }
  .report-title .t { font-size: 13px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
  .report-title .p { font-size: 20px; font-weight: 800; font-family: 'SF Mono', Consolas, monospace; }
  .status { display: inline-block; margin-top: 6px; padding: 3px 12px; border-radius: 999px;
    font-weight: 700; font-size: 11px; color: #fff; background: ${statusColor}; }
  .section { margin-top: 22px; page-break-inside: avoid; }
  .section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid #ddd; padding-bottom: 5px; margin: 0 0 10px; }
  table.kv { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.kv td { padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.kv td.k { width: 150px; color: #666; font-weight: 600; }
  table.kv td.v { font-weight: 500; }
  .desc { white-space: pre-wrap; margin: 0; }
  ul.timeline { list-style: none; margin: 0; padding: 0; }
  ul.timeline li { display: flex; gap: 12px; padding-bottom: 14px; position: relative; }
  ul.timeline li:not(:last-child)::before {
    content: ''; position: absolute; left: 5px; top: 14px; bottom: 0; width: 2px; background: #e2e8f0;
  }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #2563eb; margin-top: 2px; flex-shrink: 0; z-index: 1; }
  .evt-desc { font-weight: 600; }
  .evt-meta { color: #777; font-size: 10.5px; margin-top: 1px; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 6px; }
  table.items th, table.items td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 11px; vertical-align: top; }
  table.items th { background: #f3f4f6; text-transform: uppercase; letter-spacing: 0.03em; font-size: 10px; }
  .insp { margin-bottom: 14px; }
  .insp-head { margin-bottom: 4px; }
  ul.notes { list-style: none; margin: 0; padding: 0; }
  ul.notes li { padding: 8px 0; border-bottom: 1px solid #eee; }
  .note-body { white-space: pre-wrap; }
  .muted { color: #777; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ddd; color: #777; font-size: 10px; display: flex; justify-content: space-between; }
  @media print {
    body { margin: 14mm; }
    @page { size: A4; margin: 12mm; }
    .section { page-break-inside: auto; }
    ul.timeline li, table.items tr, ul.notes li { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <header>
    ${logoUrl ? `<img src="${logoUrl}" alt="logo" onerror="this.style.display='none'" />` : ''}
    <div class="brand">
      <h1>${escapeHtml(company)}</h1>
      <div class="sub">Individual Job Report</div>
    </div>
    <div class="report-title">
      <div class="t">Job</div>
      <div class="p">${escapeHtml(detail.job_number)}</div>
      <div class="status">${escapeHtml(detail.status)}</div>
    </div>
  </header>

  ${detailsTable}
  ${descBlock}
  ${timelineBlock}
  ${inspectionsBlock}
  ${finalBlock}
  ${notesBlock}

  <footer>
    <span>Generated ${escapeHtml(generated)}</span>
    <span>${escapeHtml(company)} · WorkshopIQ</span>
  </footer>
  <script>
    window.onload = function () { window.focus(); window.print(); };
  </script>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) {
      setError('Could not open print window — please allow pop-ups for this site.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  return (
    <Box>
      <Card sx={{ p: { xs: 2, md: 2.5 }, mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select a customer, then a job — print a detailed timeline report. Jobs in
          Machining, Inspection or Closed are available.
        </Typography>

        {loadingJobs ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading jobs…
            </Typography>
          </Stack>
        ) : (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TextField
              select
              label="Customer"
              value={customer}
              onChange={(e) => {
                setCustomer(e.target.value);
                setJobId('');
              }}
              sx={{ minWidth: 240 }}
              disabled={!customers.length}
            >
              {customers.length === 0 ? (
                <MenuItem value="" disabled>
                  No eligible jobs
                </MenuItem>
              ) : (
                customers.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))
              )}
            </TextField>

            <TextField
              select
              label="Job"
              value={jobId === '' ? '' : String(jobId)}
              onChange={(e) => setJobId(Number(e.target.value))}
              sx={{ minWidth: 280 }}
              disabled={!customer}
            >
              {customerJobs.length === 0 ? (
                <MenuItem value="" disabled>
                  {customer ? 'No jobs for this customer' : 'Select a customer first'}
                </MenuItem>
              ) : (
                customerJobs.map((j) => (
                  <MenuItem key={j.id} value={String(j.id)}>
                    {j.job_number} · {j.component_type || j.status} · {fmtDay(j.date_received)}
                  </MenuItem>
                ))
              )}
            </TextField>
          </Stack>
        )}
      </Card>

      {error && (
        <Typography color="error" sx={{ mb: 2 }}>
          {error}
        </Typography>
      )}

      {loadingDetail && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 2 }}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            Loading job…
          </Typography>
        </Stack>
      )}

      {!detail && !loadingDetail && !error && (
        <Card>
          <EmptyState
            icon={<AssignmentOutlinedIcon sx={{ fontSize: 40 }} />}
            title="No job selected"
            subtitle="Choose a customer and job above to see its full report."
          />
        </Card>
      )}

      {detail && !loadingDetail && (
        <Card sx={{ p: { xs: 2, md: 2.5 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={2}
            sx={{ mb: 2 }}
          >
            <Box>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography variant="h6" fontWeight={800}>
                  {detail.job_number}
                </Typography>
                <StatusBadge status={detail.status} />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {detail.customer_name}
                {detail.component_type ? ` · ${detail.component_type}` : ''} · received{' '}
                {fmtDay(detail.date_received)}
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<PrintIcon />} onClick={handlePrint}>
              Print / Save PDF
            </Button>
          </Stack>

          <Divider sx={{ mb: 2 }} />

          {detail.timeline.length === 0 ? (
            <EmptyState
              icon={<TimelineIcon sx={{ fontSize: 48, opacity: 0.4 }} />}
              title="No activity recorded yet"
              subtitle="The report will still include the job details."
            />
          ) : (
            <Stack spacing={0}>
              {detail.timeline.map((ev, idx) => (
                <Stack key={ev.id} direction="row" spacing={2}>
                  <Stack alignItems="center">
                    <Box
                      sx={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        bgcolor: 'primary.main',
                        mt: 0.5,
                      }}
                    />
                    {idx < detail.timeline.length - 1 && (
                      <Box sx={{ width: 2, flexGrow: 1, bgcolor: 'divider', my: 0.5 }} />
                    )}
                  </Stack>
                  <Box sx={{ pb: 3 }}>
                    <Typography fontWeight={600}>{ev.description}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ev.actor_name || 'System'} · {fmtDate(ev.created_at)}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </Card>
      )}
    </Box>
  );
}
