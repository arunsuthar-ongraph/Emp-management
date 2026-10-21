import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, Divider, Form, Input, Result, Space, Spin, Tag, Typography } from 'antd';
import { ArrowRightOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { errMsg, get } from '../api';
import { useAuth } from '../auth';
import { platformUrl, ROOT_DOMAIN, tenantSlug, tenantUrl } from '../tenant';

const DEMO_COMPANY = [
  ['Company Admin', 'admin@acme.com'],
  ['HR Admin', 'hr@acme.com'],
  ['Payroll Admin', 'payroll@acme.com'],
  ['Manager', 'manager@acme.com'],
  ['Employee', 'employee@acme.com'],
];

function Brand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      <div style={{ background: '#4f46e5', color: '#fff', width: 48, height: 48, borderRadius: 12, display: 'inline-grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>P</div>
      <Typography.Title level={3} style={{ margin: '12px 0 0' }}>{title}</Typography.Title>
      <Typography.Text type="secondary">{subtitle}</Typography.Text>
    </div>
  );
}

function LoginForm({ demo }: { demo: string[][] }) {
  const { login } = useAuth();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm();

  const submit = async (v: { email: string; password: string }) => {
    setBusy(true);
    try {
      await login(v.email, v.password);
      navigate('/');
    } catch (e) {
      message.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="email" rules={[{ required: true, type: 'email' }]}>
          <Input size="large" prefix={<MailOutlined />} placeholder="Work email" autoFocus />
        </Form.Item>
        <Form.Item name="password" rules={[{ required: true }]}>
          <Input.Password size="large" prefix={<LockOutlined />} placeholder="Password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={busy}>Sign in</Button>
      </Form>
      {import.meta.env.DEV && demo.length > 0 && (
        <>
          <Typography.Paragraph type="secondary" style={{ marginTop: 20, marginBottom: 8, fontSize: 12 }}>
            Demo logins (password <b>Password@123</b>), click to fill:
          </Typography.Paragraph>
          {demo.map(([role, email]) => (
            <Tag key={email} style={{ cursor: 'pointer', marginBottom: 6 }} onClick={() => form.setFieldsValue({ email, password: 'Password@123' })}>
              {role}
            </Tag>
          ))}
        </>
      )}
    </>
  );
}

/** <company>.domain – employees of that company sign in here. */
function CompanyLogin({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['workspace', slug], queryFn: () => get('/auth/workspace'), retry: false });

  if (isLoading) return <Spin />;
  if (isError || !data) {
    return (
      <Result
        status="404"
        title="Company not found"
        subTitle={<>There is no company at <b>{slug}.{ROOT_DOMAIN}</b>. Check the address with your HR team.</>}
        extra={<Button href={platformUrl()}>Go to main site</Button>}
      />
    );
  }
  return (
    <>
      <Brand title={data.name} subtitle="Sign in to your employee portal" />
      {!data.isActive && <Alert type="error" showIcon style={{ marginBottom: 16 }} message="This company account is suspended. Contact support." />}
      <LoginForm demo={slug === 'acme' ? DEMO_COMPANY : []} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 20, fontSize: 12, textAlign: 'center' }}>
        Don't have a login? Ask your HR or company admin to create one.
      </Typography.Paragraph>
    </>
  );
}

/** Root domain – platform super admin sign-in, plus a jump to a company subdomain. */
function PlatformLogin() {
  const [slug, setSlug] = useState('');
  const go = () => slug.trim() && (window.location.href = tenantUrl(slug.trim().toLowerCase()));

  return (
    <>
      <Brand title="PeopleDesk HRMS" subtitle="Leave, attendance & payroll for Indian companies" />
      <Typography.Text strong>Employees: go to your company</Typography.Text>
      <Space.Compact style={{ width: '100%', margin: '8px 0 4px' }}>
        <Input size="large" placeholder="yourcompany" value={slug} onChange={(e) => setSlug(e.target.value)} onPressEnter={go} addonAfter={`.${ROOT_DOMAIN}`} />
        <Button size="large" type="primary" icon={<ArrowRightOutlined />} onClick={go} />
      </Space.Compact>
      <Divider plain style={{ fontSize: 12 }}>Platform administrator</Divider>
      <LoginForm demo={[['Super Admin', 'superadmin@hrms.local']]} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 20, fontSize: 12, textAlign: 'center' }}>
        New companies are set up by the platform administrator.
      </Typography.Paragraph>
    </>
  );
}

export default function Login() {
  const slug = tenantSlug();
  return (
    <div className="auth-bg">
      <Card style={{ width: '100%', maxWidth: 440 }} styles={{ body: { padding: 32 } }}>
        {slug ? <CompanyLogin slug={slug} /> : <PlatformLogin />}
      </Card>
    </div>
  );
}
