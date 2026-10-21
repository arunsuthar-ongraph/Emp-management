import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Dropdown, Grid, Layout, Menu, Space, Tag, Typography } from 'antd';
import {
  ApartmentOutlined,
  BankOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  FileTextOutlined,
  GiftOutlined,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth';
import { ROLE_COLOR, ROLE_LABEL } from '../api';

const { Sider, Header, Content } = Layout;

const MENU = [
  { key: '/', label: 'Dashboard', icon: <DashboardOutlined />, show: (c: Check) => c.tenant },
  { key: '/tenants', label: 'Companies', icon: <BankOutlined />, show: (c: Check) => c.can('platform.admin') },
  { key: '/employees', label: 'Employees', icon: <TeamOutlined />, show: (c: Check) => c.can('employee.read') },
  { key: '/organization', label: 'Organization', icon: <ApartmentOutlined />, show: (c: Check) => c.can('org.write') },
  { key: '/leave', label: 'Leave', icon: <CalendarOutlined />, show: (c: Check) => c.can('leave.apply') },
  { key: '/attendance', label: 'Attendance', icon: <ClockCircleOutlined />, show: (c: Check) => c.can('attendance.self') },
  { key: '/holidays', label: 'Holidays', icon: <GiftOutlined />, show: (c: Check) => c.tenant },
  { key: '/payroll', label: 'Payroll', icon: <WalletOutlined />, show: (c: Check) => c.can('payroll.manage') },
  { key: '/payslips', label: 'My Payslips', icon: <FileTextOutlined />, show: (c: Check) => c.can('payslip.self') },
  { key: '/settings', label: 'Settings', icon: <SettingOutlined />, show: (c: Check) => c.can('settings.write') },
];

type Check = { can: (p: string) => boolean; tenant: boolean };

export default function AppLayout() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);

  const check: Check = { can, tenant: !!user?.tenant };
  const items = MENU.filter((m) => m.show(check)).map(({ key, label, icon }) => ({ key, label, icon }));
  const name = user?.employee?.name || user?.email || '';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        breakpoint="lg"
        collapsedWidth={screens.xs ? 0 : 80}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={230}
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div className="logo">
          <span style={{ background: '#4f46e5', borderRadius: 8, width: 32, height: 32, display: 'grid', placeItems: 'center' }}>P</span>
          {!collapsed && 'PeopleDesk'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={items}
          onClick={(e) => {
            navigate(e.key);
            if (screens.xs) setCollapsed(true);
          }}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eef0f4' }}>
          <Typography.Text strong style={{ fontSize: 16 }} ellipsis>
            {user?.tenant?.name || 'Platform Administration'}
          </Typography.Text>
          <Dropdown
            menu={{
              items: [
                { key: 'email', label: user?.email, disabled: true },
                { type: 'divider' },
                { key: 'profile', label: 'My Profile', icon: <UserOutlined />, onClick: () => navigate('/profile') },
                { key: 'logout', label: 'Logout', icon: <LogoutOutlined />, danger: true, onClick: logout },
              ],
            }}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar src={user?.avatarUrl || undefined} style={{ background: '#4f46e5' }}>{name.charAt(0).toUpperCase()}</Avatar>
              {screens.md && (
                <>
                  <span>{name}</span>
                  <Tag color={ROLE_COLOR[user!.role]}>{ROLE_LABEL[user!.role]}</Tag>
                </>
              )}
            </Space>
          </Dropdown>
        </Header>
        <Content style={{ padding: screens.xs ? 16 : 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
