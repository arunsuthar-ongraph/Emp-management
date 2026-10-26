import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Dropdown, Grid, Layout, Menu, MenuProps, Segmented, Space, Tooltip, Typography } from 'antd';
import {
  ApartmentOutlined,
  BankOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DesktopOutlined,
  FileTextOutlined,
  GiftOutlined,
  LogoutOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth';
import { ROLE_LABEL } from '../api';
import { ThemeMode, useThemeMode } from '../theme';

const { Sider, Header, Content } = Layout;

type Check = { can: (p: string) => boolean; tenant: boolean };
type Item = { key: string; label: string; icon: JSX.Element; show: (c: Check) => boolean };

/** Navigation grouped by the job people come to do. */
const NAV: { group: string; items: Item[] }[] = [
  {
    group: '',
    items: [
      { key: '/', label: 'Dashboard', icon: <DashboardOutlined />, show: (c) => c.tenant },
      { key: '/tenants', label: 'Companies', icon: <BankOutlined />, show: (c) => c.can('platform.admin') },
    ],
  },
  {
    group: 'People',
    items: [
      { key: '/employees', label: 'Employees', icon: <TeamOutlined />, show: (c) => c.can('employee.read') },
      { key: '/organization', label: 'Organization', icon: <ApartmentOutlined />, show: (c) => c.can('org.write') },
    ],
  },
  {
    group: 'Time off & attendance',
    items: [
      { key: '/leave', label: 'Leave', icon: <CalendarOutlined />, show: (c) => c.can('leave.apply') },
      { key: '/attendance', label: 'Attendance', icon: <ClockCircleOutlined />, show: (c) => c.can('attendance.self') },
      { key: '/holidays', label: 'Holidays', icon: <GiftOutlined />, show: (c) => c.tenant },
    ],
  },
  {
    group: 'Pay',
    items: [
      { key: '/payroll', label: 'Payroll', icon: <WalletOutlined />, show: (c) => c.can('payroll.manage') },
      { key: '/payslips', label: 'My payslips', icon: <FileTextOutlined />, show: (c) => c.can('payslip.self') },
    ],
  },
  {
    group: 'Admin',
    items: [
      { key: '/settings', label: 'Company settings', icon: <SettingOutlined />, show: (c) => c.can('settings.write') },
    ],
  },
];

export function ThemeToggle({ size = 'middle' }: { size?: 'small' | 'middle' }) {
  const { mode, setMode } = useThemeMode();
  const opt = (value: ThemeMode, icon: JSX.Element, label: string) => ({
    value,
    label: (
      <Tooltip title={label}>
        <span aria-label={label}>{icon}</span>
      </Tooltip>
    ),
  });
  return (
    <Segmented
      size={size}
      value={mode}
      onChange={(v) => setMode(v as ThemeMode)}
      options={[opt('light', <SunOutlined />, 'Light'), opt('dark', <MoonOutlined />, 'Dark'), opt('system', <DesktopOutlined />, 'Match system')]}
    />
  );
}

export default function AppLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);

  const check: Check = { can, tenant: !!user?.tenant };
  const items: MenuProps['items'] = NAV.flatMap(({ group, items }): NonNullable<MenuProps['items']> => {
    const visible = items.filter((i) => i.show(check)).map(({ key, label, icon }) => ({ key, label, icon }));
    if (!visible.length) return [];
    return group && !collapsed ? [{ type: 'group' as const, key: group, label: group, children: visible }] : visible;
  });
  const name = user?.employee?.name || user?.email || '';
  const subtitle = user?.employee?.designation || ROLE_LABEL[user!.role];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        className="app-sider"
        theme="light"
        breakpoint="lg"
        collapsedWidth={screens.xs ? 0 : 72}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={236}
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div className="brand">
          <span className="brand-mark" aria-hidden>P</span>
          {!collapsed && <span className="brand-name">PeopleDesk</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[pathname]}
          items={items}
          style={{ borderInlineEnd: 0, padding: '8px 8px 16px' }}
          onClick={(e) => {
            navigate(e.key);
            if (screens.xs) setCollapsed(true);
          }}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Typography.Text strong style={{ fontSize: 15, minWidth: 0 }} ellipsis>
            {user?.tenant?.name || 'Platform administration'}
          </Typography.Text>
          <Space size={16}>
            {screens.sm && <ThemeToggle size="small" />}
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'email', label: user?.email, disabled: true },
                  { type: 'divider' },
                  { key: 'profile', label: 'My profile', icon: <UserOutlined />, onClick: () => navigate('/profile') },
                  ...(!screens.sm
                    ? [{ key: 'theme', label: <ThemeToggle size="small" />, disabled: true } as const]
                    : []),
                  { key: 'logout', label: 'Sign out', icon: <LogoutOutlined />, danger: true, onClick: logout },
                ],
              }}
            >
              <button type="button" aria-label="Account menu" style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar src={user?.avatarUrl || undefined} style={{ background: 'var(--brand)', color: 'var(--on-brand)' }}>
                  {name.charAt(0).toUpperCase()}
                </Avatar>
                {screens.md && (
                  <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{name}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{subtitle}</span>
                  </span>
                )}
              </button>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: screens.xs ? 16 : '24px 28px', maxWidth: 1440, width: '100%' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
