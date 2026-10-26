import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Empty, List, Progress, Row, Space, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  TeamOutlined,
  UserAddOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { fmtDate, get, money, monthName } from '../api';
import { useAuth } from '../auth';
import { ClockWidget, PageHeader, StatCard } from '../components/common';
import { usePalette } from '../theme';


export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/dashboard') });
  const c = data?.company;
  const me = data?.me;
  const hour = dayjs().hour();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const p = usePalette();
  // Company admins: remind them to finish company details after signing up
  const { data: company } = useQuery({ queryKey: ['company'], queryFn: () => get('/settings/company'), enabled: can('settings.write') });
  const setupPending = !!company && (!company.address || !company.pan);
  // Recharts styling for the current theme: recessive grid/axes, text in ink colors
  const axis = { stroke: p.border, tick: { fill: p.chartAxis, fontSize: 12 }, tickLine: false };
  const grid = { stroke: p.chartGrid, vertical: false };
  const tip = {
    contentStyle: { background: p.surface, border: `1px solid ${p.border}`, borderRadius: 8, color: p.ink, boxShadow: 'none' },
    labelStyle: { color: p.ink, fontWeight: 600 },
    itemStyle: { color: p.ink },
    cursor: { fill: p.raised },
  };
  const legend = { formatter: (v: string) => <span style={{ color: p.inkSecondary }}>{v}</span> };

  return (
    <>
      <PageHeader
        title={`${greet}, ${user?.employee?.name.split(' ')[0] || ''}`}
        subtitle={dayjs().format('dddd, D MMMM YYYY')}
        extra={can('leave.apply') && <Button type="primary" icon={<CalendarOutlined />} onClick={() => navigate('/leave')}>Apply for leave</Button>}
      />
      {setupPending && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Finish setting up your company"
          description="Add your registered address and PAN. They appear on payslips and are needed for statutory reports."
          action={<Button size="small" onClick={() => navigate('/settings')}>Open company settings</Button>}
        />
      )}

      {/* Company-wide KPIs */}
      {c && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} lg={6}><StatCard title="Active employees" value={c.headcount} icon={<TeamOutlined />} suffix={c.newJoiners ? `+${c.newJoiners} this month` : ''} /></Col>
          <Col xs={12} lg={6}><StatCard title="Present today" value={c.presentToday} icon={<CheckCircleOutlined />} suffix={`of ${c.headcount} employees`} /></Col>
          <Col xs={12} lg={6}><StatCard title="On leave today" value={c.onLeaveToday} icon={<CalendarOutlined />} /></Col>
          <Col xs={12} lg={6}><StatCard title="Leave requests pending" value={c.pendingLeaves} icon={<ClockCircleOutlined />} attention={c.pendingLeaves > 0} suffix={c.pendingLeaves > 0 ? 'Waiting for approval' : 'All caught up'} /></Col>
        </Row>
      )}

      {/* Manager KPIs */}
      {data?.team && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} lg={6}><StatCard title="My team" value={data.team.size} icon={<TeamOutlined />} /></Col>
          <Col xs={12} lg={6}><StatCard title="Team present today" value={data.team.present} icon={<CheckCircleOutlined />} /></Col>
          <Col xs={12} lg={6}><StatCard title="Team on leave" value={data.team.onLeave} icon={<CalendarOutlined />} /></Col>
          <Col xs={12} lg={6}><StatCard title="Awaiting my approval" value={data.pendingApprovals} icon={<ClockCircleOutlined />} attention={data.pendingApprovals > 0} /></Col>
        </Row>
      )}

      <Row gutter={[16, 16]}>
        {me && (
          <Col xs={24} lg={8}>
            <ClockWidget />
          </Col>
        )}

        {me && (
          <Col xs={24} lg={8}>
            <Card title="My leave balance" style={{ height: '100%' }} loading={isLoading}
              extra={me.myPending > 0 && <Tag color="orange">{me.myPending} pending</Tag>}>
              {me.balances.map((b: any) => (
                <div key={b.code} style={{ marginBottom: 12 }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Typography.Text>{b.name}</Typography.Text>
                    <Typography.Text strong>{b.available} / {b.allocated}</Typography.Text>
                  </Space>
                  <Progress percent={b.allocated ? (b.available / b.allocated) * 100 : 0} showInfo={false} strokeColor={p.brand} trailColor={p.raised} size="small" />
                </div>
              ))}
            </Card>
          </Col>
        )}

        {me && (
          <Col xs={24} lg={8}>
            <Card title="Last payslip" style={{ height: '100%' }} extra={<a onClick={() => navigate('/payslips')}>View all</a>}>
              {me.lastPayslip ? (
                <>
                  <Typography.Text type="secondary">{monthName(me.lastPayslip.payrollRun.month, me.lastPayslip.payrollRun.year)}</Typography.Text>
                  <div style={{ fontSize: 30, fontWeight: 600, color: 'var(--ink)', margin: '4px 0' }}>{money(me.lastPayslip.net)}</div>
                  <Typography.Text type="secondary">Net pay, from gross {money(me.lastPayslip.gross)}</Typography.Text>
                  <div style={{ marginTop: 12 }}>
                    <Tag icon={<WalletOutlined />}>Paid days {Number(me.lastPayslip.paidDays)}</Tag>
                    {Number(me.lastPayslip.lopDays) > 0 && <Tag color="volcano">LOP {Number(me.lastPayslip.lopDays)}</Tag>}
                  </div>
                </>
              ) : (
                <Empty description="No payslips yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        )}

        {c && (
          <Col xs={24} lg={16}>
            <Card title="Attendance, last 7 working days">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={c.attendanceWeek.map((d: any) => ({ ...d, day: dayjs(d.date).format('ddd DD') }))}>
                  <CartesianGrid {...grid} />
                  <XAxis dataKey="day" {...axis} />
                  <YAxis allowDecimals={false} domain={[0, c.headcount]} {...axis} width={32} />
                  <Tooltip {...tip} />
                  <Bar dataKey="present" name="Present" fill={p.chartFull} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        )}

        {c && (
          <Col xs={24} lg={8}>
            <Card title="Headcount by department" style={{ height: '100%' }}>
              {/* Many departments: sorted bars read better than a donut and never repeat colors */}
              {!c.departments.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Assign employees to departments to see this" /> : <ResponsiveContainer width="100%" height={Math.max(160, c.departments.length * 30)}>
                <BarChart data={[...c.departments].sort((a: any, b: any) => b.count - a.count)} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <XAxis type="number" allowDecimals={false} {...axis} />
                  <YAxis type="category" dataKey="name" width={112} {...axis} />
                  <Tooltip {...tip} />
                  <Bar dataKey="count" name="Employees" fill={p.chartFull} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>}
            </Card>
          </Col>
        )}

        {c?.payrollTrend && (
          <Col xs={24} lg={16}>
            <Card title="Payroll cost trend" extra={<a onClick={() => navigate('/payroll')}>Go to payroll</a>}>
              {c.payrollTrend.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={c.payrollTrend}>
                    <CartesianGrid {...grid} />
                    <XAxis dataKey="label" {...axis} />
                    <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} {...axis} width={56} />
                    <Tooltip formatter={(v: number) => money(v)} {...tip} cursor={{ stroke: p.borderStrong }} />
                    <Legend {...legend} />
                    <Line type="monotone" dataKey="gross" name="Gross" stroke={p.series[0]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: p.surface }} />
                    <Line type="monotone" dataKey="net" name="Net" stroke={p.series[1]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: p.surface }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Empty description="Run your first payroll to see trends" />
              )}
            </Card>
          </Col>
        )}

        {c && (
          <Col xs={24} lg={8}>
            <Card title="Leave taken this year" style={{ height: '100%' }}>
              {c.leaveByType.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={c.leaveByType} layout="vertical">
                    <XAxis type="number" allowDecimals={false} {...axis} />
                    <YAxis type="category" dataKey="type" width={50} {...axis} />
                    <Tooltip {...tip} />
                    <Bar dataKey="days" name="Days" fill={p.chartFull} radius={[0, 4, 4, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        )}

        {c && (
          <Col xs={24} lg={8}>
            <Card title="Recent leave requests" extra={<a onClick={() => navigate('/leave')}>Review</a>}>
              <List
                dataSource={c.recentRequests}
                locale={{ emptyText: 'No pending requests 🎉' }}
                renderItem={(r: any) => (
                  <List.Item extra={<Tag color="orange">{Number(r.days)} day(s)</Tag>}>
                    <List.Item.Meta
                      avatar={<UserAddOutlined style={{ fontSize: 18, color: 'var(--brand)' }} />}
                      title={`${r.employee.firstName} ${r.employee.lastName} · ${r.leaveType.code}`}
                      description={`${fmtDate(r.fromDate)} → ${fmtDate(r.toDate)}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        )}

        <Col xs={24} lg={c ? 8 : 24}>
          <Card title="Upcoming holidays" extra={<a onClick={() => navigate('/holidays')}>All holidays</a>}>
            <List
              dataSource={data?.upcomingHolidays || []}
              locale={{ emptyText: 'No upcoming holidays' }}
              renderItem={(h: any) => (
                <List.Item extra={<Tag color="purple">{dayjs(h.date).format('ddd')}</Tag>}>
                  <List.Item.Meta title={h.name} description={fmtDate(h.date)} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
