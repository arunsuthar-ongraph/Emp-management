import { BadRequestException, ForbiddenException, Injectable, Optional, NotFoundException } from '@nestjs/common';
import { LeaveStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, requireEmployee } from '../common/auth';
import { hasPermission, P } from '../common/permissions';
import { dateKey, eachDay, isWeekend, toDate, todayIST } from '../common/dates';
import { HierarchyService } from '../common/hierarchy';
import { LeaveNotifier } from '../notifications/leave-notifier';

export interface ApplyLeaveInput {
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDay?: boolean;
  reason?: string;
}

const requestInclude = {
  leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
  employee: { select: { id: true, code: true, firstName: true, lastName: true } },
  approver: { select: { email: true, employee: { select: { firstName: true, lastName: true } } } },
  currentApprover: { select: { id: true, firstName: true, lastName: true } },
  approvals: {
    orderBy: { level: 'asc' },
    include: {
      approver: { select: { firstName: true, lastName: true } },
      actedBy: { select: { email: true, role: true, employee: { select: { firstName: true, lastName: true } } } },
    },
  },
} satisfies Prisma.LeaveRequestInclude;

@Injectable()
export class LeaveService {
  constructor(
    private prisma: PrismaService,
    private hierarchy: HierarchyService,
    @Optional() private notify?: LeaveNotifier, // absent in the seed script, so no emails are sent there
  ) {}

  // ---------- Leave types ----------
  types(u: AuthUser) {
    return this.prisma.leaveType.findMany({ where: { tenantId: u.tenantId }, orderBy: { code: 'asc' } });
  }

  async saveType(u: AuthUser, data: Prisma.LeaveTypeUncheckedCreateInput, id?: string) {
    const clash = await this.prisma.leaveType.findFirst({ where: { tenantId: u.tenantId, code: data.code, NOT: id ? { id } : undefined } });
    if (clash) throw new BadRequestException(`Leave code ${data.code} already exists`);
    if (id) {
      const res = await this.prisma.leaveType.updateMany({ where: { id, tenantId: u.tenantId }, data });
      if (!res.count) throw new NotFoundException();
      // Keep this year's allocations in sync with the new quota
      await this.prisma.leaveBalance.updateMany({
        where: { leaveTypeId: id, year: todayIST().getUTCFullYear() },
        data: { allocated: data.annualQuota ?? 0 },
      });
      return this.prisma.leaveType.findUnique({ where: { id } });
    }
    return this.prisma.leaveType.create({ data: { ...data, tenantId: u.tenantId } });
  }

  // ---------- Balances ----------
  /** Lazily creates this year's balance rows from each paid leave type's annual quota. */
  async ensureBalances(tenantId: string, employeeId: string, year: number) {
    const types = await this.prisma.leaveType.findMany({ where: { tenantId, isActive: true, isPaid: true } });
    const existing = await this.prisma.leaveBalance.findMany({ where: { employeeId, year }, select: { leaveTypeId: true } });
    const have = new Set(existing.map((b) => b.leaveTypeId));
    const missing = types.filter((t) => !have.has(t.id));
    if (missing.length) {
      await this.prisma.leaveBalance.createMany({
        data: missing.map((t) => ({ tenantId, employeeId, leaveTypeId: t.id, year, allocated: t.annualQuota })),
        skipDuplicates: true,
      });
    }
  }

  async balances(u: AuthUser, employeeId: string, year = todayIST().getUTCFullYear()) {
    await this.ensureBalances(u.tenantId, employeeId, year);
    const [rows, pending] = await Promise.all([
      this.prisma.leaveBalance.findMany({
        where: { employeeId, year, leaveType: { isActive: true } },
        include: { leaveType: true },
        orderBy: { leaveType: { code: 'asc' } },
      }),
      this.prisma.leaveRequest.groupBy({
        by: ['leaveTypeId'],
        where: { employeeId, status: 'PENDING', fromDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) } },
        _sum: { days: true },
      }),
    ]);
    const pendingMap = new Map(pending.map((p) => [p.leaveTypeId, Number(p._sum.days || 0)]));
    return rows.map((b) => {
      const allocated = Number(b.allocated);
      const used = Number(b.used);
      const pend = pendingMap.get(b.leaveTypeId) || 0;
      return {
        leaveTypeId: b.leaveTypeId,
        name: b.leaveType.name,
        code: b.leaveType.code,
        allocated,
        used,
        pending: pend,
        available: allocated - used - pend,
      };
    });
  }

  // ---------- Requests ----------
  /** Working days between two dates, excluding weekends and company holidays. */
  async countDays(tenantId: string, from: Date, to: Date, halfDay: boolean) {
    const holidays = await this.prisma.holiday.findMany({ where: { tenantId, date: { gte: from, lte: to }, optional: false } });
    const off = new Set(holidays.map((h) => dateKey(h.date)));
    const days = eachDay(from, to).filter((d) => !isWeekend(d) && !off.has(dateKey(d))).length;
    return halfDay ? days * 0.5 : days;
  }

  async apply(u: AuthUser, input: ApplyLeaveInput) {
    const employeeId = requireEmployee(u);
    const from = toDate(input.fromDate);
    const to = toDate(input.toDate);
    if (to < from) throw new BadRequestException('End date must be on or after start date');
    if (from.getUTCFullYear() !== to.getUTCFullYear()) throw new BadRequestException('Leave cannot span two calendar years');
    const halfDay = !!input.halfDay && dateKey(from) === dateKey(to);

    const type = await this.prisma.leaveType.findFirst({ where: { id: input.leaveTypeId, tenantId: u.tenantId, isActive: true } });
    if (!type) throw new BadRequestException('Invalid leave type');

    const days = await this.countDays(u.tenantId, from, to, halfDay);
    if (days <= 0) throw new BadRequestException('Selected dates are weekends or holidays');

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: to }, toDate: { gte: from } },
    });
    if (overlap) throw new BadRequestException('You already have a leave request for these dates');

    if (type.isPaid) {
      const bal = (await this.balances(u, employeeId, from.getUTCFullYear())).find((b) => b.leaveTypeId === type.id);
      if (!bal || bal.available < days) {
        throw new BadRequestException(`Insufficient ${type.code} balance (available ${bal?.available ?? 0}, requested ${days})`);
      }
    }

    // Approval chain from the org hierarchy (reporting manager / department head / HR)
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
    const chain = await this.hierarchy.approvalChain(u.tenantId, employeeId, tenant.leaveApprovalFlow);

    const created = await this.prisma.leaveRequest.create({
      data: {
        tenantId: u.tenantId, employeeId, leaveTypeId: type.id, fromDate: from, toDate: to, halfDay, days, reason: input.reason,
        currentLevel: 1,
        currentApproverId: chain[0].approverId,
        approvals: {
          create: chain.map((step, i) => ({ tenantId: u.tenantId, level: i + 1, approverId: step.approverId, role: step.role })),
        },
      },
      include: requestInclude,
    });
    this.notify?.requested(created.id);
    return created;
  }

  myRequests(u: AuthUser) {
    return this.prisma.leaveRequest.findMany({
      where: { employeeId: requireEmployee(u) },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Requests waiting on this user: they are the current approver, or (HR/admin) the HR queue. */
  pendingWhere(u: AuthUser): Prisma.LeaveRequestWhereInput {
    const or: Prisma.LeaveRequestWhereInput[] = [];
    if (u.employeeId) or.push({ currentApproverId: u.employeeId });
    if (hasPermission(u.role, P.LEAVE_MANAGE)) or.push({ currentApproverId: null });
    return {
      tenantId: u.tenantId,
      status: 'PENDING',
      OR: or.length ? or : [{ id: '__none__' }],
      ...(u.employeeId && { employeeId: { not: u.employeeId } }),
    };
  }

  pendingApprovals(u: AuthUser) {
    return this.prisma.leaveRequest.findMany({ where: this.pendingWhere(u), include: requestInclude, orderBy: { fromDate: 'asc' } });
  }

  /** Requests of everyone this user leads (reports + department members), any status. */
  async teamRequests(u: AuthUser) {
    const ids = await this.hierarchy.teamIds(u.tenantId, u.employeeId);
    return this.prisma.leaveRequest.findMany({
      where: { tenantId: u.tenantId, employeeId: { in: ids } },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  allRequests(u: AuthUser, status?: LeaveStatus) {
    return this.prisma.leaveRequest.findMany({
      where: { tenantId: u.tenantId, status },
      include: requestInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  /**
   * Approve/decline one step of the chain.
   * - The current approver moves the request to the next level, or finalizes it at the last level.
   * - HR/Admin can act at any level; that decision is final (remaining steps are skipped).
   * - Nobody can act on their own request.
   */
  async decide(u: AuthUser, id: string, approve: boolean, comment?: string) {
    const req = await this.prisma.leaveRequest.findFirst({
      where: { id, tenantId: u.tenantId },
      include: { leaveType: true, approvals: { orderBy: { level: 'asc' } } },
    });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new BadRequestException(`Request is already ${req.status.toLowerCase()}`);
    if (req.employeeId === u.employeeId) throw new ForbiddenException('You cannot approve your own leave');

    const isHr = hasPermission(u.role, P.LEAVE_MANAGE);
    const isCurrent = !!u.employeeId && req.currentApproverId === u.employeeId;
    if (!isCurrent && !isHr) throw new ForbiddenException('This request is not waiting for your approval');

    const step = req.approvals.find((a) => a.level === req.currentLevel);
    const next = req.approvals.find((a) => a.level === req.currentLevel + 1);
    const override = !isCurrent; // HR acting outside their own step
    const finalDecision = !approve || !next || override;
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      if (step) {
        await tx.leaveApproval.update({
          where: { id: step.id },
          data: {
            status: approve ? 'APPROVED' : 'REJECTED',
            comment: override ? `[HR override] ${comment || ''}`.trim() : comment,
            actedById: u.userId,
            actedAt: now,
          },
        });
      }
      if (!finalDecision) {
        return tx.leaveRequest.update({
          where: { id },
          data: { currentLevel: next!.level, currentApproverId: next!.approverId },
          include: requestInclude,
        });
      }

      await tx.leaveApproval.updateMany({ where: { requestId: id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
      if (approve && req.leaveType.isPaid) {
        const year = req.fromDate.getUTCFullYear();
        const bal = await tx.leaveBalance.findUnique({
          where: { employeeId_leaveTypeId_year: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year } },
        });
        if (!bal || Number(bal.allocated) - Number(bal.used) < Number(req.days)) {
          throw new BadRequestException('Employee no longer has enough balance');
        }
        await tx.leaveBalance.update({ where: { id: bal.id }, data: { used: { increment: req.days } } });
      }
      return tx.leaveRequest.update({
        where: { id },
        data: { status: approve ? 'APPROVED' : 'REJECTED', approverId: u.userId, approverComment: comment, currentApproverId: null },
        include: requestInclude,
      });
    });
    // Emails go out only after the change is committed
    if (result.status === 'PENDING') this.notify?.forwarded(id);
    else this.notify?.decided(id);
    return result;
  }

  async cancel(u: AuthUser, id: string) {
    const req = await this.prisma.leaveRequest.findFirst({ where: { id, employeeId: requireEmployee(u) }, include: { leaveType: true } });
    if (!req) throw new NotFoundException();
    if (req.status === 'APPROVED' && req.fromDate < todayIST()) {
      throw new BadRequestException('Leave that has already started cannot be cancelled. Contact HR.');
    }
    if (!['PENDING', 'APPROVED'].includes(req.status)) throw new BadRequestException('Request cannot be cancelled');

    const result = await this.prisma.$transaction(async (tx) => {
      if (req.status === 'APPROVED' && req.leaveType.isPaid) {
        await tx.leaveBalance.updateMany({
          where: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, year: req.fromDate.getUTCFullYear() },
          data: { used: { decrement: req.days } },
        });
      }
      await tx.leaveApproval.updateMany({ where: { requestId: id, status: 'PENDING' }, data: { status: 'SKIPPED' } });
      return tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', currentApproverId: null }, include: requestInclude });
    });
    this.notify?.cancelled(id, req.status, req.currentApproverId);
    return result;
  }
}
