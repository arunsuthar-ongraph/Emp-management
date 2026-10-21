import { useNavigate } from 'react-router-dom';
import { Button, Card, Col, Empty, List, Progress, Row, Space, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  TeamOutlined,
  UserAddOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { fmtDate, get, money, monthName } from '../api';
import { useAuth } from '../auth';
import { ClockWidget, PageHeader, StatCard } from '../components/common';

const COLORS = ['#4f46e5', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

export default function Dashboard() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/dashboard') });
  const c = data?.company;
  const me = data?.me;
  const hour = dayjs().hour();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greet}, ${user?.employee?.name.split(' ')[0] || ''} 👋`}
        extra={can('leave.apply') && <Button type="primary" icon={<CalendarOutlined />} onClick={() => navigate('/leave')}>Apply Leave</Button>}
      />

      {/* Company-wide KPIs */}
      {c && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} lg={6}><StatCard title="Active Employees" value={c.headcount} icon={<TeamOutlined />} color="#4f46e5" suffix={c.newJoiners ? `+${c.newJoiners} this month` : ''} /></Col>
          <Col xs={12} lg={6}><StatCard title="Present Today" value={c.presentToday} icon={<CheckCircleOutlined />} color="#10b981" suffix={`/ ${c.headcount}`} /></Col>
          <Col xs={12} lg={6}><StatCard title="On Leave Today" value={c.onLeaveToday} icon={<CalendarOutlined />} color="#f59e0b" /></Col>
          <Col xs={12} lg={6}><StatCard title="Pending Leave Requests" value={c.pendingLeaves} icon={<ClockCircleOutlined />} color="#ef4444" /></Col>
        </Row>
      )}

      {/* Manager KPIs */}
      {data?.team && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} lg={6}><StatCard title="My Team" value={data.team.size} icon={<TeamOutlined />} color="#4f46e5" /></Col>
          <Col xs={12} lg={6}><StatCard title="Team Present Today" value={data.team.present} icon={<CheckCircleOutlined />} color="#10b981" /></Col>
          <Col xs={12} lg={6}><StatCard title="Team On Leave" value={data.team.onLeave} icon={<CalendarOutlined />} color="#f59e0b" /></Col>
          <Col xs={12} lg={6}><StatCard title="Awaiting My Approval" value={data.pendingApprovals} icon={<ClockCircleOutlined />} color="#ef4444" /></Col>
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
            <Card title="My Leave Balance" bordered={false} style={{ height: '100%' }} loading={isLoading}
              extra={me.myPending > 0 && <Tag color="orange">{me.myPending} pending</Tag>}>
              {me.balances.map((b: any, i: number) => (
                <div key={b.code} style={{ marginBottom: 12 }}>
                  <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Typography.Text>{b.name}</Typography.Text>
                    <Typography.Text strong>{b.available} / {b.allocated}</Typography.Text>
                  </Space>
                  <Progress percent={b.allocated ? (b.available / b.allocated) * 100 : 0} showInfo={false} strokeColor={COLORS[i % COLORS.length]} size="small" />
                </div>
              ))}
            </Card>
          </Col>
        )}

        {me && (
          <Col xs={24} lg={8}>
            <Card title="Last Payslip" bordered={false} style={{ height: '100%' }} extra={<a onClick={() => navigate('/payslips')}>View all</a>}>
              {me.lastPayslip ? (
                <>
                  <Typography.Text type="secondary">{monthName(me.lastPayslip.payrollRun.month, me.lastPayslip.payrollRun.year)}</Typography.Text>
                  <div style={{ fontSize: 30, fontWeight: 700, color: '#10b981' }}>{money(me.lastPayslip.net)}</div>
                  <Typography.Text type="secondary">Net pay · Gross {money(me.lastPayslip.gross)}</Typography.Text>
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
            <Card title="Attendance – last 7 working days" bordered={false}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={c.attendanceWeek.map((d: any) => ({ ...d, day: dayjs(d.date).format('ddd DD') }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" />
                  <YAxis allowDecimals={false} domain={[0, c.headcount]} />
                  <Tooltip />
                  <Bar dataKey="present" name="Present" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        )}

        {c && (
          <Col xs={24} lg={8}>
            <Card title="Headcount by Department" bordered={false} style={{ height: '100%' }}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={c.departments} dataKey="count" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
                    {c.departments.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Card>
          </Col>
        )}

        {c?.payrollTrend && (
          <Col xs={24} lg={16}>
            <Card title="Payroll Cost Trend" bordered={false} extra={<a onClick={() => navigate('/payroll')}>Go to payroll</a>}>
              {c.payrollTrend.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={c.payrollTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`} />
                    <Tooltip formatter={(v: number) => money(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="gross" name="Gross" stroke="#4f46e5" strokeWidth={2} />
                    <Line type="monotone" dataKey="net" name="Net" stroke="#10b981" strokeWidth={2} />
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
            <Card title="Leave Taken This Year" bordered={false} style={{ height: '100%' }}>
              {c.leaveByType.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={c.leaveByType} layout="vertical">
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="type" width={50} />
                    <Tooltip />
                    <Bar dataKey="days" name="Days" fill="#06b6d4" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Card>
          </Col>
        )}

        {c && (
          <Col xs={24} lg={12}>
            <Card title="Recent Leave Requests" bordered={false} extra={<a onClick={() => navigate('/leave')}>Review</a>}>
              <List
                dataSource={c.recentRequests}
                locale={{ emptyText: 'No pending requests 🎉' }}
                renderItem={(r: any) => (
                  <List.Item extra={<Tag color="orange">{Number(r.days)} day(s)</Tag>}>
                    <List.Item.Meta
                      avatar={<UserAddOutlined style={{ fontSize: 18, color: '#4f46e5' }} />}
                      title={`${r.employee.firstName} ${r.employee.lastName} · ${r.leaveType.code}`}
                      description={`${fmtDate(r.fromDate)} → ${fmtDate(r.toDate)}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        )}

        <Col xs={24} lg={c ? 12 : 24}>
          <Card title="Upcoming Holidays" bordered={false} extra={<a onClick={() => navigate('/holidays')}>All holidays</a>}>
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
