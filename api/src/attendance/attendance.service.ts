import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendanceStatus, Employee, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, requireEmployee } from '../common/auth';
import { hasPermission, P } from '../common/permissions';
import { dateKey, eachDay, isWeekend, monthRange, toDate, todayIST } from '../common/dates';
import { HierarchyService } from '../common/hierarchy';

/** Attendance policy: worked minutes needed for a full day; less than this counts as a half day. */
export const FULL_DAY_MINUTES = 6 * 60;

export type DayType = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'UNPAID_LEAVE' | 'HOLIDAY' | 'WEEKEND' | 'UPCOMING' | 'NOT_EMPLOYED';

export interface MonthSummary {
  daysInMonth: number;
  workingDays: number;
  present: number;
  halfDays: number;
  absent: number;
  paidLeave: number;
  unpaidLeave: number;
  holidays: number;
  notEmployed: number;
  lopDays: number;
  paidDays: number;
  days: { date: string; type: DayType; clockIn?: Date | null; clockOut?: Date | null; workMinutes?: number; note?: string }[];
}

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService, private hierarchy: HierarchyService) {}

  today(u: AuthUser) {
    return this.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: requireEmployee(u), date: todayIST() } },
    });
  }

  async clockIn(u: AuthUser) {
    const employeeId = requireEmployee(u);
    const date = todayIST();
    const existing = await this.prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date } } });
    if (existing?.clockIn) throw new BadRequestException('Already clocked in today');
    return this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date } },
      create: { tenantId: u.tenantId, employeeId, date, clockIn: new Date(), status: 'PRESENT' },
      update: { clockIn: new Date(), status: 'PRESENT' },
    });
  }

  async clockOut(u: AuthUser) {
    const employeeId = requireEmployee(u);
    const rec = await this.prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: todayIST() } } });
    if (!rec?.clockIn) throw new BadRequestException('You have not clocked in today');
    if (rec.clockOut) throw new BadRequestException('Already clocked out today');
    const clockOut = new Date();
    const workMinutes = Math.round((clockOut.getTime() - rec.clockIn.getTime()) / 60000);
    return this.prisma.attendance.update({
      where: { id: rec.id },
      data: { clockOut, workMinutes, status: workMinutes >= FULL_DAY_MINUTES ? 'PRESENT' : 'HALF_DAY' },
    });
  }

  /** HR correction: set an employee's status for a date. */
  async mark(u: AuthUser, employeeId: string, date: string, status: AttendanceStatus) {
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, tenantId: u.tenantId } });
    if (!emp) throw new BadRequestException('Employee not found');
    const d = toDate(date);
    return this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: d } },
      create: { tenantId: u.tenantId, employeeId, date: d, status },
      update: { status },
    });
  }

  /** Attendance on one date: whole company (HR/payroll) or everyone the user leads (reports + departments they head). */
  async byDate(u: AuthUser, date?: string) {
    const d = date ? toDate(date) : todayIST();
    const where: Prisma.EmployeeWhereInput = { tenantId: u.tenantId, status: 'ACTIVE' };
    if (!hasPermission(u.role, P.ATTENDANCE_ALL)) where.id = { in: await this.hierarchy.teamIds(u.tenantId, u.employeeId) };

    const employees = await this.prisma.employee.findMany({
      where,
      include: {
        department: { select: { name: true } },
        attendance: { where: { date: d } },
        leaveRequests: { where: { status: 'APPROVED', fromDate: { lte: d }, toDate: { gte: d } }, include: { leaveType: true } },
      },
      orderBy: { code: 'asc' },
    });
    return employees.map((e) => ({
      employeeId: e.id,
      code: e.code,
      name: `${e.firstName} ${e.lastName}`,
      department: e.department?.name,
      attendance: e.attendance[0] || null,
      leave: e.leaveRequests[0] ? { type: e.leaveRequests[0].leaveType.code, halfDay: e.leaveRequests[0].halfDay } : null,
    }));
  }

  /** Classifies every day of a month for one employee. Payroll uses this for LOP and paid days. */
  async monthSummary(tenantId: string, employee: Employee, year: number, month: number): Promise<MonthSummary> {
    const { start, end, days: daysInMonth } = monthRange(year, month);
    const today = todayIST();
    const [records, leaves, holidays] = await Promise.all([
      this.prisma.attendance.findMany({ where: { employeeId: employee.id, date: { gte: start, lte: end } } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: employee.id, status: 'APPROVED', fromDate: { lte: end }, toDate: { gte: start } },
        include: { leaveType: true },
      }),
      this.prisma.holiday.findMany({ where: { tenantId, optional: false, date: { gte: start, lte: end } } }),
    ]);
    const recMap = new Map(records.map((r) => [dateKey(r.date), r]));
    const holMap = new Map(holidays.map((h) => [dateKey(h.date), h.name]));

    const s: MonthSummary = {
      daysInMonth, workingDays: 0, present: 0, halfDays: 0, absent: 0, paidLeave: 0, unpaidLeave: 0,
      holidays: 0, notEmployed: 0, lopDays: 0, paidDays: 0, days: [],
    };

    for (const d of eachDay(start, end)) {
      const key = dateKey(d);
      const rec = recMap.get(key);
      const base = { date: key, clockIn: rec?.clockIn, clockOut: rec?.clockOut, workMinutes: rec?.workMinutes };

      if (d < toDate(employee.joiningDate) || (employee.exitDate && d > toDate(employee.exitDate))) {
        s.notEmployed++;
        s.days.push({ ...base, type: 'NOT_EMPLOYED' });
        continue;
      }
      if (isWeekend(d)) {
        s.days.push({ ...base, type: 'WEEKEND' });
        continue;
      }
      if (holMap.has(key)) {
        s.holidays++;
        s.days.push({ ...base, type: 'HOLIDAY', note: holMap.get(key) });
        continue;
      }
      s.workingDays++;
      const leave = leaves.find((l) => l.fromDate <= d && l.toDate >= d);
      if (leave) {
        const portion = leave.halfDay ? 0.5 : 1;
        if (leave.leaveType.isPaid) s.paidLeave += portion;
        else {
          s.unpaidLeave += portion;
          s.lopDays += portion;
        }
        s.days.push({ ...base, type: leave.leaveType.isPaid ? 'LEAVE' : 'UNPAID_LEAVE', note: leave.leaveType.code });
        continue;
      }
      if (rec?.status === 'PRESENT' || (rec?.clockIn && !rec.clockOut)) {
        s.present++;
        s.days.push({ ...base, type: 'PRESENT' });
      } else if (rec?.status === 'HALF_DAY') {
        s.halfDays++;
        s.lopDays += 0.5;
        s.days.push({ ...base, type: 'HALF_DAY' });
      } else if (d > today) {
        s.days.push({ ...base, type: 'UPCOMING' }); // future days are assumed payable
      } else {
        s.absent++;
        s.lopDays += 1;
        s.days.push({ ...base, type: 'ABSENT' });
      }
    }
    s.paidDays = daysInMonth - s.notEmployed - s.lopDays;
    return s;
  }

  async myMonth(u: AuthUser, year: number, month: number) {
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id: requireEmployee(u) } });
    return this.monthSummary(u.tenantId, emp, year, month);
  }

  async employeeMonth(u: AuthUser, employeeId: string, year: number, month: number) {
    const emp = await this.prisma.employee.findFirstOrThrow({ where: { id: employeeId, tenantId: u.tenantId } });
    return this.monthSummary(u.tenantId, emp, year, month);
  }
}
