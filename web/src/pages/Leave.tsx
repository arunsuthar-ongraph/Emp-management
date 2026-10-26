import { useState } from 'react';
import { App, Badge, Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errMsg, fmtDate, get } from '../api';
import { useAuth } from '../auth';
import { PageHeader, StatusTag } from '../components/common';
import { ApprovalSteps } from '../components/org';

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => ['leave-me', 'leave-balances', 'leave-pending', 'leave-all', 'leave-team', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
};

const employeeCol = { title: 'Employee', render: (_: any, r: any) => `${r.employee.firstName} ${r.employee.lastName} (${r.employee.code})` };
const baseCols = [
  { title: 'Type', render: (_: any, r: any) => <Tag color={r.leaveType.isPaid ? 'blue' : 'volcano'}>{r.leaveType.code}</Tag> },
  { title: 'From', dataIndex: 'fromDate', render: fmtDate },
  { title: 'To', dataIndex: 'toDate', render: fmtDate },
  { title: 'Days', dataIndex: 'days', render: (d: string, r: any) => `${Number(d)}${r.halfDay ? ' (half)' : ''}` },
  { title: 'Reason', dataIndex: 'reason', ellipsis: true },
];
const chainCol = { title: 'Approval flow', width: 300, render: (_: any, r: any) => <ApprovalSteps request={r} /> };

/** Approve / reject buttons. HR acting outside their own step is an override that finalizes the request. */
function DecisionButtons({ request }: { request: any }) {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const invalidate = useInvalidate();
  const isMyStep = request.currentApproverId && request.currentApproverId === user?.employee?.id;
  const override = !isMyStep && request.currentApproverId !== null;
  const nextLevel = request.approvals?.some((a: any) => a.level === request.currentLevel + 1) && !override;

  const decide = useMutation({
    mutationFn: ({ action, comment }: { action: 'approve' | 'reject'; comment?: string }) => api.patch(`/leave/requests/${request.id}/${action}`, { comment }),
    onSuccess: (r, v) => {
      const st = r.data.status;
      message.success(v.action === 'reject' ? 'Leave rejected' : st === 'APPROVED' ? 'Leave approved' : 'Approved, sent to the next approver');
      invalidate();
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const ask = (action: 'approve' | 'reject') => {
    let comment = '';
    modal.confirm({
      title: action === 'approve' ? (override ? 'Approve as HR (final)' : nextLevel ? 'Approve and forward' : 'Approve leave') : override ? 'Reject as HR (final)' : 'Reject leave',
      content: (
        <>
          {override && <Typography.Paragraph type="warning">This request is waiting for someone else. Your decision will be final.</Typography.Paragraph>}
          {action === 'approve' && nextLevel && <Typography.Paragraph type="secondary">It will go to the next approver in the chain.</Typography.Paragraph>}
          <Input.TextArea rows={3} placeholder={action === 'reject' ? 'Reason (shown to employee)' : 'Comment (optional)'} onChange={(e) => (comment = e.target.value)} />
        </>
      ),
      okText: action === 'approve' ? 'Approve' : 'Reject',
      okButtonProps: { danger: action === 'reject' },
      onOk: () => decide.mutateAsync({ action, comment }),
    });
  };

  return (
    <Space>
      <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => ask('approve')}>{override ? 'Override' : nextLevel ? 'Approve →' : 'Approve'}</Button>
      <Button danger size="small" icon={<CloseOutlined />} onClick={() => ask('reject')}>Reject</Button>
    </Space>
  );
}

function ApplyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const [form] = Form.useForm();
  const { data: types = [] } = useQuery({ queryKey: ['leave-types'], queryFn: () => get('/leave/types') });
  const { data: balances = [] } = useQuery({ queryKey: ['leave-balances'], queryFn: () => get('/leave/balances/me') });
  const range = Form.useWatch('range', form);
  const single = range && range[0] && range[1] && range[0].isSame(range[1], 'day');

  const apply = useMutation({
    mutationFn: (v: any) =>
      api.post('/leave/requests', {
        leaveTypeId: v.leaveTypeId,
        fromDate: v.range[0].format('YYYY-MM-DD'),
        toDate: v.range[1].format('YYYY-MM-DD'),
        halfDay: !!v.halfDay,
        reason: v.reason,
      }),
    onSuccess: () => {
      message.success('Leave request submitted');
      invalidate();
      form.resetFields();
      onClose();
    },
    onError: (e) => message.error(errMsg(e)),
  });

  return (
    <Modal title="Apply for leave" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Submit" confirmLoading={apply.isPending} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => apply.mutate(v)}>
        <Form.Item name="leaveTypeId" label="Leave type" rules={[{ required: true }]}>
          <Select
            options={types.filter((t: any) => t.isActive).map((t: any) => {
              const b = balances.find((x: any) => x.leaveTypeId === t.id);
              return { value: t.id, label: `${t.name} (${t.code})${b ? ` — ${b.available} available` : t.isPaid ? '' : ' — unpaid'}` };
            })}
          />
        </Form.Item>
        <Form.Item name="range" label="Dates" rules={[{ required: true }]}>
          <DatePicker.RangePicker style={{ width: '100%' }} format="DD MMM YYYY" disabledDate={(d) => d.day() === 0 || d.day() === 6} />
        </Form.Item>
        {single && (
          <Form.Item name="halfDay" valuePropName="checked">
            <Checkbox>Half day</Checkbox>
          </Form.Item>
        )}
        <Form.Item name="reason" label="Reason">
          <Input.TextArea rows={3} />
        </Form.Item>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Weekends and company holidays are not counted.</Typography.Text>
      </Form>
    </Modal>
  );
}

function MyLeave() {
  const { message } = App.useApp();
  const invalidate = useInvalidate();
  const [open, setOpen] = useState(false);
  const { data: balances = [] } = useQuery({ queryKey: ['leave-balances'], queryFn: () => get('/leave/balances/me') });
  const { data: requests = [], isLoading } = useQuery({ queryKey: ['leave-me'], queryFn: () => get('/leave/requests/me') });
  const cancel = useMutation({
    mutationFn: (id: string) => api.patch(`/leave/requests/${id}/cancel`),
    onSuccess: () => {
      message.success('Request cancelled');
      invalidate();
    },
    onError: (e) => message.error(errMsg(e)),
  });

  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {balances.map((b: any) => (
          <Col xs={12} md={6} key={b.code}>
            <Card>
              <Typography.Text type="secondary">{b.name}</Typography.Text>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{b.available}</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                of {b.allocated} · used {b.used}{b.pending ? ` · pending ${b.pending}` : ''}
              </Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>
      <Card title="My requests" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Apply for leave</Button>}>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={requests}
          scroll={{ x: 800 }}
          columns={[
            ...baseCols,
            { title: 'Status', dataIndex: 'status', render: (s: string) => <StatusTag status={s} /> },
            chainCol,
            {
              title: '',
              render: (_: any, r: any) =>
                (r.status === 'PENDING' || (r.status === 'APPROVED' && !dayjs(r.fromDate).isBefore(dayjs(), 'day'))) && (
                  <Popconfirm title="Cancel this request?" onConfirm={() => cancel.mutate(r.id)}>
                    <Button size="small">Cancel</Button>
                  </Popconfirm>
                ),
            },
          ]}
        />
      </Card>
      <ApplyModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Approvals() {
  const { data = [], isLoading } = useQuery({ queryKey: ['leave-pending'], queryFn: () => get('/leave/requests/pending') });
  return (
    <Card>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        scroll={{ x: 1200 }}
        locale={{ emptyText: 'Nothing waiting for your approval 🎉' }}
        columns={[
          employeeCol,
          ...baseCols,
          {
            title: 'Your step',
            render: (_: any, r: any) => {
              const step = r.approvals?.find((a: any) => a.level === r.currentLevel);
              return r.currentApproverId ? <Tag color="blue">{step?.role} · {r.currentLevel}/{r.approvals.length}</Tag> : <Tag color="purple">HR queue</Tag>;
            },
          },
          chainCol,
          { title: '', width: 200, render: (_: any, r: any) => <DecisionButtons request={r} /> },
        ]}
      />
    </Card>
  );
}

function TeamRequests() {
  const { data = [], isLoading } = useQuery({ queryKey: ['leave-team'], queryFn: () => get('/leave/requests/team') });
  return (
    <Card title={<Typography.Text type="secondary" style={{ fontWeight: 400 }}>Leave of everyone you lead: direct and indirect reports, and members of departments you head.</Typography.Text>}>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        scroll={{ x: 1100 }}
        columns={[employeeCol, ...baseCols, { title: 'Status', dataIndex: 'status', render: (s: string) => <StatusTag status={s} /> }, chainCol]}
      />
    </Card>
  );
}

function AllRequests() {
  const [status, setStatus] = useState<string>();
  const { data = [], isLoading } = useQuery({ queryKey: ['leave-all', status], queryFn: () => get('/leave/requests', { status }) });
  return (
    <Card extra={
      <Select placeholder="All statuses" allowClear style={{ width: 160 }} onChange={setStatus}
        options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({ value: s, label: s }))} />
    }>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        scroll={{ x: 1300 }}
        columns={[
          employeeCol,
          ...baseCols,
          { title: 'Status', dataIndex: 'status', render: (s: string) => <StatusTag status={s} /> },
          chainCol,
          { title: '', width: 190, render: (_: any, r: any) => r.status === 'PENDING' && <DecisionButtons request={r} /> },
        ]}
      />
    </Card>
  );
}

function LeaveTypes() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const { data = [], isLoading } = useQuery({ queryKey: ['leave-types'], queryFn: () => get('/leave/types') });
  const save = useMutation({
    mutationFn: (v: any) => (editing ? api.patch(`/leave/types/${editing.id}`, v) : api.post('/leave/types', v)),
    onSuccess: () => {
      message.success('Leave type saved');
      qc.invalidateQueries({ queryKey: ['leave-types'] });
      qc.invalidateQueries({ queryKey: ['leave-balances'] });
      setEditing(undefined);
    },
    onError: (e) => message.error(errMsg(e)),
  });
  const open = (t: any | null) => {
    setEditing(t);
    form.resetFields();
    form.setFieldsValue(t || { annualQuota: 12, isPaid: true, carryForward: false, isActive: true });
  };

  return (
    <Card extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>Add leave type</Button>}>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: 'Code', dataIndex: 'code', render: (c) => <Tag color="blue">{c}</Tag> },
          { title: 'Name', dataIndex: 'name' },
          { title: 'Annual quota', dataIndex: 'annualQuota', render: (q, t: any) => (t.isPaid ? `${q} days` : 'Unlimited') },
          { title: 'Paid', dataIndex: 'isPaid', render: (v) => (v ? <Tag color="green">Paid</Tag> : <Tag color="volcano">Unpaid (LOP)</Tag>) },
          { title: 'Carry forward', dataIndex: 'carryForward', render: (v) => (v ? 'Yes' : 'No') },
          { title: 'Status', dataIndex: 'isActive', render: (v) => <Badge status={v ? 'success' : 'default'} text={v ? 'Active' : 'Inactive'} /> },
          { title: '', render: (_, t: any) => <Button size="small" onClick={() => open(t)}>Edit</Button> },
        ]}
      />
      <Modal title={editing ? 'Edit leave type' : 'Add leave type'} open={editing !== undefined} onCancel={() => setEditing(undefined)} onOk={() => form.submit()} confirmLoading={save.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Row gutter={12}>
            <Col span={16}><Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="code" label="Code" rules={[{ required: true }]}><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="annualQuota" label="Days per year" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Space size="large">
            <Form.Item name="isPaid" label="Paid leave" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="carryForward" label="Carry forward" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="isActive" label="Active" valuePropName="checked"><Switch /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </Card>
  );
}

export default function Leave() {
  const { can, user } = useAuth();
  const approver = !!user?.isLead || can('leave.manage');
  const { data: pending = [] } = useQuery({ queryKey: ['leave-pending'], queryFn: () => get('/leave/requests/pending'), enabled: approver });

  const tabs = [
    { key: 'me', label: 'My leave', children: <MyLeave /> },
    ...(approver ? [{ key: 'approvals', label: <Badge count={pending.length} offset={[12, 0]}>Approvals</Badge>, children: <Approvals /> }] : []),
    ...(user?.isLead ? [{ key: 'team', label: 'Team requests', children: <TeamRequests /> }] : []),
    ...(can('leave.manage')
      ? [
          { key: 'all', label: 'All requests', children: <AllRequests /> },
          { key: 'types', label: 'Leave types', children: <LeaveTypes /> },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title="Leave" />
      <Tabs items={tabs} destroyInactiveTabPane />
    </>
  );
}
