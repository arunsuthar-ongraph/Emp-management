import { useState } from 'react';
import { Alert, App, Button, Card, Col, Divider, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { BankOutlined, EditOutlined, PlusOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, fmtDate, get } from '../api';
import { slugAddon, tenantAddress, tenantUrl, usesSubdomains } from '../tenant';
import { PageHeader, StatCard } from '../components/common';

/** Super admin: edit a company's details, including its subdomain (sign-in address). */
function EditCompanyModal({ tenant, states, onClose }: { tenant: any | null; states: any[]; onClose: () => void }) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const slug: string | undefined = Form.useWatch('slug', form);
  const slugChanged = !!tenant && !!slug && slug !== tenant.slug;

  const save = useMutation({
    mutationFn: (v: any) => api.patch(`/platform/tenants/${tenant.id}`, v),
    onSuccess: (r) => {
      message.success(r.data.slug !== tenant.slug ? `Saved. ${r.data.name} now signs in at ${tenantAddress(r.data.slug)}` : 'Company details saved');
      qc.invalidateQueries({ queryKey: ['tenants'] });
      onClose();
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const submit = (v: any) => {
    if (v.slug === tenant.slug) return save.mutate(v);
    modal.confirm({
      title: 'Change the sign-in address?',
      content: (
        <>
          <p>
            <b>{tenantAddress(tenant.slug)}</b> stops working immediately. Everyone at {tenant.name} must sign in at{' '}
            <b>{tenantAddress(v.slug)}</b>, and people signed in now will be signed out.
          </p>
          <p>Let the company know the new address before you change it.</p>
        </>
      ),
      okText: 'Change address',
      okButtonProps: { danger: true },
      onOk: () => save.mutateAsync(v),
    });
  };

  return (
    <Modal
      title={tenant ? `Edit ${tenant.name}` : ''}
      open={!!tenant}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Save changes"
      confirmLoading={save.isPending}
      width={600}
      destroyOnClose
      afterOpenChange={(o) => o && form.setFieldsValue(tenant)}
    >
      <Form form={form} layout="vertical" onFinish={submit} preserve={false}>
        <Form.Item name="name" label="Company name" rules={[{ required: true }]}><Input /></Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={14}>
            <Form.Item
              name="slug"
              label={usesSubdomains() ? 'Subdomain' : 'Company address'}
              normalize={(v) => (v || '').toLowerCase()}
              rules={[{ required: true }, { pattern: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, message: 'Lowercase letters, numbers, hyphens' }]}
            >
              <Input addonBefore={slugAddon().before} addonAfter={slugAddon().after} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="state" label="State (PT)" rules={[{ required: true }]}><Select options={states.map((s: any) => ({ value: s.code, label: s.name }))} /></Form.Item>
          </Col>
        </Row>
        {slugChanged && (
          <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={`The old address ${tenantAddress(tenant.slug)} will stop working as soon as you save.`} />
        )}
        <Form.Item name="address" label="Registered address"><Input.TextArea rows={2} /></Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12}><Form.Item name="pan" label="Company PAN"><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="tan" label="TAN"><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="pfCode" label="PF establishment code"><Input /></Form.Item></Col>
          <Col xs={24} sm={12}><Form.Item name="esiCode" label="ESI code"><Input /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  );
}

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);

export default function Tenants() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ['tenants'], queryFn: () => get('/platform/tenants') });
  const { data: states = [] } = useQuery({ queryKey: ['states'], queryFn: () => get('/payroll/states') });
  const [editing, setEditing] = useState<any | null>(null);
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
      <PageHeader
        title="Companies"
        subtitle="Every company on the platform"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openForm}>Create company</Button>}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}><StatCard title="Companies" value={data.length} icon={<BankOutlined />} suffix={`${data.filter((t: any) => t.isActive).length} active`} /></Col>
        <Col xs={12} md={8}><StatCard title="Employees managed" value={total('employees')} icon={<TeamOutlined />} /></Col>
        <Col xs={12} md={8}><StatCard title="Payroll runs" value={total('payrollRuns')} icon={<WalletOutlined />} /></Col>
      </Row>
      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 900 }}
          columns={[
            { title: 'Company', dataIndex: 'name', render: (n) => <b>{n}</b> },
            { title: 'Sign-in address', dataIndex: 'slug', render: (s) => <a href={tenantUrl(s)} target="_blank" rel="noreferrer">{tenantAddress(s)}</a> },
            { title: 'State', dataIndex: 'state' },
            { title: 'Employees', render: (_, t: any) => t._count.employees },
            { title: 'Logins', render: (_, t: any) => t._count.users },
            { title: 'Payroll runs', render: (_, t: any) => t._count.payrollRuns },
            { title: 'Created', dataIndex: 'createdAt', render: fmtDate },
            { title: 'Access', dataIndex: 'isActive', render: (a) => (a ? <Tag color="green" bordered={false}>Enabled</Tag> : <Tag color="red" bordered={false}>Suspended</Tag>) },
            {
              title: '',
              render: (_, t: any) => (
                <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ ...t, address: t.address || '', pan: t.pan || '', tan: t.tan || '', pfCode: t.pfCode || '', esiCode: t.esiCode || '' })}>Edit</Button>
                <Popconfirm title={t.isActive ? 'Suspend this company? Its users will not be able to sign in.' : 'Reactivate this company?'} onConfirm={() => status.mutate(t)}>
                  <Button size="small" danger={t.isActive}>{t.isActive ? 'Suspend' : 'Activate'}</Button>
                </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <EditCompanyModal tenant={editing} states={states} onClose={() => setEditing(null)} />
      <Modal title="Create company" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Create" confirmLoading={create.isPending} width={560}>
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
              <Form.Item name="slug" label={usesSubdomains() ? 'Subdomain' : 'Company address'} rules={[{ required: true }, { pattern: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, message: 'Lowercase letters, numbers, hyphens' }]}>
                <Input addonBefore={slugAddon().before} addonAfter={slugAddon().after} onChange={() => setSlugTouched(true)} />
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
