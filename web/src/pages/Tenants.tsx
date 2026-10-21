import { useState } from 'react';
import { App, Button, Card, Col, Divider, Form, Input, Modal, Popconfirm, Row, Select, Table, Tag, Typography } from 'antd';
import { BankOutlined, PlusOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, fmtDate, get } from '../api';
import { ROOT_DOMAIN, tenantUrl } from '../tenant';
import { PageHeader, StatCard } from '../components/common';

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

export default function Tenants() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ['tenants'], queryFn: () => get('/platform/tenants') });
  const { data: states = [] } = useQuery({ queryKey: ['states'], queryFn: () => get('/payroll/states') });
  const total = (k: string) => data.reduce((a: number, t: any) => a + t._count[k], 0);

  const create = useMutation({
    mutationFn: (v: any) => api.post('/platform/tenants', v),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      setOpen(false);
      const url = tenantUrl(r.data.slug);
      modal.success({
        title: `${r.data.name} is ready`,
        content: (
          <>
            <p>Share this sign-in address with the company admin:</p>
            <Typography.Paragraph copyable={{ text: url }}><a href={url} target="_blank" rel="noreferrer">{url}</a></Typography.Paragraph>
            <p>Admin login: <b>{v.email}</b></p>
          </>
        ),
      });
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const status = useMutation({
    mutationFn: (t: any) => api.patch(`/platform/tenants/${t.id}/status`, { isActive: !t.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
    onError: (e) => message.error(errMsg(e)),
  });

  const openForm = () => {
    form.resetFields();
    form.setFieldsValue({ state: 'MH' });
    setSlugTouched(false);
    setOpen(true);
  };

  return (
    <>
      <PageHeader title="Companies" extra={<Button type="primary" icon={<PlusOutlined />} onClick={openForm}>Create Company</Button>} />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}><StatCard title="Companies" value={data.length} icon={<BankOutlined />} color="#4f46e5" suffix={`${data.filter((t: any) => t.isActive).length} active`} /></Col>
        <Col xs={12} md={8}><StatCard title="Employees managed" value={total('employees')} icon={<TeamOutlined />} color="#10b981" /></Col>
        <Col xs={12} md={8}><StatCard title="Payroll runs" value={total('payrollRuns')} icon={<WalletOutlined />} color="#f59e0b" /></Col>
      </Row>
      <Card bordered={false}>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 800 }}
          columns={[
            { title: 'Company', dataIndex: 'name', render: (n) => <b>{n}</b> },
            { title: 'Sign-in address', dataIndex: 'slug', render: (s) => <a href={tenantUrl(s)} target="_blank" rel="noreferrer">{s}.{ROOT_DOMAIN}</a> },
            { title: 'State', dataIndex: 'state' },
            { title: 'Employees', render: (_, t: any) => t._count.employees },
            { title: 'Logins', render: (_, t: any) => t._count.users },
            { title: 'Payroll runs', render: (_, t: any) => t._count.payrollRuns },
            { title: 'Created', dataIndex: 'createdAt', render: fmtDate },
            { title: 'Status', dataIndex: 'isActive', render: (a) => (a ? <Tag color="green">Active</Tag> : <Tag color="red">Suspended</Tag>) },
            {
              title: '',
              render: (_, t: any) => (
                <Popconfirm title={t.isActive ? 'Suspend this company? Its users will not be able to sign in.' : 'Reactivate this company?'} onConfirm={() => status.mutate(t)}>
                  <Button size="small" danger={t.isActive}>{t.isActive ? 'Suspend' : 'Activate'}</Button>
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Modal title="Create Company" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Create" confirmLoading={create.isPending} width={560}>
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => create.mutate(v)}
          onValuesChange={(c) => {
            if ('companyName' in c && !slugTouched) form.setFieldsValue({ slug: toSlug(c.companyName) });
          }}
        >
          <Form.Item name="companyName" label="Company name" rules={[{ required: true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={14}>
              <Form.Item name="slug" label="Subdomain" rules={[{ required: true }, { pattern: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, message: 'Lowercase letters, numbers, hyphens' }]}>
                <Input addonAfter={`.${ROOT_DOMAIN}`} onChange={() => setSlugTouched(true)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={10}>
              <Form.Item name="state" label="State (PT)"><Select options={states.map((s: any) => ({ value: s.code, label: s.name }))} /></Form.Item>
            </Col>
          </Row>
          <Divider orientation="left" plain>First company admin</Divider>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="firstName" label="First name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="lastName" label="Last name" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="email" label="Admin email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="password" label="Temporary password" rules={[{ required: true, min: 6 }]}><Input.Password /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
