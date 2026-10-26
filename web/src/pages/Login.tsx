import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, Divider, Form, Input, Result, Select, Space, Spin, Tag, Typography } from 'antd';
import { ArrowRightOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg, get } from '../api';
import { useAuth } from '../auth';
import { platformUrl, SINGLE_COMPANY, slugAddon, tenantAddress, tenantSlug, tenantUrl } from '../tenant';
import { ThemeToggle } from '../components/AppLayout';

const DEMO_COMPANY = [
  ['Company Admin', 'admin@acme.com'],
  ['HR Admin', 'hr@acme.com'],
  ['Payroll Admin', 'payroll@acme.com'],
  ['Manager', 'manager@acme.com'],
  ['Employee', 'employee@acme.com'],
];

function Brand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <Typography.Title level={3} style={{ margin: 0, fontWeight: 600 }}>{title}</Typography.Title>
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
        subTitle={<>There is no company at <b>{tenantAddress(slug)}</b>. Check the address with your HR team.</>}
        extra={<Button href={platformUrl()}>Go to main site</Button>}
      />
    );
  }
  return (
    <>
      <Brand title={data.name} subtitle="Sign in with your work email" />
      {!data.isActive && <Alert type="error" showIcon style={{ marginBottom: 16 }} message="This company account is suspended. Contact support." />}
      <LoginForm demo={slug === 'acme' ? DEMO_COMPANY : []} />
      <Typography.Paragraph type="secondary" style={{ marginTop: 20, fontSize: 12, textAlign: 'center' }}>
        Don't have a login? Ask your HR or company admin to create one.
      </Typography.Paragraph>
    </>
  );
}

/** Public sign-up: creates the company and its admin, then opens the company signed in. */
function SignupForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const { data: states = [] } = useQuery({ queryKey: ['states'], queryFn: () => get('/payroll/states') });
  const toSlug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  const slug: string = Form.useWatch('slug', form) || '';

  const submit = async (v: any) => {
    setBusy(true);
    try {
      const r = await api.post('/auth/signup', v);
      // Hand the session to the company's own address (another origin in subdomain mode), then finish setup
      window.location.href = `${tenantUrl(r.data.slug)}/settings?welcome=1#token=${encodeURIComponent(r.data.token)}`;
    } catch (e) {
      message.error(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ state: 'MH' }}
      onFinish={submit}
      onValuesChange={(c) => 'companyName' in c && !slugTouched && form.setFieldsValue({ slug: toSlug(c.companyName) })}
      requiredMark={false}
    >
      <Form.Item name="companyName" label="Company name" rules={[{ required: true, message: 'Enter your company name' }]}>
        <Input size="large" placeholder="Acme Technologies Pvt Ltd" />
      </Form.Item>
      <Form.Item
        name="slug"
        label="Company address"
        extra={slug ? `Your team signs in at ${tenantAddress(slug)}` : 'Your team signs in at this address'}
        normalize={(v) => (v || '').toLowerCase()}
        rules={[{ required: true, message: 'Choose an address' }, { pattern: /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, message: 'Lowercase letters, numbers and hyphens' }]}
      >
        <Input addonBefore={slugAddon().before} addonAfter={slugAddon().after} placeholder="acme" onChange={() => setSlugTouched(true)} />
      </Form.Item>
      <Form.Item name="state" label="State" tooltip="Used for Professional Tax">
        <Select showSearch optionFilterProp="label" options={states.map((x: any) => ({ value: x.code, label: x.name }))} />
      </Form.Item>
      <Space.Compact block>
        <Form.Item name="firstName" label="Your first name" rules={[{ required: true, message: 'Required' }]} style={{ width: '50%' }}>
          <Input />
        </Form.Item>
        <Form.Item name="lastName" label="Last name" rules={[{ required: true, message: 'Required' }]} style={{ width: '50%', marginLeft: 8 }}>
          <Input />
        </Form.Item>
      </Space.Compact>
      <Form.Item name="email" label="Work email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
        <Input prefix={<MailOutlined />} autoComplete="email" />
      </Form.Item>
      <Form.Item name="password" label="Password" rules={[{ required: true, min: 8, message: 'At least 8 characters' }]}>
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" size="large" block loading={busy}>Create company account</Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        You'll be the company admin. Next you'll add your company details, then your employees.
      </Typography.Paragraph>
    </Form>
  );
}

/** Single-company deployment: just the company's sign-in (company and admin login come from server settings). */
function SingleCompanyEntry() {
  const { data: config, isLoading } = useQuery({ queryKey: ['public-config'], queryFn: () => get('/auth/config') });
  if (isLoading || !config) return <Spin />;
  if (!config.configured) {
    return (
      <Result
        status="info"
        title="Not set up yet"
        subTitle="The administrator needs to set ADMIN_EMAIL and ADMIN_PASSWORD on the server and restart it."
      />
    );
  }
  return (
    <>
      <Brand title={config.companyName} subtitle="Sign in with your work email" />
      <LoginForm demo={String(config.companyName).startsWith('Acme') ? DEMO_COMPANY : []} />
    </>
  );
}

/** Root address: create a company (if sign-up is on), find your company, and the platform admin sign-in (if enabled). */
function PlatformLogin() {
  const [slug, setSlug] = useState('');
  const [mode, setMode] = useState<'signup' | 'find' | 'admin'>('signup');
  const go = () => slug.trim() && (window.location.href = tenantUrl(slug.trim().toLowerCase()));
  const { data: config, isLoading } = useQuery({ queryKey: ['public-config'], queryFn: () => get('/auth/config') });
  if (isLoading || !config) return <Spin />;

  const finder = (
    <>
      <Typography.Text strong>Go to your company</Typography.Text>
      <Space.Compact style={{ width: '100%', margin: '8px 0 4px' }}>
        <Input size="large" placeholder="yourcompany" value={slug} onChange={(e) => setSlug(e.target.value)} onPressEnter={go} addonBefore={slugAddon().before} addonAfter={slugAddon().after} />
        <Button size="large" type="primary" icon={<ArrowRightOutlined />} onClick={go} aria-label="Go to company" />
      </Space.Compact>
    </>
  );

  if (config.signup && mode === 'signup') {
    return (
      <>
        <Brand title="Create your company account" subtitle="Leave, attendance and payroll for your team." />
        <SignupForm />
        <Divider plain style={{ fontSize: 12 }}>Already registered?</Divider>
        <Button block onClick={() => setMode('find')}>Sign in to your company</Button>
        {config.superAdmin && <Button type="link" block onClick={() => setMode('admin')}>Platform administrator sign-in</Button>}
      </>
    );
  }

  return (
    <>
      <Brand title="Sign in" subtitle="Employees and company admins sign in at their company's address." />
      {finder}
      {config.superAdmin && mode !== 'find' ? (
        <>
          <Divider plain style={{ fontSize: 12 }}>Platform administrator</Divider>
          <LoginForm demo={[['Super Admin', 'superadmin@hrms.local']]} />
        </>
      ) : null}
      {config.signup ? (
        <Button type="link" block style={{ marginTop: 16 }} onClick={() => setMode('signup')}>New here? Create a company account</Button>
      ) : (
        <Typography.Paragraph type="secondary" style={{ marginTop: 20, fontSize: 12, textAlign: 'center' }}>
          New companies are set up by the platform administrator.
        </Typography.Paragraph>
      )}
      {config.superAdmin && mode === 'find' && (
        <Button type="link" block onClick={() => setMode('admin')}>Platform administrator sign-in</Button>
      )}
    </>
  );
}

export default function Login() {
  const slug = tenantSlug();
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="brand" style={{ padding: 0, border: 0, height: 'auto' }}>
          <span className="brand-mark" aria-hidden>P</span>
          <span className="brand-name">PeopleDesk</span>
        </div>
        <div>
          <h1>Leave, attendance and payroll in one place.</h1>
          <p>
            Employees check in and apply for leave. Managers approve from the same screen. On payday, PF, ESI,
            professional tax and TDS are worked out from the month's attendance.
          </p>
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>Built for companies in India</Typography.Text>
      </aside>
      <main className="auth-main" style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', top: 20, right: 24 }}>
          <ThemeToggle size="small" />
        </div>
        <div className="auth-panel">
          {SINGLE_COMPANY ? <SingleCompanyEntry /> : slug ? <CompanyLogin slug={slug} /> : <PlatformLogin />}
        </div>
      </main>
    </div>
  );
}
