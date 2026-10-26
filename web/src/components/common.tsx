import { ReactNode, useEffect, useState } from 'react';
import { App, Button, Space, Tag, Typography } from 'antd';
import { LoginOutlined, LogoutOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errMsg, fmtTime, get, STATUS_COLOR } from '../api';

export function PageHeader({ title, subtitle, extra }: { title: string; subtitle?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}

/** Quiet stat tile: label (with a muted icon), the number, an optional hint. `attention` marks something to act on. */
export function StatCard({ title, value, icon, suffix, attention }: { title: string; value: ReactNode; icon?: ReactNode; color?: string; suffix?: ReactNode; attention?: boolean }) {
  return (
    <div className={`stat${attention ? ' is-attention' : ''}`}>
      <div className="stat-label">{icon}{title}</div>
      <div className="stat-value">{value}</div>
      {suffix ? <div className="stat-hint">{suffix}</div> : null}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', DRAFT: 'Draft', FINALIZED: 'Finalized',
  ACTIVE: 'Active', INACTIVE: 'Exited', PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave',
  UNPAID_LEAVE: 'Unpaid leave', HOLIDAY: 'Holiday', WEEKEND: 'Weekend', NOT_MARKED: 'Not checked in', NOT_EMPLOYED: 'Not employed',
};

export const StatusTag = ({ status }: { status: string }) => (
  <Tag color={STATUS_COLOR[status] || 'default'} bordered={false}>{STATUS_TEXT[status] || status}</Tag>
);

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * Today's time card: live clock, check in / check out, and a strip of today's sessions
 * across the working day (8 AM–8 PM, widened if sessions fall outside).
 */
export function ClockWidget() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [now, setNow] = useState(dayjs());
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: today } = useQuery({ queryKey: ['attendance-today'], queryFn: () => get('/attendance/today') });
  const punch = useMutation({
    mutationFn: (kind: 'in' | 'out') => api.post(`/attendance/clock-${kind}`),
    onSuccess: (_, kind) => {
      message.success(kind === 'in' ? 'Checked in' : 'Checked out. You can check in again any time.');
      qc.invalidateQueries({ queryKey: ['attendance-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['attendance-me'] });
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const isIn = !!today?.isIn;
  const running = isIn ? now.diff(dayjs(today.openSession.clockIn), 'minute') : 0;
  const worked = (today?.workMinutes || 0) + running;
  const sessions: any[] = today?.sessions || [];

  // Strip scale in minutes after midnight
  const dayStart = now.startOf('day');
  const mins = (d: string | dayjs.Dayjs) => dayjs(d).diff(dayStart, 'minute');
  const segs = sessions.map((s) => ({ from: mins(s.clockIn), to: s.clockOut ? mins(s.clockOut) : mins(now), open: !s.clockOut }));
  const lo = Math.min(8 * 60, ...segs.map((s) => Math.floor(s.from / 60) * 60));
  const hi = Math.max(20 * 60, ...segs.map((s) => Math.ceil(s.to / 60) * 60), Math.ceil(mins(now) / 60) * 60);
  const pct = (m: number) => `${((Math.min(Math.max(m, lo), hi) - lo) / (hi - lo)) * 100}%`;
  const hourLabel = (m: number) => dayStart.add(m, 'minute').format('h A');

  return (
    <section className="timecard" aria-label="Today's attendance">
      <Space style={{ justifyContent: 'space-between', width: '100%' }} align="start">
        <div>
          <Typography.Text type="secondary">{now.format('dddd, D MMMM')}</Typography.Text>
          <div className="timecard-clock" style={{ marginTop: 6 }}>{now.format('h:mm')}<span style={{ fontSize: 16, marginLeft: 6, color: 'var(--ink-3)' }}>{now.format('ss A')}</span></div>
        </div>
        <Tag color={isIn ? 'success' : 'default'} bordered={false} style={{ marginInlineEnd: 0 }}>{isIn ? 'Checked in' : sessions.length ? 'Checked out' : 'Not checked in'}</Tag>
      </Space>

      <div>
        <div className="timecard-strip" role="img" aria-label={`Today's sessions: ${sessions.length}`}>
          {segs.map((s, i) => (
            <span key={i} className={`seg${s.open ? ' open' : ''}`} style={{ left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})` }} />
          ))}
          <span className="now" style={{ left: pct(mins(now)) }} />
        </div>
        <div className="timecard-scale">
          <span>{hourLabel(lo)}</span>
          <span>{hourLabel((lo + hi) / 2)}</span>
          <span>{hourLabel(hi)}</span>
        </div>
      </div>

      <div className="timecard-facts">
        <div><span>First in</span><b>{fmtTime(today?.clockIn)}</b></div>
        <div><span>Last out</span><b>{isIn ? '—' : fmtTime(today?.clockOut)}</b></div>
        <div><span>Worked</span><b>{hm(worked)}</b></div>
        <div><span>Sessions</span><b>{sessions.length}</b></div>
      </div>

      {isIn ? (
        <Button size="large" block icon={<LogoutOutlined />} loading={punch.isPending} onClick={() => punch.mutate('out')}>
          Check out · {hm(running)} this session
        </Button>
      ) : (
        <Button size="large" block type="primary" icon={<LoginOutlined />} loading={punch.isPending} onClick={() => punch.mutate('in')}>
          {sessions.length ? 'Check in again' : 'Check in'}
        </Button>
      )}
    </section>
  );
}
