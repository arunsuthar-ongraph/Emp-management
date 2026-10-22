import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BillingCycle, Plan, Prisma, Subscription, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notifications/mail.service';
import { emailLayout, esc } from '../notifications/email-layout';

/** Modules a plan can include. */
export const FEATURES: Record<string, string> = {
  leave: 'Leave management',
  attendance: 'Attendance & check-in',
  payroll: 'Payroll & payslips',
};

export const GRACE_DAYS = 7;
const INVOICE_AHEAD_DAYS = 7; // invoice this many days before a period ends
const GST_RATE = 0.18;
const DAY = 86400000;

export type Access = 'FULL' | 'GRACE' | 'READ_ONLY';

export interface AccessInfo {
  access: Access;
  status: SubscriptionStatus;
  endsAt: Date | null; // end of trial or paid period
  daysLeft: number; // days until endsAt (negative once passed)
  readOnlyFrom: Date | null;
  plan: { id: string; code: string; name: string; maxEmployees: number | null };
  features: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const addMonths = (d: Date, n: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
};

@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Billing');
  private cache = new Map<string, { info: AccessInfo; at: number }>();
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, private mail: MailService) {}

  // Billing run on start and every 6 hours (status changes, renewal invoices, emails)
  onModuleInit() {
    if (process.env.BILLING_JOB === 'off') return;
    setTimeout(() => void this.runBilling().catch((e) => this.log.error(e.message)), 5000);
    this.timer = setInterval(() => void this.runBilling().catch((e) => this.log.error(e.message)), 6 * 3600 * 1000);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- Access ----------
  private static compute(sub: Subscription & { plan: Plan }, now = new Date()): AccessInfo {
    const endsAt = sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd;
    const end = endsAt?.getTime() ?? 0;
    const graceEnd = end + GRACE_DAYS * DAY;
    let access: Access;
    let status: SubscriptionStatus = sub.status;
    if (sub.status === 'CANCELLED') {
      access = now.getTime() <= end ? 'FULL' : 'READ_ONLY';
    } else if (now.getTime() <= end) {
      access = 'FULL';
      if (status === 'PAST_DUE' || status === 'EXPIRED') status = 'ACTIVE';
    } else if (now.getTime() <= graceEnd) {
      access = 'GRACE';
      status = 'PAST_DUE';
    } else {
      access = 'READ_ONLY';
      status = 'EXPIRED';
    }
    return {
      access,
      status,
      endsAt,
      daysLeft: Math.ceil((end - now.getTime()) / DAY),
      readOnlyFrom: endsAt ? new Date(sub.status === 'CANCELLED' ? end : graceEnd) : null,
      plan: { id: sub.plan.id, code: sub.plan.code, name: sub.plan.name, maxEmployees: sub.plan.maxEmployees },
      features: sub.plan.features,
    };
  }

  /** Access state for a company, cached for 60 s (checked on every request). */
  async access(tenantId: string): Promise<AccessInfo> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < 60000) return hit.info;
    const sub = (await this.prisma.subscription.findUnique({ where: { tenantId }, include: { plan: true } })) || (await this.startTrial(tenantId));
    const info = BillingService.compute(sub);
    this.cache.set(tenantId, { info, at: Date.now() });
    return info;
  }

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  async assertCanAddEmployee(tenantId: string) {
    const { plan } = await this.access(tenantId);
    if (plan.maxEmployees === null) return;
    const active = await this.prisma.employee.count({ where: { tenantId, status: 'ACTIVE' } });
    if (active >= plan.maxEmployees) {
      throw new ForbiddenException(`Your ${plan.name} plan allows up to ${plan.maxEmployees} active employee(s). Upgrade the plan in Billing to add more.`);
    }
  }

  // ---------- Plans ----------
  plans(includeInactive = false) {
    return this.prisma.plan.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { pricePerEmployee: 'asc' }] });
  }

  savePlan(data: Prisma.PlanCreateInput, id?: string) {
    const bad = data.features && (data.features as string[]).filter((f) => !FEATURES[f]);
    if (bad?.length) throw new BadRequestException(`Unknown features: ${bad.join(', ')}`);
    this.cache.clear();
    return id ? this.prisma.plan.update({ where: { id }, data }) : this.prisma.plan.create({ data });
  }

  private async defaultPlan() {
    const plan = (await this.prisma.plan.findFirst({ where: { code: 'growth', isActive: true } })) || (await this.prisma.plan.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }));
    if (!plan) throw new BadRequestException('No active subscription plan. Create a plan first.');
    return plan;
  }

  /** New companies start on a free trial of the chosen (or default) plan. */
  async startTrial(tenantId: string, planId?: string, tx: Prisma.TransactionClient = this.prisma) {
    const plan = planId ? await tx.plan.findUniqueOrThrow({ where: { id: planId } }) : await this.defaultPlan();
    return tx.subscription.create({
      data: { tenantId, planId: plan.id, status: 'TRIALING', trialEndsAt: new Date(Date.now() + plan.trialDays * DAY) },
      include: { plan: true },
    });
  }

  // ---------- Company admin ----------
  async overview(tenantId: string) {
    const info = await this.access(tenantId);
    const [sub, activeEmployees, invoices, plans] = await Promise.all([
      this.prisma.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
      this.prisma.employee.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.invoice.findMany({ where: { tenantId }, include: { plan: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
      this.plans(),
    ]);
    const estimate = this.price(sub.plan, sub.billingCycle, activeEmployees);
    return { ...info, subscription: sub, activeEmployees, estimate, invoices, plans, features: FEATURES, graceDays: GRACE_DAYS };
  }

  /** Amount for a plan, cycle and employee count (minimum monthly charge applies). */
  price(plan: Plan, cycle: BillingCycle, employees: number) {
    const months = cycle === 'YEARLY' ? 10 : 1;
    const monthly = Math.max(Number(plan.minMonthly), employees * Number(plan.pricePerEmployee));
    const subtotal = round2(monthly * months);
    return { months, monthly: round2(monthly), subtotal, gst: round2(subtotal * GST_RATE), total: round2(subtotal * (1 + GST_RATE)) };
  }

  /**
   * Choose or change plan. Features and limits change immediately; the price applies from the
   * next invoice. An unpaid upcoming invoice is re-issued with the new plan.
   */
  async changePlan(tenantId: string, planId: string, cycle: BillingCycle) {
    const plan = await this.prisma.plan.findFirst({ where: { id: planId, isActive: true } });
    if (!plan) throw new BadRequestException('Plan not available');
    const active = await this.prisma.employee.count({ where: { tenantId, status: 'ACTIVE' } });
    if (plan.maxEmployees !== null && active > plan.maxEmployees) {
      throw new BadRequestException(`You have ${active} active employees; the ${plan.name} plan allows ${plan.maxEmployees}.`);
    }
    const sub = await this.prisma.subscription.update({ where: { tenantId }, data: { planId, billingCycle: cycle }, include: { plan: true } });
    const due = await this.prisma.invoice.findMany({ where: { subscriptionId: sub.id, status: 'DUE' } });
    for (const inv of due) await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: 'VOID', notes: 'Replaced after plan change' } });
    this.invalidate(tenantId);
    // Out of trial/period already, or the old invoice was replaced: issue one now
    const info = await this.access(tenantId);
    if (due.length || info.access !== 'FULL' || info.daysLeft <= INVOICE_AHEAD_DAYS) await this.issueUpcoming(sub.id);
    return this.overview(tenantId);
  }

  // ---------- Invoices ----------
  private async nextNumber(tx: Prisma.TransactionClient) {
    const year = new Date().getUTCFullYear();
    const count = await tx.invoice.count({ where: { number: { startsWith: `INV-${year}-` } } });
    return `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  /** Invoice for the period after the current trial/period (or from today if already lapsed). Idempotent. */
  async issueUpcoming(subscriptionId: string) {
    const sub = await this.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId }, include: { plan: true, tenant: true } });
    const now = new Date();
    const end = sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd;
    const periodStart = end && end > now ? end : now;
    const existing = await this.prisma.invoice.findFirst({
      where: { subscriptionId, status: { in: ['DUE', 'PAID'] }, periodEnd: { gt: periodStart } },
    });
    if (existing) return existing;

    const employees = Math.max(1, await this.prisma.employee.count({ where: { tenantId: sub.tenantId, status: 'ACTIVE' } }));
    const p = this.price(sub.plan, sub.billingCycle, employees);
    const sameState = (process.env.BILLING_STATE || 'MH') === sub.tenant.state;
    const invoice = await this.prisma.$transaction(async (tx) => {
      // An older unpaid invoice for a period that has fully passed is replaced by this one
      await tx.invoice.updateMany({ where: { subscriptionId, status: 'DUE' }, data: { status: 'VOID', notes: 'Superseded by a newer invoice' } });
      return tx.invoice.create({
        data: {
          number: await this.nextNumber(tx),
          tenantId: sub.tenantId,
          subscriptionId,
          planId: sub.planId,
          billingCycle: sub.billingCycle,
          periodStart,
          periodEnd: addMonths(periodStart, sub.billingCycle === 'YEARLY' ? 12 : 1),
          employeeCount: employees,
          unitPrice: sub.plan.pricePerEmployee,
          months: p.months,
          subtotal: p.subtotal,
          cgst: sameState ? round2(p.gst / 2) : 0,
          sgst: sameState ? round2(p.gst / 2) : 0,
          igst: sameState ? 0 : p.gst,
          total: p.total,
          dueDate: periodStart,
        },
      });
    });
    this.notifyAdmins(sub.tenantId, `Invoice ${invoice.number} for ${sub.plan.name}`, 'Your subscription invoice is ready',
      `<p>Invoice <b>${esc(invoice.number)}</b> of <b>₹${Number(invoice.total).toLocaleString('en-IN')}</b> (incl. GST) is due by <b>${invoice.dueDate.toDateString()}</b>.</p>
       <p>${employees} active employees × ₹${Number(invoice.unitPrice)} × ${p.months} month(s), ${esc(sub.plan.name)} plan.</p>`);
    return invoice;
  }

  async invoice(id: string, tenantId?: string) {
    const inv = await this.prisma.invoice.findFirst({
      where: { id, ...(tenantId && { tenantId }) },
      include: { tenant: true, plan: true },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return {
      ...inv,
      seller: {
        name: process.env.BILLING_COMPANY || 'PeopleDesk Software Pvt Ltd',
        address: process.env.BILLING_ADDRESS || '',
        gstin: process.env.BILLING_GSTIN || '',
        paymentInfo: process.env.BILLING_PAYMENT_INFO || '',
      },
    };
  }

  /** Super admin records a manual payment; the subscription moves to the invoice's period. */
  async markPaid(id: string, method: string, ref?: string) {
    const inv = await this.prisma.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== 'DUE') throw new BadRequestException(`Invoice is ${inv.status.toLowerCase()}`);
    await this.prisma.$transaction([
      this.prisma.invoice.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), paymentMethod: method, paymentRef: ref } }),
      this.prisma.subscription.update({
        where: { id: inv.subscriptionId },
        data: { status: 'ACTIVE', planId: inv.planId, billingCycle: inv.billingCycle, currentPeriodStart: inv.periodStart, currentPeriodEnd: inv.periodEnd },
      }),
    ]);
    this.invalidate(inv.tenantId);
    this.notifyAdmins(inv.tenantId, `Payment received for ${inv.number}`, 'Thank you, your payment was received',
      `<p>We received ₹${Number(inv.total).toLocaleString('en-IN')} for invoice <b>${esc(inv.number)}</b>${ref ? ` (ref ${esc(ref)})` : ''}.
       Your subscription is active until <b>${inv.periodEnd.toDateString()}</b>.</p>`);
    return this.invoice(id);
  }

  async voidInvoice(id: string, reason?: string) {
    const inv = await this.prisma.invoice.findUniqueOrThrow({ where: { id } });
    if (inv.status !== 'DUE') throw new BadRequestException('Only unpaid invoices can be voided');
    return this.prisma.invoice.update({ where: { id }, data: { status: 'VOID', notes: reason || 'Voided by admin' } });
  }

  // ---------- Super admin ----------
  async tenantSubscription(tenantId: string) {
    return { ...(await this.overview(tenantId)), allPlans: await this.plans(true) };
  }

  /** Super admin override: plan, cycle, status, trial end or period end. */
  async adminUpdate(tenantId: string, data: { planId?: string; billingCycle?: BillingCycle; status?: SubscriptionStatus; trialEndsAt?: string; currentPeriodEnd?: string }) {
    await this.access(tenantId); // ensures a subscription exists
    await this.prisma.subscription.update({
      where: { tenantId },
      data: {
        planId: data.planId,
        billingCycle: data.billingCycle,
        status: data.status,
        trialEndsAt: data.trialEndsAt ? new Date(data.trialEndsAt) : undefined,
        currentPeriodEnd: data.currentPeriodEnd ? new Date(data.currentPeriodEnd) : undefined,
      },
    });
    this.invalidate(tenantId);
    return this.tenantSubscription(tenantId);
  }

  /**
   * Periodic job: saves status changes (with emails when a company enters grace or read-only)
   * and issues invoices for periods ending within INVOICE_AHEAD_DAYS.
   */
  async runBilling() {
    const subs = await this.prisma.subscription.findMany({ include: { plan: true, tenant: { select: { isActive: true } } } });
    let changed = 0;
    let invoiced = 0;
    for (const sub of subs) {
      if (!sub.tenant.isActive) continue;
      const info = BillingService.compute(sub);
      if (info.status !== sub.status && sub.status !== 'CANCELLED') {
        await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: info.status } });
        changed++;
        if (info.status === 'PAST_DUE') {
          this.notifyAdmins(sub.tenantId, 'Payment due: subscription period ended', 'Your subscription needs renewal',
            `<p>Your ${sub.status === 'TRIALING' ? 'trial' : 'subscription'} has ended. Everything keeps working for <b>${GRACE_DAYS} days</b>; after that your account becomes read-only until the invoice is paid.</p>`);
        }
        if (info.status === 'EXPIRED') {
          this.notifyAdmins(sub.tenantId, 'Account is now read-only', 'Your account is read-only',
            `<p>The grace period has ended. Your team can still sign in and view data, but nothing new can be added until the subscription is renewed.</p>`);
        }
      }
      if (sub.status !== 'CANCELLED' && info.daysLeft <= INVOICE_AHEAD_DAYS) {
        const before = await this.prisma.invoice.count({ where: { subscriptionId: sub.id } });
        await this.issueUpcoming(sub.id);
        if ((await this.prisma.invoice.count({ where: { subscriptionId: sub.id } })) > before) invoiced++;
      }
    }
    this.cache.clear();
    this.log.log(`billing run: ${subs.length} subscriptions, ${changed} status changes, ${invoiced} invoices issued`);
    return { subscriptions: subs.length, statusChanges: changed, invoicesIssued: invoiced };
  }

  private notifyAdmins(tenantId: string, subject: string, title: string, body: string) {
    void (async () => {
      const [tenant, admins] = await Promise.all([
        this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
        this.prisma.user.findMany({ where: { tenantId, role: 'COMPANY_ADMIN', isActive: true }, select: { email: true } }),
      ]);
      const url = `${(process.env.APP_URL || 'http://{slug}.localhost:5173').replace('{slug}', tenant.slug)}/billing`;
      this.mail.send({ to: admins.map((a) => a.email), subject, html: emailLayout(tenant.name, title, body, { url, label: 'Open Billing' }) });
    })().catch((e) => this.log.error(`billing email failed: ${e.message}`));
  }
}
