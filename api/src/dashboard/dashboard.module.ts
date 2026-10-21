import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser } from '../common/auth';
import { hasPermission, P } from '../common/permissions';
import { addDays, dateKey, isWeekend, monthRange, todayIST } from '../common/dates';
import { LeaveModule } from '../leave/leave.module';
import { LeaveService } from '../leave/leave.service';
import { HierarchyService } from '../common/hierarchy';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private leave: LeaveService, private hierarchy: HierarchyService) {}

  async get(u: AuthUser) {
    const today = todayIST();
    const out: Record<string, unknown> = {};

    out.upcomingHolidays = await this.prisma.holiday.findMany({
      where: { tenantId: u.tenantId, date: { gte: today } },
      orderBy: { date: 'asc' },
      take: 5,
    });

    if (u.employeeId) {
      const [balances, todayAttendance, myPending, lastPayslip] = await Promise.all([
        this.leave.balances(u, u.employeeId),
        this.prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: u.employeeId, date: today } } }),
        this.prisma.leaveRequest.count({ where: { employeeId: u.employeeId, status: 'PENDING' } }),
        this.prisma.payslip.findFirst({
          where: { employeeId: u.employeeId, payrollRun: { status: 'FINALIZED' } },
          include: { payrollRun: { select: { month: true, year: true } } },
          orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
        }),
      ]);
      out.me = { balances, todayAttendance, myPending, lastPayslip };
    }

    out.pendingApprovals = await this.prisma.leaveRequest.count({ where: this.leave.pendingWhere(u) });

    // Team stats for anyone who leads people (reporting manager or department head)
    const ids = await this.hierarchy.teamIds(u.tenantId, u.employeeId);
    if (ids.length) {
      const [present, onLeave] = await Promise.all([
        this.prisma.attendance.count({ where: { employeeId: { in: ids }, date: today } }),
        this.prisma.leaveRequest.count({ where: { employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today } } }),
      ]);
      out.team = { size: ids.length, present, onLeave };
    }

    if (hasPermission(u.role, P.DASHBOARD_ADMIN)) out.company = await this.company(u, today);
    return out;
  }

  private async company(u: AuthUser, today: Date) {
    const tenantId = u.tenantId;
    const { start: monthStart } = monthRange(today.getUTCFullYear(), today.getUTCMonth() + 1);
    const yearStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));

    // Last 7 working days for the attendance trend
    const days: Date[] = [];
    for (let d = today; days.length < 7; d = addDays(d, -1)) if (!isWeekend(d)) days.unshift(d);

    const [headcount, newJoiners, presentToday, onLeaveToday, pendingLeaves, depts, leaveTypes, leaveUsage, weekAttendance, recentRequests] =
      await Promise.all([
        this.prisma.employee.count({ where: { tenantId, status: 'ACTIVE' } }),
        this.prisma.employee.count({ where: { tenantId, joiningDate: { gte: monthStart } } }),
        this.prisma.attendance.count({ where: { tenantId, date: today } }),
        this.prisma.leaveRequest.count({ where: { tenantId, status: 'APPROVED', fromDate: { lte: today }, toDate: { gte: today } } }),
        this.prisma.leaveRequest.count({ where: { tenantId, status: 'PENDING' } }),
        this.prisma.department.findMany({
          where: { tenantId },
          select: { name: true, _count: { select: { employees: { where: { status: 'ACTIVE' } } } } },
        }),
        this.prisma.leaveType.findMany({ where: { tenantId } }),
        this.prisma.leaveRequest.groupBy({
          by: ['leaveTypeId'],
          where: { tenantId, status: 'APPROVED', fromDate: { gte: yearStart } },
          _sum: { days: true },
        }),
        this.prisma.attendance.groupBy({ by: ['date'], where: { tenantId, date: { gte: days[0], lte: today } }, _count: true }),
        this.prisma.leaveRequest.findMany({
          where: { tenantId, status: 'PENDING' },
          include: { employee: { select: { firstName: true, lastName: true } }, leaveType: { select: { code: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

    const weekMap = new Map(weekAttendance.map((w) => [dateKey(w.date), w._count]));
    const typeMap = new Map(leaveTypes.map((t) => [t.id, t.code]));

    const result: Record<string, unknown> = {
      headcount,
      newJoiners,
      presentToday,
      onLeaveToday,
      pendingLeaves,
      departments: depts.map((d) => ({ name: d.name, count: d._count.employees })).filter((d) => d.count > 0),
      leaveByType: leaveUsage.map((l) => ({ type: typeMap.get(l.leaveTypeId), days: Number(l._sum.days || 0) })),
      attendanceWeek: days.map((d) => ({ date: dateKey(d), present: weekMap.get(dateKey(d)) || 0 })),
      recentRequests,
    };

    if (hasPermission(u.role, P.PAYROLL_MANAGE)) {
      const runs = await this.prisma.payrollRun.findMany({
        where: { tenantId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        take: 6,
      });
      result.payrollTrend = runs.reverse().map((r) => ({
        label: `${r.year}-${String(r.month).padStart(2, '0')}`,
        gross: Number(r.totalGross),
        net: Number(r.totalNet),
        status: r.status,
      }));
    }
    return result;
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  @Get() get(@CurrentUser() u: AuthUser) {
    return this.svc.get(u);
  }
}

@Module({ imports: [LeaveModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
