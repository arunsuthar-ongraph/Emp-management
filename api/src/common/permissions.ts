import { Role } from '@prisma/client';

export const P = {
  DASHBOARD_ADMIN: 'dashboard.admin',
  EMPLOYEE_READ: 'employee.read',
  EMPLOYEE_WRITE: 'employee.write',
  ORG_WRITE: 'org.write',
  LEAVE_APPLY: 'leave.apply',
  LEAVE_APPROVE: 'leave.approve',
  LEAVE_MANAGE: 'leave.manage',
  HOLIDAY_WRITE: 'holiday.write',
  ATTENDANCE_SELF: 'attendance.self',
  ATTENDANCE_TEAM: 'attendance.team',
  ATTENDANCE_ALL: 'attendance.all',
  PAYROLL_MANAGE: 'payroll.manage',
  PAYSLIP_SELF: 'payslip.self',
  SETTINGS_WRITE: 'settings.write',
  PLATFORM_ADMIN: 'platform.admin',
  BILLING_MANAGE: 'billing.manage',
} as const;

export type Permission = (typeof P)[keyof typeof P];

const SELF: Permission[] = [P.LEAVE_APPLY, P.ATTENDANCE_SELF, P.PAYSLIP_SELF];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [P.PLATFORM_ADMIN],
  COMPANY_ADMIN: Object.values(P).filter((p) => p !== P.PLATFORM_ADMIN),
  HR_ADMIN: [
    ...SELF,
    P.DASHBOARD_ADMIN,
    P.EMPLOYEE_READ,
    P.EMPLOYEE_WRITE,
    P.ORG_WRITE,
    P.LEAVE_APPROVE,
    P.LEAVE_MANAGE,
    P.HOLIDAY_WRITE,
    P.ATTENDANCE_TEAM,
    P.ATTENDANCE_ALL,
  ],
  PAYROLL_ADMIN: [...SELF, P.DASHBOARD_ADMIN, P.EMPLOYEE_READ, P.ATTENDANCE_TEAM, P.ATTENDANCE_ALL, P.PAYROLL_MANAGE],
  MANAGER: [...SELF, P.LEAVE_APPROVE, P.ATTENDANCE_TEAM],
  EMPLOYEE: SELF,
};

export const hasPermission = (role: Role, perm: Permission) => ROLE_PERMISSIONS[role]?.includes(perm);
