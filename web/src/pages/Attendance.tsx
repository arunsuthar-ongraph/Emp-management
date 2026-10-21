import { useState } from 'react';
import { App, Card, Col, DatePicker, Row, Select, Statistic, Table, Tabs, Tag } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { api, errMsg, fmtTime, get } from '../api';
import { useAuth } from '../auth';
import { ClockWidget, PageHeader, StatusTag } from '../components/common';

const hrs = (m?: number) => (m ? `${Math.floor(m / 60)}h ${m % 60}m` : '—');

function MyAttendance() {
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const { data, isLoading } = useQuery({
    queryKey: ['attendance-me', month.format('YYYY-MM')],
    queryFn: () => get('/attendance/me', { year: month.year(), month: month.month() + 1 }),
  });

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={8}><ClockWidget /></Col>
        <Col xs={24} lg={16}>
          <Card bordered={false} style={{ height: '100%' }} title={`Summary – ${month.format('MMMM YYYY')}`}
            extra={<DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v)} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />}>
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={8}><Statistic title="Working days" value={data?.workingDays ?? 0} /></Col>
              <Col xs={12} sm={8}><Statistic title="Present" value={data?.present ?? 0} valueStyle={{ color: '#10b981' }} /></Col>
              <Col xs={12} sm={8}><Statistic title="Half days" value={data?.halfDays ?? 0} valueStyle={{ color: '#f59e0b' }} /></Col>
              <Col xs={12} sm={8}><Statistic title="Paid leave" value={data?.paidLeave ?? 0} valueStyle={{ color: '#4f46e5' }} /></Col>
              <Col xs={12} sm={8}><Statistic title="Absent" value={data?.absent ?? 0} valueStyle={{ color: '#ef4444' }} /></Col>
              <Col xs={12} sm={8}><Statistic title="Loss of pay days" value={data?.lopDays ?? 0} valueStyle={{ color: '#ef4444' }} /></Col>
            </Row>
          </Card>
        </Col>
      </Row>
      <Card bordered={false}>
        <Table
          rowKey="date"
          loading={isLoading}
          dataSource={data?.days || []}
          pagination={false}
          size="small"
          scroll={{ x: 600 }}
          columns={[
            { title: 'Date', dataIndex: 'date', render: (d) => dayjs(d).format('DD MMM, ddd') },
            { title: 'Status', dataIndex: 'type', render: (t, r: any) => <><StatusTag status={t} />{r.note && <Tag>{r.note}</Tag>}</> },
            { title: 'In', dataIndex: 'clockIn', render: fmtTime },
            { title: 'Out', dataIndex: 'clockOut', render: fmtTime },
            { title: 'Worked', dataIndex: 'workMinutes', render: hrs },
          ]}
        />
      </Card>
    </>
  );
}

function DailyAttendance() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [date, setDate] = useState<Dayjs>(dayjs());
  const key = ['attendance-daily', date.format('YYYY-MM-DD')];
  const { data = [], isLoading } = useQuery({ queryKey: key, queryFn: () => get('/attendance/daily', { date: date.format('YYYY-MM-DD') }) });
  const canMark = can('attendance.all');

  const mark = useMutation({
    mutationFn: (v: { employeeId: string; status: string }) => api.post('/attendance/mark', { ...v, date: date.format('YYYY-MM-DD') }),
    onSuccess: () => {
      message.success('Attendance updated');
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const present = data.filter((r: any) => r.attendance).length;
  const onLeave = data.filter((r: any) => r.leave).length;

  return (
    <Card
      bordered={false}
      title={
        <span>
          {date.format('dddd, DD MMM YYYY')} &nbsp;
          <Tag color="green">{present} present</Tag>
          <Tag color="blue">{onLeave} on leave</Tag>
          <Tag color="red">{Math.max(0, data.length - present - onLeave)} not marked</Tag>
        </span>
      }
      extra={<DatePicker value={date} onChange={(v) => v && setDate(v)} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />}
    >
      <Table
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data}
        scroll={{ x: 800 }}
        columns={[
          { title: 'Employee', render: (_, r: any) => `${r.name} (${r.code})` },
          { title: 'Department', dataIndex: 'department', render: (d) => d || '—' },
          {
            title: 'Status',
            render: (_, r: any) =>
              r.leave ? <Tag color="blue">On leave · {r.leave.type}</Tag> : r.attendance ? <StatusTag status={r.attendance.status} /> : <Tag color="red">Not marked</Tag>,
          },
          { title: 'In', render: (_, r: any) => fmtTime(r.attendance?.clockIn) },
          { title: 'Out', render: (_, r: any) => fmtTime(r.attendance?.clockOut) },
          { title: 'Worked', render: (_, r: any) => hrs(r.attendance?.workMinutes) },
          ...(canMark
            ? [{
                title: 'Correct',
                render: (_: any, r: any) => (
                  <Select<string> size="small" placeholder="Mark as" style={{ width: 120 }} value={undefined}
                    onChange={(status) => mark.mutate({ employeeId: r.employeeId, status })}
                    options={['PRESENT', 'HALF_DAY', 'ABSENT'].map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
                ),
              }]
            : []),
        ]}
      />
    </Card>
  );
}

export default function Attendance() {
  const { can, user } = useAuth();
  return (
    <>
      <PageHeader title="Attendance" />
      <Tabs
        destroyInactiveTabPane
        items={[
          { key: 'me', label: 'My Attendance', children: <MyAttendance /> },
          ...(user?.isLead || can('attendance.all') ? [{ key: 'daily', label: can('attendance.all') ? 'Company Attendance' : 'Team Attendance', children: <DailyAttendance /> }] : []),
        ]}
      />
    </>
  );
}
