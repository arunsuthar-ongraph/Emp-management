import { useState } from 'react';
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Drawer, Empty, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Table, Tabs, Typography } from 'antd';
import { CalculatorOutlined, CheckOutlined, DeleteOutlined, DownloadOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { Dayjs } from 'dayjs';
import { api, errMsg, fmtDate, get, money, monthName } from '../api';
import { PageHeader, StatusTag } from '../components/common';
import PayslipView from '../components/PayslipView';

function downloadRegister(run: any) {
  const heads = new Set<string>();
  run.payslips.forEach((p: any) => [...p.earnings, ...p.deductions].forEach((l: any) => heads.add(l.name)));
  const cols = [...heads];
  const lines = [
    ['Code', 'Name', 'Department', 'Paid Days', 'LOP', ...cols, 'Gross', 'Deductions', 'Net'].join(','),
    ...run.payslips.map((p: any) => {
      const amt = (n: string) => [...p.earnings, ...p.deductions].find((l: any) => l.name === n)?.amount ?? 0;
      return [p.employee.code, `"${p.employee.firstName} ${p.employee.lastName}"`, `"${p.employee.department?.name || ''}"`,
        Number(p.paidDays), Number(p.lopDays), ...cols.map(amt), Number(p.gross), Number(p.totalDeductions), Number(p.net)].join(',');
    }),
  ];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
  a.download = `salary-register-${run.year}-${String(run.month).padStart(2, '0')}.csv`;
  a.click();
}

function RunDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [slip, setSlip] = useState<string | null>(null);
  const { data: run, isLoading } = useQuery({ queryKey: ['payroll-run', id], queryFn: () => get(`/payroll/runs/${id}`), enabled: !!id });

  const act = useMutation({
    mutationFn: (action: 'compute' | 'finalize' | 'delete') =>
      action === 'delete' ? api.delete(`/payroll/runs/${id}`) : api.post(`/payroll/runs/${id}/${action}`),
    onSuccess: (_, action) => {
      message.success({ compute: 'Payroll recalculated', finalize: 'Payroll finalized – payslips published', delete: 'Draft deleted' }[action]);
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (action === 'delete') onClose();
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const draft = run?.status === 'DRAFT';

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      width={Math.min(1000, window.innerWidth)}
      loading={isLoading}
      title={run && <Space>{monthName(run.month, run.year)} Payroll <StatusTag status={run.status} /></Space>}
      extra={
        run && (
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => downloadRegister(run)}>Salary register</Button>
            {draft && (
              <>
                <Popconfirm title="Delete this draft?" onConfirm={() => act.mutate('delete')}><Button danger icon={<DeleteOutlined />} /></Popconfirm>
                <Button icon={<ReloadOutlined />} loading={act.isPending && act.variables === 'compute'} onClick={() => act.mutate('compute')}>Recalculate</Button>
                <Popconfirm title="Finalize payroll?" description="Payslips will be published to employees and the run locked." onConfirm={() => act.mutate('finalize')}>
                  <Button type="primary" icon={<CheckOutlined />}>Finalize</Button>
                </Popconfirm>
              </>
            )}
          </Space>
        )
      }
    >
      {run && (
        <>
          {draft && <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Draft payroll. Fix attendance or leave if needed, then Recalculate. Finalize to publish payslips." />}
          {!draft && <Alert type="success" showIcon style={{ marginBottom: 16 }} message={`Finalized on ${fmtDate(run.finalizedAt)}. Payslips are visible to employees.`} />}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Employees" value={run.employeeCount} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Gross" value={money(run.totalGross)} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Deductions" value={money(run.totalDeductions)} valueStyle={{ color: '#ef4444' }} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Net payable" value={money(run.totalNet)} valueStyle={{ color: '#10b981' }} /></Card></Col>
          </Row>
          <Table
            rowKey="id"
            size="small"
            dataSource={run.payslips}
            scroll={{ x: 800 }}
            pagination={false}
            onRow={(p: any) => ({ onClick: () => setSlip(p.id), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Employee', render: (_, p: any) => `${p.employee.firstName} ${p.employee.lastName} (${p.employee.code})` },
              { title: 'Paid days', dataIndex: 'paidDays', render: Number },
              { title: 'LOP', dataIndex: 'lopDays', render: (v) => (Number(v) ? <Typography.Text type="danger">{Number(v)}</Typography.Text> : 0) },
              { title: 'Gross', dataIndex: 'gross', render: money, align: 'right' },
              { title: 'PF', render: (_, p: any) => money(p.deductions.find((d: any) => d.name === 'Provident Fund')?.amount), align: 'right' },
              { title: 'TDS', render: (_, p: any) => money(p.deductions.find((d: any) => d.name === 'Income Tax (TDS)')?.amount), align: 'right' },
              { title: 'Deductions', dataIndex: 'totalDeductions', render: money, align: 'right' },
              { title: 'Net', dataIndex: 'net', render: (v) => <b>{money(v)}</b>, align: 'right' },
            ]}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Click a row to view the payslip.</Typography.Text>
        </>
      )}
      <PayslipView id={slip} onClose={() => setSlip(null)} />
    </Drawer>
  );
}

function Runs() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [view, setView] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['payroll-runs'], queryFn: () => get('/payroll/runs') });

  const create = useMutation({
    mutationFn: () => api.post('/payroll/runs', { month: month.month() + 1, year: month.year() }),
    onSuccess: (r) => {
      message.success('Payroll calculated as draft');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      setOpen(false);
      setView(r.data.id);
    },
    onError: (e) => message.error(errMsg(e)),
  });

  return (
    <Card bordered={false} extra={<Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setOpen(true)}>Run Payroll</Button>}>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        scroll={{ x: 800 }}
        locale={{ emptyText: <Empty description="No payroll runs yet" /> }}
        onRow={(r: any) => ({ onClick: () => setView(r.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Month', render: (_, r: any) => <b>{monthName(r.month, r.year)}</b> },
          { title: 'Status', dataIndex: 'status', render: (s) => <StatusTag status={s} /> },
          { title: 'Employees', dataIndex: 'employeeCount' },
          { title: 'Gross', dataIndex: 'totalGross', render: money, align: 'right' },
          { title: 'Deductions', dataIndex: 'totalDeductions', render: money, align: 'right' },
          { title: 'Net payable', dataIndex: 'totalNet', render: (v) => <b>{money(v)}</b>, align: 'right' },
          { title: 'Employer cost (PF/ESI)', dataIndex: 'totalEmployer', render: money, align: 'right' },
        ]}
      />
      <Modal title="Run Payroll" open={open} onCancel={() => setOpen(false)} onOk={() => create.mutate()} okText="Calculate" confirmLoading={create.isPending}>
        <Typography.Paragraph type="secondary">
          Salaries are calculated from each employee's CTC, prorated by paid days (attendance + leave). PF, ESI, Professional Tax and TDS (new regime) are applied.
        </Typography.Paragraph>
        <DatePicker picker="month" value={month} onChange={(v) => v && setMonth(v)} allowClear={false} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'month')} />
      </Modal>
      <RunDrawer id={view} onClose={() => setView(null)} />
    </Card>
  );
}

function Calculator() {
  const [ctc, setCtc] = useState<number>(600000);
  const [state, setState] = useState('MH');
  const { data: states = [] } = useQuery({ queryKey: ['states'], queryFn: () => get('/payroll/states') });
  const { data } = useQuery({
    queryKey: ['calc', ctc, state],
    queryFn: () => api.post('/payroll/calculator', { ctcAnnual: ctc || 0, state }).then((r) => r.data),
  });
  const s = data?.structure;
  const p = data?.payslip;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8}>
        <Card bordered={false} title={<><CalculatorOutlined /> CTC Calculator</>}>
          <Typography.Text>Annual CTC (₹)</Typography.Text>
          <InputNumber style={{ width: '100%', margin: '6px 0 16px' }} size="large" min={0} step={50000} value={ctc} onChange={(v) => setCtc(Number(v) || 0)}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
          <Typography.Text>Work state (Professional Tax)</Typography.Text>
          <Select style={{ width: '100%', marginTop: 6 }} value={state} onChange={setState} options={states.map((x: any) => ({ value: x.code, label: x.name }))} />
          {p && (
            <Card size="small" style={{ marginTop: 16, background: '#ecfdf5' }}>
              <Statistic title="Monthly take-home" value={money(p.net)} valueStyle={{ color: '#059669' }} />
            </Card>
          )}
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        {s && p && (
          <Card bordered={false} title="Monthly breakup">
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Monthly CTC">{money(s.monthlyCtc)}</Descriptions.Item>
              <Descriptions.Item label="Gross salary">{money(s.gross)}</Descriptions.Item>
              {p.earnings.map((e: any) => <Descriptions.Item key={e.name} label={e.name}>{money(e.amount)}</Descriptions.Item>)}
              {p.deductions.map((e: any) => <Descriptions.Item key={e.name} label={<Typography.Text type="danger">{e.name}</Typography.Text>}>− {money(e.amount)}</Descriptions.Item>)}
              <Descriptions.Item label="Employer PF">{money(s.employerPf)}</Descriptions.Item>
              <Descriptions.Item label="Employer ESI">{s.esiApplicable ? money(s.employerEsi) : 'Not applicable'}</Descriptions.Item>
              <Descriptions.Item label="Annual taxable (new regime)">{money(data.tax.taxable)}</Descriptions.Item>
              <Descriptions.Item label="Annual income tax + cess">{money(data.tax.total)}</Descriptions.Item>
              <Descriptions.Item label={<b>Net take-home</b>}><b>{money(p.net)}</b></Descriptions.Item>
            </Descriptions>
          </Card>
        )}
      </Col>
    </Row>
  );
}

export default function Payroll() {
  return (
    <>
      <PageHeader title="Payroll" />
      <Tabs items={[
        { key: 'runs', label: 'Payroll Runs', children: <Runs /> },
        { key: 'calc', label: 'Salary Calculator', children: <Calculator /> },
      ]} />
    </>
  );
}
