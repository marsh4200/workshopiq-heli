import { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Typography,
} from '@mui/material';
import InboxIcon from '@mui/icons-material/MoveToInbox';
import BuildIcon from '@mui/icons-material/Construction';
import CheckCircleIcon from '@mui/icons-material/TaskAlt';
import ArchiveIcon from '@mui/icons-material/Inventory2';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EventIcon from '@mui/icons-material/Event';
import HistoryIcon from '@mui/icons-material/History';
import TrendingFlatIcon from '@mui/icons-material/ArrowOutward';
import { PieChart } from '@mui/x-charts/PieChart';
import { useNavigate } from 'react-router-dom';
import { getDashboard } from '../api/client';
import { STATUS_COLORS, fmtDate, PageHeader } from '../components/common';
import { fontMono } from '../theme/theme';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import type { DashboardStats } from '../types';

const STAT_DEFS = [
  { key: 'received', label: 'Received', icon: <InboxIcon />, color: '#94a3b8', filter: 'Received' },
  { key: 'machining', label: 'Machining', icon: <BuildIcon />, color: '#6366f1', filter: 'Machining' },
  { key: 'completed', label: 'Completed', icon: <CheckCircleIcon />, color: '#22c55e', filter: 'Completed' },
  { key: 'closed', label: 'Closed', icon: <ArchiveIcon />, color: '#64748b', filter: 'Closed' },
] as const;

// Due-date attention tiles. These link to the jobs list with a due lens.
const DUE_DEFS = [
  { key: 'overdue', label: 'Overdue', icon: <WarningAmberIcon />, color: '#ef4444', due: 'overdue' },
  { key: 'due_soon', label: 'Due this week', icon: <EventIcon />, color: '#f59e0b', due: 'soon' },
] as const;

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { settings } = useSettings();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    getDashboard()
      .then(setStats)
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
        <CircularProgress />
      </Box>
    );

  const breakdown = stats?.status_breakdown || {};
  const chartData = Object.entries(breakdown).filter(([, v]) => v > 0);
  const firstName = (user?.full_name || user?.username || '').split(' ')[0];

  return (
    <Box>
      <PageHeader
        eyebrow={settings?.dashboard_branding || 'Operations overview'}
        title={
          user?.role === 'client'
            ? 'Your jobs'
            : `${greeting()}${firstName ? `, ${firstName}` : ''}`
        }
        subtitle={
          user?.role === 'client'
            ? 'Track progress and recent updates on your jobs.'
            : `${stats?.total ?? 0} jobs on the floor · ${settings?.company_name || 'WorkshopIQ'}`
        }
      />

      <Grid container spacing={2.5}>
        {STAT_DEFS.map((d) => {
          const value = stats ? (stats as any)[d.key] : 0;
          return (
            <Grid item xs={6} lg={3} key={d.key}>
              <Card
                sx={{
                  position: 'relative',
                  overflow: 'hidden',
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: d.color,
                    opacity: 0.9,
                  },
                  '&:hover': { borderColor: `${d.color}66`, transform: 'translateY(-2px)' },
                }}
              >
                <CardActionArea onClick={() => navigate(`/jobs?status=${encodeURIComponent(d.filter)}`)}>
                  <CardContent sx={{ py: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, color: 'text.secondary' }}>
                      <Box sx={{ display: 'grid', placeItems: 'center', color: d.color, '& svg': { fontSize: 18 } }}>
                        {d.icon}
                      </Box>
                      <Typography
                        variant="caption"
                        noWrap
                        sx={{ fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 11 }}
                      >
                        {d.label}
                      </Typography>
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontFamily: fontMono, fontWeight: 700, fontSize: 32, lineHeight: 1 }}>
                        {value}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.5 }}>
                        {value === 1 ? '1 job' : `${value} jobs`} · tap to view
                      </Typography>
                    </Box>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}

      </Grid>

      <Grid container spacing={2.5} sx={{ mt: 0 }}>
        {DUE_DEFS.map((d) => {
          const value = stats ? (stats as any)[d.key] : 0;
          const active = value > 0;
          return (
            <Grid item xs={6} lg={3} key={d.key}>
              <Card
                sx={{
                  bgcolor: active ? `${d.color}14` : 'transparent',
                  borderColor: active ? `${d.color}55` : undefined,
                  '&:hover': { borderColor: `${d.color}66` },
                }}
              >
                <CardActionArea onClick={() => navigate(`/jobs?due=${d.due}`)}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.25, '&:last-child': { pb: 1.25 } }}>
                    <Box
                      sx={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        bgcolor: active ? d.color : 'text.disabled',
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{ fontWeight: 600, color: active ? d.color : 'text.secondary' }}
                    >
                      <Box component="span" sx={{ fontFamily: fontMono }}>{value}</Box> {d.label.toLowerCase()}
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
        <Grid item xs={12} lg={7}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 1.5 }}>
                Status overview
              </Typography>
              <Divider sx={{ mb: 1 }} />
              {chartData.length ? (
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: 'center',
                    gap: { xs: 1, sm: 3 },
                    py: 1,
                  }}
                >
                  <Box sx={{ position: 'relative', flexShrink: 0, width: 200, height: 200 }}>
                    <PieChart
                      width={200}
                      height={200}
                      margin={{ top: 4, bottom: 4, left: 4, right: 4 }}
                      series={[
                        {
                          data: chartData.map(([status, count]) => ({
                            id: status,
                            value: count,
                            label: status,
                            color: STATUS_COLORS[status] || '#94a3b8',
                          })),
                          innerRadius: 58,
                          outerRadius: 90,
                          paddingAngle: 1.5,
                          cornerRadius: 3,
                          highlightScope: { fade: 'global', highlight: 'item' },
                        },
                      ]}
                      slotProps={{ legend: { hidden: true } }}
                      onItemClick={(_e, item) => {
                        const status = chartData[item.dataIndex]?.[0];
                        if (status) navigate(`/jobs?status=${encodeURIComponent(status)}`);
                      }}
                      sx={{ cursor: 'pointer' }}
                    />
                    <Box
                      sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <Typography sx={{ fontFamily: fontMono, fontWeight: 700, fontSize: 28, lineHeight: 1 }}>
                        {stats?.total ?? 0}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
                        {stats?.total === 1 ? 'job' : 'jobs'}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
                    {chartData.map(([status, count]) => {
                      const color = STATUS_COLORS[status] || '#94a3b8';
                      const pct = stats?.total ? Math.round((count / stats.total) * 100) : 0;
                      return (
                        <Box
                          key={status}
                          onClick={() => navigate(`/jobs?status=${encodeURIComponent(status)}`)}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.25,
                            py: 0.7,
                            px: 0.75,
                            mx: -0.75,
                            borderRadius: 1.5,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: `${color}14` },
                          }}
                        >
                          <Box
                            sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: color, flexShrink: 0 }}
                          />
                          <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                            {status}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: fontMono, flexShrink: 0 }}
                          >
                            {pct}%
                          </Typography>
                          <Typography
                            sx={{ fontFamily: fontMono, fontWeight: 700, fontSize: 14, width: 22, textAlign: 'right', flexShrink: 0 }}
                          >
                            {count}
                          </Typography>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                  No jobs yet. Create one to see status analytics.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <HistoryIcon fontSize="small" color="primary" />
                <Typography variant="h6">Recent activity</Typography>
              </Box>
              <Divider sx={{ mb: 0.5 }} />
              {stats?.recent_activity.length ? (
                <Box>
                  {stats.recent_activity.map((e) => (
                    <Box
                      key={e.id}
                      onClick={e.job_id ? () => navigate(`/jobs/${e.job_id}`) : undefined}
                      sx={{
                        display: 'flex',
                        gap: 1.5,
                        py: 1.25,
                        borderBottom: '1px solid rgba(148,163,184,0.08)',
                        '&:last-of-type': { borderBottom: 'none' },
                        ...(e.job_id
                          ? {
                              cursor: 'pointer',
                              borderRadius: 1,
                              px: 1,
                              mx: -1,
                              '&:hover': { bgcolor: 'rgba(148,163,184,0.08)' },
                            }
                          : {}),
                      }}
                    >
                      <Box sx={{ width: 7, height: 7, borderRadius: 4, bgcolor: 'primary.main', mt: 0.9, flexShrink: 0 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.25 }}>
                          {e.job_number && (
                            <Chip
                              label={e.job_number}
                              size="small"
                              sx={{ height: 20, fontFamily: fontMono, fontWeight: 600, '& .MuiChip-label': { px: 0.75 } }}
                            />
                          )}
                          {e.customer_name && (
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                              {e.customer_name}
                            </Typography>
                          )}
                        </Box>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {e.description}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {e.actor_name ? `${e.actor_name} · ` : ''}
                          {fmtDate(e.created_at)}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              ) : (
                <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                  <TrendingFlatIcon sx={{ opacity: 0.4 }} />
                  <Typography variant="body2">No activity recorded yet.</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
