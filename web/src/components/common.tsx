import { ReactNode, useEffect, useState } from 'react';
import { App, Button, Card, Space, Statistic, Tag, Typography } from 'antd';
import { LoginOutlined, LogoutOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errMsg, fmtTime, get, STATUS_COLOR } from '../api';

export function PageHeader({ title, extra }: { title: string; extra?: ReactNode }) {
  return (
    <div className="page-header">
      <h2>{title}</h2>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}

export function StatCard({ title, value, icon, color, suffix }: { title: string; value: ReactNode; icon: ReactNode; color: string; suffix?: ReactNode }) {
  return (
    <Card className="stat-card" bordered={false} style={{ height: '100%' }}>
      <div className="stat-icon" style={{ background: `${color}1a`, color }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>{title}</Typography.Text>
        <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.3 }}>
          {value} {suffix && <span style={{ fontSize: 13, fontWeight: 400, color: '#6b7280' }}>{suffix}</span>}
        </div>
      </div>
    </Card>
  );
}

export const StatusTag = ({ status }: { status: string }) => (
  <Tag color={STATUS_COLOR[status] || 'default'}>{status.replace('_', ' ')}</Tag>
);

/** Live clock with clock-in / clock-out buttons for the logged-in employee. */
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
      message.success(kind === 'in' ? 'Clocked in. Have a great day!' : 'Clocked out. See you tomorrow!');
      qc.invalidateQueries({ queryKey: ['attendance-today'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['attendance-me'] });
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const worked = today?.clockIn ? dayjs(today.clockOut || now).diff(dayjs(today.clockIn), 'minute') : 0;

  return (
    <Card bordered={false} style={{ height: '100%', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff' }}>
      <Typography.Text style={{ color: '#e0e7ff' }}>{now.format('dddd, DD MMM YYYY')}</Typography.Text>
      <div style={{ fontSize: 34, fontWeight: 700, margin: '4px 0 12px' }}>{now.format('hh:mm:ss A')}</div>
      <Space size="large" wrap style={{ marginBottom: 16 }}>
        <Statistic title={<span style={{ color: '#c7d2fe' }}>In</span>} value={fmtTime(today?.clockIn)} valueStyle={{ color: '#fff', fontSize: 16 }} />
        <Statistic title={<span style={{ color: '#c7d2fe' }}>Out</span>} value={fmtTime(today?.clockOut)} valueStyle={{ color: '#fff', fontSize: 16 }} />
        <Statistic title={<span style={{ color: '#c7d2fe' }}>Worked</span>} value={`${Math.floor(worked / 60)}h ${worked % 60}m`} valueStyle={{ color: '#fff', fontSize: 16 }} />
      </Space>
      <div>
        {!today?.clockIn ? (
          <Button size="large" icon={<LoginOutlined />} loading={punch.isPending} onClick={() => punch.mutate('in')}>Clock In</Button>
        ) : !today?.clockOut ? (
          <Button size="large" danger icon={<LogoutOutlined />} loading={punch.isPending} onClick={() => punch.mutate('out')}>Clock Out</Button>
        ) : (
          <Tag color="green" style={{ fontSize: 14, padding: '4px 10px' }}>Day completed ✓</Tag>
        )}
      </div>
    </Card>
  );
}
