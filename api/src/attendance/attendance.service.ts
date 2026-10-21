import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendanceStatus, Employee, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, requireEmployee } from '../common/auth';
import { hasPermission, P } from '../common/permissions';
import { dateKey, eachDay, isWeekend, monthRange, toDate, todayIST } from '../common/dates';
import { HierarchyService } from '../common/hierarchy';

/** Attendance policy: worked minutes needed for a full day; less than this counts as a half day. */
export const FULL_DAY_MINUTES = 6 * 60;
/** A session still open after this long is treated as a missed check-out (closed with 0 minutes). */
export const MAX_SESSION_HOURS = 16;

type SessionLite = { clockIn: Date; clockOut: Date | null; minutes: number };

export type DayType = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'LEAVE' | 'UNPAID_LEAVE' | 'HOLIDAY' | 'WEEKEND' | 'NOT_MARKED' | 'NOT_EMPLOYED';

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
  days: { date: string; type: DayType; clockIn?: Date | null; clockOut?: Date | null; workMinutes?: number; sessions?: SessionLite[]; note?: string }[];
}

@Injectable()
export class AttendanceService {
  constructor(private prisma: PrismaService, private hierarchy: HierarchyService) {}

  /** Today's day summary with all sessions, plus the open session (may have started yesterday on a night shift). */
  async today(u: AuthUser) {
    const employeeId = requireEmployee(u);
    await this.closeStale(employeeId);
    const [att, openSession] = await Promise.all([
      this.prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId, date: todayIST() } },
        include: { sessions: { orderBy: { clockIn: 'asc' } } },
      }),
      this.prisma.attendanceSession.findFirst({ where: { employeeId, clockOut: null } }),
    ]);
    return { ...(att || { date: todayIST(), clockIn: null, clockOut: null, workMinutes: 0, status: null, sessions: [] }), openSession, isIn: !!openSession };
  }

  /** Starts a new session. Allowed any number of times a day, as long as no session is open. */
  async clockIn(u: AuthUser) {
    const employeeId = requireEmployee(u);
    await this.closeStale(employeeId);
    if (await this.prisma.attendanceSession.findFirst({ where: { employeeId, clockOut: null } })) {
      throw new BadRequestException('You are already checked in. Check out first.');
    }
    const date = todayIST();
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const att = await tx.attendance.upsert({
        where: { employeeId_date: { employeeId, date } },
        create: { tenantId: u.tenantId, employeeId, date, clockIn: now, status: 'PRESENT' },
        update: { clockOut: null, status: 'PRESENT' },
      });
      await tx.attendanceSession.create({ data: { tenantId: u.tenantId, attendanceId: att.id, employeeId, clockIn: now } });
      if (!att.clockIn) await tx.attendance.update({ where: { id: att.id }, data: { clockIn: now } });
    });
    return this.today(u);
  }

  /** Closes the open session and recalculates the day's total. */
  async clockOut(u: AuthUser) {
    const employeeId = requireEmployee(u);
    await this.closeStale(employeeId);
    const open = await this.prisma.attendanceSession.findFirst({ where: { employeeId, clockOut: null } });
    if (!open) throw new BadRequestException('You are not checked in');
    const now = new Date();
    await this.prisma.attendanceSession.update({
      where: { id: open.id },
      data: { clockOut: now, minutes: Math.max(0, Math.round((now.getTime() - open.clockIn.getTime()) / 60000)) },
    });
    await this.recompute(open.attendanceId);
    return this.today(u);
  }

  /** Day summary from its sessions: first in, last out, total minutes, status. */
  private async recompute(attendanceId: string) {
    const sessions = await this.prisma.attendanceSession.findMany({ where: { attendanceId }, orderBy: { clockIn: 'asc' } });
    const open = sessions.some((x) => !x.clockOut);
    const total = sessions.reduce((a, x) => a + (x.clockOut ? x.minutes : 0), 0);
    const lastOut = sessions.filter((x) => x.clockOut).map((x) => x.clockOut!.getTime());
    await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        workMinutes: total,
        clockIn: sessions[0]?.clockIn ?? null,
        clockOut: open || !lastOut.length ? null : new Date(Math.max(...lastOut)),
        status: open || total >= FULL_DAY_MINUTES ? 'PRESENT' : 'HALF_DAY',
      },
    });
  }

  /** Missed check-out: close sessions open longer than MAX_SESSION_HOURS without crediting time. */
  private async closeStale(employeeId: string) {
    const cutoff = new Date(Date.now() - MAX_SESSION_HOURS * 3600 * 1000);
    const stale = await this.prisma.attendanceSession.findMany({ where: { employeeId, clockOut: null, clockIn: { lt: cutoff } } });
    for (const x of stale) {
      await this.prisma.attendanceSession.update({ where: { id: x.id }, data: { clockOut: x.clockIn, minutes: 0 } });
      await this.recompute(x.attendanceId);
    }
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
        attendance: { where: { date: d }, include: { sessions: { orderBy: { clockIn: 'asc' } } } },
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
      this.prisma.attendance.findMany({
        where: { employeeId: employee.id, date: { gte: start, lte: end } },
        include: { sessions: { select: { clockIn: true, clockOut: true, minutes: true }, orderBy: { clockIn: 'asc' } } },
      }),
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

    // Only days up to today are listed and counted. Future days are payable by default;
    // approved future unpaid leave still counts as loss of pay so payroll stays correct.
    for (const d of eachDay(start, end)) {
      const key = dateKey(d);
      const rec = recMap.get(key);
      const base = { date: key, clockIn: rec?.clockIn, clockOut: rec?.clockOut, workMinutes: rec?.workMinutes, sessions: rec?.sessions };
      const leave = leaves.find((l) => l.fromDate <= d && l.toDate >= d);
      const employed = d >= toDate(employee.joiningDate) && !(employee.exitDate && d > toDate(employee.exitDate));
      const workingDay = !isWeekend(d) && !holMap.has(key);

      if (!employed) s.notEmployed++;

      if (d > today) {
        if (employed && workingDay && leave && !leave.leaveType.isPaid) s.lopDays += leave.halfDay ? 0.5 : 1;
        continue;
      }

      if (!employed) {
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
      const isToday = d.getTime() === today.getTime();
      if (rec?.status === 'PRESENT' || (rec?.clockIn && (!rec.clockOut || isToday))) {
        // Today is judged only once it is over, so a short first session is not a half day yet
        s.present++;
        s.days.push({ ...base, type: 'PRESENT', note: isToday && rec?.status !== 'PRESENT' ? 'In progress' : undefined });
      } else if (rec?.status === 'HALF_DAY') {
        s.halfDays++;
        s.lopDays += 0.5;
        s.days.push({ ...base, type: 'HALF_DAY' });
      } else if (isToday && !rec) {
        s.days.push({ ...base, type: 'NOT_MARKED' }); // day in progress: not absent yet
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
