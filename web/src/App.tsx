import { Navigate, Route, Routes } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './auth';
import AppLayout from './components/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Employees from './pages/Employees';
import Organization from './pages/Organization';
import Leave from './pages/Leave';
import Attendance from './pages/Attendance';
import Holidays from './pages/Holidays';
import Payroll from './pages/Payroll';
import Payslips from './pages/Payslips';
import Settings from './pages/Settings';
import Tenants from './pages/Tenants';

export default function App() {
  const { user, loading, can } = useAuth();

  if (loading) return <Spin fullscreen />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const home = user.role === 'SUPER_ADMIN' ? '/tenants' : '/';
  const guard = (perm: string, el: JSX.Element) => (can(perm) ? el : <Navigate to={home} replace />);

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={user.role === 'SUPER_ADMIN' ? <Navigate to="/tenants" replace /> : <Dashboard />} />
        <Route path="/tenants" element={guard('platform.admin', <Tenants />)} />
        <Route path="/employees" element={guard('employee.read', <Employees />)} />
        <Route path="/organization" element={guard('org.write', <Organization />)} />
        <Route path="/leave" element={guard('leave.apply', <Leave />)} />
        <Route path="/attendance" element={guard('attendance.self', <Attendance />)} />
        <Route path="/holidays" element={user.tenant ? <Holidays /> : <Navigate to={home} />} />
        <Route path="/payroll" element={guard('payroll.manage', <Payroll />)} />
        <Route path="/payslips" element={guard('payslip.self', <Payslips />)} />
        <Route path="/settings" element={guard('settings.write', <Settings />)} />
      </Route>
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
