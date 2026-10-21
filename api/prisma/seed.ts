import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createTenantDefaults } from '../src/common/tenant-defaults';
import { addDays, eachDay, isWeekend, monthRange, todayIST } from '../src/common/dates';
import { AuthUser } from '../src/common/auth';
import { HierarchyService } from '../src/common/hierarchy';
import { AttendanceService } from '../src/attendance/attendance.service';
import { LeaveService } from '../src/leave/leave.service';
import { PayrollService } from '../src/payroll/payroll.module';

const prisma = new PrismaClient();
const PASSWORD = 'Password@123';
const COMPANY = 'Acme Technologies Pvt Ltd';

// Deterministic pseudo-random so every seed run looks the same
let s = 42;
const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);

type Person = { first: string; last: string; email: string; dept: string; desg: string; ctc: number; role?: Role; manager?: string; gender: string };

// Leadership and department heads. Everyone with `role` gets a login.
const LEADS: Person[] = [
  { first: 'Rahul', last: 'Mehta', email: 'admin@acme.com', dept: 'Management', desg: 'Director', ctc: 3600000, role: 'COMPANY_ADMIN', gender: 'Male' },
  { first: 'Priya', last: 'Sharma', email: 'hr@acme.com', dept: 'Human Resources', desg: 'HR Executive', ctc: 900000, role: 'HR_ADMIN', manager: 'admin@acme.com', gender: 'Female' },
  { first: 'Anil', last: 'Gupta', email: 'payroll@acme.com', dept: 'Finance', desg: 'Accountant', ctc: 1000000, role: 'PAYROLL_ADMIN', manager: 'admin@acme.com', gender: 'Male' },
  { first: 'Vikram', last: 'Singh', email: 'manager@acme.com', dept: 'Engineering', desg: 'Manager', ctc: 2400000, role: 'MANAGER', manager: 'admin@acme.com', gender: 'Male' },
  // Technology stack heads: ordinary employee logins, approve leave because they head a department
  { first: 'Arjun', last: 'Nair', email: 'lead.php@acme.com', dept: 'PHP', desg: 'Tech Lead', ctc: 1400000, role: 'EMPLOYEE', manager: 'manager@acme.com', gender: 'Male' },
  { first: 'Rohit', last: 'Verma', email: 'lead@acme.com', dept: 'MERN', desg: 'Tech Lead', ctc: 1600000, role: 'EMPLOYEE', manager: 'manager@acme.com', gender: 'Male' },
  { first: 'Kavya', last: 'Reddy', email: 'lead.mean@acme.com', dept: 'MEAN', desg: 'Tech Lead', ctc: 1400000, role: 'EMPLOYEE', manager: 'manager@acme.com', gender: 'Female' },
  { first: 'Farhan', last: 'Ali', email: 'lead.python@acme.com', dept: 'Python', desg: 'Tech Lead', ctc: 1500000, role: 'EMPLOYEE', manager: 'manager@acme.com', gender: 'Male' },
  { first: 'Neha', last: 'Joshi', email: 'lead.qa@acme.com', dept: 'QA', desg: 'Tech Lead', ctc: 1100000, role: 'EMPLOYEE', manager: 'manager@acme.com', gender: 'Female' },
  // MERN team lead (between employees and the MERN head)
  { first: 'Aditya', last: 'Kulkarni', email: 'teamlead@acme.com', dept: 'MERN', desg: 'Team Lead', ctc: 1200000, role: 'EMPLOYEE', manager: 'lead@acme.com', gender: 'Male' },
  { first: 'Sneha', last: 'Patel', email: 'employee@acme.com', dept: 'MERN', desg: 'Senior Engineer', ctc: 1000000, role: 'EMPLOYEE', manager: 'teamlead@acme.com', gender: 'Female' },
];

// Team members (no login needed): [dept, manager email, count]
const TEAMS: [string, string, number][] = [
  ['PHP', 'lead.php@acme.com', 4],
  ['MERN', 'teamlead@acme.com', 3],
  ['MERN', 'lead@acme.com', 2],
  ['MEAN', 'lead.mean@acme.com', 3],
  ['Python', 'lead.python@acme.com', 4],
  ['QA', 'lead.qa@acme.com', 3],
  ['Human Resources', 'hr@acme.com', 1],
  ['Finance', 'payroll@acme.com', 1],
];
const FIRST = ['Amit', 'Pooja', 'Karan', 'Riya', 'Nikhil', 'Ananya', 'Varun', 'Ishita', 'Siddharth', 'Tanvi', 'Manish', 'Divya', 'Harsh', 'Sakshi', 'Yash', 'Shruti', 'Gaurav', 'Nisha', 'Pranav', 'Megha', 'Kunal'];
const LAST = ['Shah', 'Desai', 'Rao', 'Pillai', 'Chopra', 'Bhatt', 'Menon', 'Saxena', 'Kapoor', 'Agarwal', 'Jain', 'Thakur', 'Bose'];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const today = todayIST();
  const year = today.getUTCFullYear();

  // Reset previous demo data only (leave requests first: their approval steps reference employees too)
  const old = await prisma.tenant.findMany({ where: { OR: [{ name: COMPANY }, { slug: 'acme' }] }, select: { id: true } });
  await prisma.leaveRequest.deleteMany({ where: { tenantId: { in: old.map((t) => t.id) } } });
  await prisma.tenant.deleteMany({ where: { id: { in: old.map((t) => t.id) } } });
  await prisma.user.deleteMany({ where: { email: 'superadmin@hrms.local', tenantId: null } });
  await prisma.user.create({ data: { email: 'superadmin@hrms.local', passwordHash, role: 'SUPER_ADMIN' } });

  const tenant = await prisma.tenant.create({
    data: { name: COMPANY, slug: 'acme', state: 'MH', address: 'Baner Road, Pune, Maharashtra 411045', pan: 'AAACA1234A', tan: 'PNEA12345B', pfCode: 'MHPUN1234567', esiCode: '33000123450001001', leaveApprovalFlow: 'MANAGER_THEN_HEAD' },
  });
  await prisma.$transaction((tx) => createTenantDefaults(tx, tenant.id));
  await prisma.designation.createMany({ data: ['Tech Lead', 'Team Lead', 'QA Engineer'].map((name) => ({ tenantId: tenant.id, name })) });

  // Engineering is split by technology stack
  const engineering = await prisma.department.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'Engineering' } });
  await prisma.department.createMany({
    data: ['PHP', 'MERN', 'MEAN', 'Python', 'QA'].map((name) => ({ tenantId: tenant.id, name, parentId: engineering.id })),
  });

  const dept = Object.fromEntries((await prisma.department.findMany({ where: { tenantId: tenant.id } })).map((d) => [d.name, d.id]));
  const desg = Object.fromEntries((await prisma.designation.findMany({ where: { tenantId: tenant.id } })).map((d) => [d.name, d.id]));

  const people: Person[] = [...LEADS];
  let n = 0;
  for (const [d, manager, count] of TEAMS) {
    for (let i = 0; i < count; i++, n++) {
      const first = FIRST[n % FIRST.length];
      const last = LAST[(n * 7) % LAST.length];
      people.push({
        first, last, email: `${first}.${last}${n}@acme.com`.toLowerCase(), dept: d, manager,
        desg: d === 'QA' ? 'QA Engineer' : d === 'Human Resources' ? 'HR Executive' : d === 'Finance' ? 'Accountant' : 'Engineer',
        ctc: [240000, 360000, 480000, 600000, 720000, 900000][n % 6],
        gender: n % 2 ? 'Female' : 'Male',
      });
    }
  }

  const joinBase = new Date(Date.UTC(year - 2, 3, 1));
  const emp: Record<string, string> = {};
  for (const [i, p] of people.entries()) {
    const e = await prisma.employee.create({
      data: {
        tenantId: tenant.id,
        code: `EMP${String(i + 1).padStart(3, '0')}`,
        firstName: p.first, lastName: p.last, email: p.email, gender: p.gender,
        phone: `98${String(20000000 + i * 1371).padStart(8, '0')}`,
        joiningDate: addDays(joinBase, i * 18),
        departmentId: dept[p.dept], designationId: desg[p.desg],
        managerId: p.manager ? emp[p.manager] : null,
        pan: `ABCPE${1000 + i}F`, uan: `1009${87654320 + i}`,
        bankName: 'HDFC Bank', bankAccount: `5010023${4567890 + i}`, ifsc: 'HDFC0000123',
        ctcAnnual: p.ctc,
      },
    });
    emp[p.email] = e.id;
    if (p.role) await prisma.user.create({ data: { tenantId: tenant.id, email: p.email, passwordHash, role: p.role, employeeId: e.id } });
  }

  // Department heads
  const heads: [string, string][] = [
    ['Management', 'admin@acme.com'], ['Human Resources', 'hr@acme.com'], ['Finance', 'payroll@acme.com'], ['Engineering', 'manager@acme.com'],
    ['PHP', 'lead.php@acme.com'], ['MERN', 'lead@acme.com'], ['MEAN', 'lead.mean@acme.com'], ['Python', 'lead.python@acme.com'], ['QA', 'lead.qa@acme.com'],
  ];
  for (const [d, e] of heads) await prisma.department.update({ where: { id: dept[d] }, data: { headId: emp[e] } });

  // Holidays (dates for festivals vary each year; edit in the Holidays page)
  const holidays: [string, number, number][] = [
    ['Republic Day', 1, 26], ['Holi', 3, 4], ['Maharashtra Day', 5, 1], ['Independence Day', 8, 15],
    ['Ganesh Chaturthi', 9, 14], ['Gandhi Jayanti', 10, 2], ['Diwali', 11, 9], ['Christmas', 12, 25],
  ];
  await prisma.holiday.createMany({ data: holidays.map(([name, m, d]) => ({ tenantId: tenant.id, name, date: new Date(Date.UTC(year, m - 1, d)) })) });
  const holidaySet = new Set(holidays.map(([, m, d]) => new Date(Date.UTC(year, m - 1, d)).getTime()));

  // Attendance: two previous months + this month until yesterday
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
  const rows = [];
  for (const id of Object.values(emp)) {
    for (const d of eachDay(from, addDays(today, -1))) {
      if (isWeekend(d) || holidaySet.has(d.getTime())) continue;
      const roll = rand();
      if (roll < 0.04) continue; // absent
      const inMin = 9 * 60 + Math.floor(rand() * 60) - 330; // 9:00–10:00 IST, stored as UTC
      const worked = roll < 0.07 ? 4 * 60 + Math.floor(rand() * 60) : 8 * 60 + Math.floor(rand() * 90);
      const clockIn = new Date(d.getTime() + inMin * 60000);
      rows.push({
        tenantId: tenant.id, employeeId: id, date: d, clockIn, clockOut: new Date(clockIn.getTime() + worked * 60000), workMinutes: worked,
        status: worked >= 360 ? ('PRESENT' as const) : ('HALF_DAY' as const),
      });
    }
  }
  await prisma.attendance.createMany({ data: rows });

  // Leave requests go through the real approval chain
  const hierarchy = new HierarchyService(prisma as any);
  const leaveSvc = new LeaveService(prisma as any, hierarchy);
  for (const id of Object.values(emp)) await leaveSvc.ensureBalances(tenant.id, id, year);

  const users = await prisma.user.findMany({ where: { tenantId: tenant.id } });
  const as = (email: string): AuthUser => {
    const u = users.find((x) => x.email === email);
    return { userId: u?.id || '', tenantId: tenant.id, tenantSlug: 'acme', role: u?.role || 'EMPLOYEE', employeeId: emp[email] };
  };
  const types = Object.fromEntries((await prisma.leaveType.findMany({ where: { tenantId: tenant.id } })).map((t) => [t.code, t.id]));
  const member = (d: string) => people.find((p) => p.dept === d && !p.role)!.email;
  const workday = (offset: number) => {
    let d = addDays(today, offset);
    while (isWeekend(d) || holidaySet.has(d.getTime())) d = addDays(d, 1);
    return d.toISOString().slice(0, 10);
  };

  // [employee, type, start offset, days, reason, who acts in order ('reject:<email>' rejects)]
  const leaves: [string, string, number, number, string, string[]][] = [
    ['employee@acme.com', 'CL', -40, 1, 'Personal work', ['teamlead@acme.com', 'lead@acme.com']],
    ['employee@acme.com', 'SL', -20, 2, 'Fever', ['hr@acme.com']],
    ['employee@acme.com', 'EL', 10, 3, 'Family function', []], // waiting on team lead
    [member('MERN'), 'EL', 8, 2, 'Vacation', ['teamlead@acme.com']], // waiting on MERN head
    [member('PHP'), 'CL', 5, 1, 'Bank work', []],
    [member('MEAN'), 'LOP', -30, 2, 'Extended travel', ['lead.mean@acme.com']],
    [member('Python'), 'SL', -12, 1, 'Medical checkup', ['lead.python@acme.com']],
    [member('QA'), 'CL', 3, 1, 'Personal', []],
    [member('Human Resources'), 'CL', -8, 1, 'Short notice trip', ['reject:hr@acme.com']],
    [member('Finance'), 'EL', 15, 2, 'Vacation', []],
    ['lead.php@acme.com', 'EL', 12, 2, 'Conference', []], // PHP head → Engineering head
  ];
  for (const [email, code, offset, len, reason, actors] of leaves) {
    const fromDate = workday(offset);
    const toDate = workday(offset + len - 1 + (len > 1 ? 0 : 0));
    const req = await leaveSvc.apply(as(email), { leaveTypeId: types[code], fromDate, toDate: toDate < fromDate ? fromDate : toDate, reason });
    for (const a of actors) {
      const reject = a.startsWith('reject:');
      await leaveSvc.decide(as(a.replace('reject:', '')), req.id, !reject, reject ? 'Please plan this with more notice' : 'Approved');
    }
    const final = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: req.id } });
    if (final.status === 'APPROVED') {
      await prisma.attendance.deleteMany({ where: { employeeId: emp[email], date: { gte: final.fromDate, lte: final.toDate } } });
    }
  }

  // Finalized payroll for the last two months
  const payroll = new PayrollService(prisma as any, new AttendanceService(prisma as any, hierarchy));
  const authAs: AuthUser = { userId: '', tenantId: tenant.id, tenantSlug: 'acme', role: 'PAYROLL_ADMIN', employeeId: null };
  for (let back = 2; back >= 1; back--) {
    const { start } = monthRange(today.getUTCFullYear(), today.getUTCMonth() + 1 - back);
    const run = await payroll.create(authAs, { month: start.getUTCMonth() + 1, year: start.getUTCFullYear() });
    await payroll.finalize(authAs, run.id);
  }

  console.log(`\nSeed complete: ${people.length} employees. Company users sign in at http://acme.localhost:5173, super admin at http://localhost:5173. Password: ${PASSWORD}`);
  console.table([
    { role: 'Super Admin (platform)', email: 'superadmin@hrms.local' },
    { role: 'Company Admin', email: 'admin@acme.com' },
    { role: 'HR Admin', email: 'hr@acme.com' },
    { role: 'Payroll Admin', email: 'payroll@acme.com' },
    { role: 'Engineering Head (Manager)', email: 'manager@acme.com' },
    { role: 'MERN Head (employee login)', email: 'lead@acme.com' },
    { role: 'MERN Team Lead', email: 'teamlead@acme.com' },
    { role: 'Employee (MERN)', email: 'employee@acme.com' },
  ]);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
