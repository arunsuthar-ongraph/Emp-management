import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { emailLayout, esc } from './email-layout';

/**
 * Leave emails:
 *  - requested  → current approver (or HR/Admin if none) + confirmation to employee
 *  - forwarded  → next approver in the chain
 *  - decided    → employee (approved / rejected, with comment)
 *  - cancelled  → whoever was waiting on it, or the approvers if it was already approved
 */

const fmt = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

type Person = { firstName: string; lastName: string; email: string; user: { email: string; isActive: boolean } | null } | null;
const nameOf = (p: Person) => (p ? `${p.firstName} ${p.lastName}` : 'HR / Admin');
const emailOf = (p: Person) => (p ? (p.user?.isActive ? p.user.email : null) : null);

const person = { select: { firstName: true, lastName: true, email: true, user: { select: { email: true, isActive: true } } } };

@Injectable()
export class LeaveNotifier {
  private log = new Logger('LeaveNotifier');
  constructor(private prisma: PrismaService, private mail: MailService) {}

  /** Never let a notification problem affect the leave action itself. */
  private run(fn: () => Promise<void>) {
    fn().catch((e) => this.log.error(`notification failed: ${(e as Error).message}`));
  }

  private load(id: string) {
    return this.prisma.leaveRequest.findUniqueOrThrow({
      where: { id },
      include: {
        employee: person,
        leaveType: true,
        currentApprover: person,
        approvals: { orderBy: { level: 'asc' }, include: { approver: person, actedBy: { select: { email: true, isActive: true, employee: { select: { firstName: true, lastName: true } } } } } },
      },
    });
  }

  /** HR/Admin queue recipients, never including the person who asked for the leave. */
  private async hrEmails(tenantId: string, requesterId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: ['HR_ADMIN', 'COMPANY_ADMIN'] }, OR: [{ employeeId: null }, { employeeId: { not: requesterId } }] },
      select: { email: true },
    });
    return users.map((u) => u.email);
  }

  private async context(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const base = (process.env.APP_URL || 'http://{slug}.localhost:5173').replace('{slug}', t.slug);
    return { company: t.name, leaveUrl: `${base}/leave` };
  }

  private details(r: Awaited<ReturnType<LeaveNotifier['load']>>) {
    const range = r.fromDate.getTime() === r.toDate.getTime() ? fmt(r.fromDate) : `${fmt(r.fromDate)} → ${fmt(r.toDate)}`;
    const row = (k: string, v: string) => `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">${k}</td><td style="padding:6px 0">${v}</td></tr>`;
    return `<table style="border-collapse:collapse;font-size:14px;margin:12px 0">
      ${row('Employee', `${esc(nameOf(r.employee))}`)}
      ${row('Leave type', `${esc(r.leaveType.name)} (${esc(r.leaveType.code)})${r.leaveType.isPaid ? '' : ' · unpaid'}`)}
      ${row('Dates', esc(range))}
      ${row('Days', `${Number(r.days)}${r.halfDay ? ' (half day)' : ''}`)}
      ${r.reason ? row('Reason', esc(r.reason)) : ''}
    </table>`;
  }

  /** New request: ask the first approver, confirm to the employee. */
  requested(id: string) {
    this.run(async () => {
      const r = await this.load(id);
      const { company, leaveUrl } = await this.context(r.tenantId);
      const step = r.approvals.find((a) => a.level === r.currentLevel);
      const to = r.currentApproverId ? [emailOf(r.currentApprover)] : await this.hrEmails(r.tenantId, r.employeeId);
      const who = esc(nameOf(r.employee));

      this.mail.send({
        to: to.filter(Boolean) as string[],
        subject: `Leave request from ${nameOf(r.employee)}: ${r.leaveType.code}, ${Number(r.days)} day(s)`,
        html: emailLayout(company, `${who} has requested leave`,
          `<p>Your approval is needed${step && r.approvals.length > 1 ? ` as <b>${esc(step.role)}</b> (step ${step.level} of ${r.approvals.length})` : ''}.</p>${this.details(r)}`,
          { url: leaveUrl, label: 'Review request' }),
      });
      this.mail.send({
        to: emailOf(r.employee) || [],
        subject: `Leave request submitted: ${r.leaveType.code}, ${fmt(r.fromDate)}`,
        html: emailLayout(company, 'Your leave request has been submitted',
          `<p>It is now waiting for <b>${esc(nameOf(r.currentApprover))}</b>. We'll email you when it's decided.</p>${this.details(r)}`,
          { url: leaveUrl, label: 'View my requests' }),
      });
    });
  }

  /** Approved at one level and moved to the next approver. */
  forwarded(id: string) {
    this.run(async () => {
      const r = await this.load(id);
      const { company, leaveUrl } = await this.context(r.tenantId);
      const prev = r.approvals.find((a) => a.level === r.currentLevel - 1);
      const step = r.approvals.find((a) => a.level === r.currentLevel);
      const prevBy = prev?.actedBy?.employee ? `${prev.actedBy.employee.firstName} ${prev.actedBy.employee.lastName}` : nameOf(prev?.approver ?? null);
      const to = r.currentApproverId ? [emailOf(r.currentApprover)] : await this.hrEmails(r.tenantId, r.employeeId);

      this.mail.send({
        to: to.filter(Boolean) as string[],
        subject: `Leave request from ${nameOf(r.employee)} awaits your approval`,
        html: emailLayout(company, `${esc(nameOf(r.employee))}'s leave needs your approval`,
          `<p>Approved by <b>${esc(prevBy)}</b>${prev ? ` (${esc(prev.role)})` : ''}${prev?.comment ? `: “${esc(prev.comment)}”` : ''}.
           You are the next approver${step ? ` as <b>${esc(step.role)}</b> (step ${step.level} of ${r.approvals.length})` : ''}.</p>${this.details(r)}`,
          { url: leaveUrl, label: 'Review request' }),
      });
    });
  }

  /** Final decision → employee. */
  decided(id: string) {
    this.run(async () => {
      const r = await this.load(id);
      const { company, leaveUrl } = await this.context(r.tenantId);
      const last = [...r.approvals].reverse().find((a) => a.status === 'APPROVED' || a.status === 'REJECTED');
      const by = last?.actedBy?.employee ? `${last.actedBy.employee.firstName} ${last.actedBy.employee.lastName}` : last?.actedBy?.email || 'HR';
      const approved = r.status === 'APPROVED';

      this.mail.send({
        to: emailOf(r.employee) || [],
        subject: `Leave ${approved ? 'approved' : 'rejected'}: ${r.leaveType.code}, ${fmt(r.fromDate)}`,
        html: emailLayout(company, approved ? '✅ Your leave has been approved' : '❌ Your leave request was rejected',
          `<p>${approved ? 'Approved' : 'Rejected'} by <b>${esc(by)}</b>.</p>
           ${r.approverComment ? `<p style="background:#f3f4f6;padding:10px 12px;border-radius:8px">“${esc(r.approverComment)}”</p>` : ''}
           ${this.details(r)}`,
          { url: leaveUrl, label: 'View my requests' }),
      });
    });
  }

  /** Employee cancelled: tell whoever was waiting, or the approvers if it had been approved. */
  cancelled(id: string, wasStatus: string, waitingOnEmployeeId: string | null) {
    this.run(async () => {
      const r = await this.load(id);
      const { company, leaveUrl } = await this.context(r.tenantId);
      let to: (string | null)[] = [];
      if (wasStatus === 'PENDING') {
        to = waitingOnEmployeeId
          ? [emailOf((r.approvals.find((a) => a.approverId === waitingOnEmployeeId)?.approver as Person) ?? null)]
          : await this.hrEmails(r.tenantId, r.employeeId);
      } else {
        to = r.approvals.filter((a) => a.status === 'APPROVED' && a.actedBy?.isActive).map((a) => a.actedBy!.email);
      }
      this.mail.send({
        to: to.filter(Boolean) as string[],
        subject: `Leave cancelled by ${nameOf(r.employee)}: ${r.leaveType.code}, ${fmt(r.fromDate)}`,
        html: emailLayout(company, `${esc(nameOf(r.employee))} cancelled a leave request`,
          `<p>This ${wasStatus === 'PENDING' ? 'pending' : 'approved'} request has been withdrawn. No action is needed.</p>${this.details(r)}`,
          { url: leaveUrl, label: 'Open Leave' }),
      });
    });
  }
}
