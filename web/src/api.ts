import axios from 'axios';
import dayjs from 'dayjs';
import { tenantSlug } from './tenant';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const slug = tenantSlug();
  if (slug) config.headers['X-Tenant'] = slug;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !err.config.url?.startsWith('/auth/')) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

/** Readable message from a Nest error response. */
export const errMsg = (e: any): string => {
  const m = e?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || e?.message || 'Something went wrong';
};

export const get = <T = any>(url: string, params?: object) => api.get<T>(url, { params }).then((r) => r.data);

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (v: number | string | null | undefined) => inr.format(Number(v || 0));

export const fmtDate = (d?: string | null) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
export const fmtTime = (d?: string | null) => (d ? dayjs(d).format('hh:mm A') : '—');
export const monthName = (m: number, y?: number) => dayjs(new Date(2000, m - 1, 1)).format('MMMM') + (y ? ` ${y}` : '');

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  COMPANY_ADMIN: 'Company Admin',
  HR_ADMIN: 'HR Admin',
  PAYROLL_ADMIN: 'Payroll Admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

export const ROLE_COLOR: Record<string, string> = {
  SUPER_ADMIN: 'magenta',
  COMPANY_ADMIN: 'purple',
  HR_ADMIN: 'blue',
  PAYROLL_ADMIN: 'gold',
  MANAGER: 'cyan',
  EMPLOYEE: 'default',
};

export const STATUS_COLOR: Record<string, string> = {
  PENDING: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'default',
  DRAFT: 'orange',
  FINALIZED: 'green',
  ACTIVE: 'green',
  INACTIVE: 'default',
  PRESENT: 'green',
  HALF_DAY: 'gold',
  ABSENT: 'red',
  LEAVE: 'blue',
  UNPAID_LEAVE: 'volcano',
  HOLIDAY: 'purple',
  WEEKEND: 'default',
  NOT_MARKED: 'cyan',
  NOT_EMPLOYED: 'default',
};
