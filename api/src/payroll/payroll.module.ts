import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Permissions, requireEmployee } from '../common/auth';
import { hasPermission, P } from '../common/permissions';
import { monthRange, todayIST } from '../common/dates';
import { AttendanceModule } from '../attendance/attendance.module';
import { AttendanceService } from '../attendance/attendance.service';
import { annualTaxNewRegime, calculatePayslip, structureFromCtc } from './payroll-calculator';
import { STATES } from './statutory';

class RunDto {
  @IsInt() @Min(1) @Max(12) month: number;
  @IsInt() @Min(2000) year: number;
}

class CalcDto {
  @IsNumber() @Min(0) ctcAnnual: number;
  @IsOptional() @IsString() state?: string;
}

@Injectable()
export class PayrollService {
  constructor(private prisma: PrismaService, private attendance: AttendanceService) {}

  calculator(ctcAnnual: number, state: string) {
    const structure = structureFromCtc(ctcAnnual);
    const month = todayIST().getUTCMonth() + 1;
    const payslip = calculatePayslip({ ctcAnnual, state, month, daysInMonth: 30, paidDays: 30 });
    return { structure, payslip, tax: annualTaxNewRegime(structure.gross * 12) };
  }

  async employeeStructure(u: AuthUser, employeeId: string) {
    const [emp, tenant] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: employeeId, tenantId: u.tenantId } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } }),
    ]);
    if (!emp) throw new NotFoundException();
    return this.calculator(Number(emp.ctcAnnual), tenant.state);
  }

  runs(u: AuthUser) {
    return this.prisma.payrollRun.findMany({ where: { tenantId: u.tenantId }, orderBy: [{ year: 'desc' }, { month: 'desc' }] });
  }

  async run(u: AuthUser, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId: u.tenantId },
      include: {
        payslips: {
          include: { employee: { select: { code: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
          orderBy: { employee: { code: 'asc' } },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async create(u: AuthUser, dto: RunDto) {
    const t = todayIST();
    if (dto.year * 12 + dto.month > t.getUTCFullYear() * 12 + t.getUTCMonth() + 1) {
      throw new BadRequestException('Cannot run payroll for a future month');
    }
    const exists = await this.prisma.payrollRun.findFirst({ where: { tenantId: u.tenantId, month: dto.month, year: dto.year } });
    if (exists) throw new BadRequestException('Payroll for this month already exists');
    const run = await this.prisma.payrollRun.create({ data: { tenantId: u.tenantId, month: dto.month, year: dto.year } });
    return this.compute(u, run.id);
  }

  /** (Re)calculates every payslip in a draft run from current salary, attendance and leave data. */
  async compute(u: AuthUser, id: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!run) throw new NotFoundException();
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized payroll cannot be recalculated');

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
    const { start, end } = monthRange(run.year, run.month);
    const employees = await this.prisma.employee.findMany({
      where: {
        tenantId: u.tenantId,
        ctcAnnual: { gt: 0 },
        joiningDate: { lte: end },
        OR: [{ exitDate: null }, { exitDate: { gte: start } }],
      },
    });

    const payslips: (Prisma.PayslipCreateManyInput & { gross: number; totalDeductions: number; net: number; employerTotal: number })[] = [];
    for (const emp of employees) {
      const summary = await this.attendance.monthSummary(u.tenantId, emp, run.year, run.month);
      const calc = calculatePayslip({
        ctcAnnual: Number(emp.ctcAnnual),
        state: tenant.state,
        month: run.month,
        daysInMonth: summary.daysInMonth,
        paidDays: summary.paidDays,
      });
      payslips.push({
        tenantId: u.tenantId,
        payrollRunId: run.id,
        employeeId: emp.id,
        daysInMonth: summary.daysInMonth,
        paidDays: summary.paidDays,
        lopDays: summary.lopDays,
        earnings: calc.earnings,
        deductions: calc.deductions,
        employer: calc.employer,
        gross: calc.gross,
        totalDeductions: calc.totalDeductions,
        net: calc.net,
        employerTotal: calc.employer.reduce((a, e) => a + e.amount, 0),
      });
    }

    const sum = (k: 'gross' | 'totalDeductions' | 'net' | 'employerTotal') => payslips.reduce((a, p) => a + p[k], 0);
    await this.prisma.$transaction([
      this.prisma.payslip.deleteMany({ where: { payrollRunId: run.id } }),
      this.prisma.payslip.createMany({ data: payslips.map(({ employerTotal, ...p }) => p) }),
      this.prisma.payrollRun.update({
        where: { id: run.id },
        data: {
          employeeCount: payslips.length,
          totalGross: sum('gross'),
          totalDeductions: sum('totalDeductions'),
          totalNet: sum('net'),
          totalEmployer: sum('employerTotal'),
        },
      }),
    ]);
    return this.run(u, run.id);
  }

  async finalize(u: AuthUser, id: string) {
    const run = await this.run(u, id);
    if (run.status === 'FINALIZED') throw new BadRequestException('Already finalized');
    if (!run.payslips.length) throw new BadRequestException('No payslips to finalize');
    await this.prisma.payrollRun.update({ where: { id }, data: { status: 'FINALIZED', finalizedAt: new Date() } });
    return this.run(u, id);
  }

  async remove(u: AuthUser, id: string) {
    const run = await this.run(u, id);
    if (run.status === 'FINALIZED') throw new BadRequestException('Finalized payroll cannot be deleted');
    await this.prisma.payrollRun.delete({ where: { id } });
    return { ok: true };
  }

  myPayslips(u: AuthUser) {
    return this.prisma.payslip.findMany({
      where: { employeeId: requireEmployee(u), payrollRun: { status: 'FINALIZED' } },
      include: { payrollRun: { select: { month: true, year: true } } },
      orderBy: [{ payrollRun: { year: 'desc' } }, { payrollRun: { month: 'desc' } }],
    });
  }

  async payslip(u: AuthUser, id: string) {
    const slip = await this.prisma.payslip.findFirst({
      where: { id, tenantId: u.tenantId },
      include: {
        payrollRun: true,
        employee: { include: { department: true, designation: true } },
      },
    });
    if (!slip) throw new NotFoundException();
    const isOwn = slip.employeeId === u.employeeId && slip.payrollRun.status === 'FINALIZED';
    if (!isOwn && !hasPermission(u.role, P.PAYROLL_MANAGE)) throw new ForbiddenException();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.tenantId } });
    return { ...slip, company: { name: tenant.name, address: tenant.address, pan: tenant.pan, tan: tenant.tan } };
  }
}

@Controller('payroll')
export class PayrollController {
  constructor(private svc: PayrollService) {}

  @Get('states') states() {
    return STATES;
  }

  @Post('calculator') @Permissions(P.PAYROLL_MANAGE) calc(@Body() dto: CalcDto) {
    return this.svc.calculator(dto.ctcAnnual, dto.state || 'MH');
  }

  @Get('structure/:employeeId') @Permissions(P.PAYROLL_MANAGE) structure(@CurrentUser() u: AuthUser, @Param('employeeId') id: string) {
    return this.svc.employeeStructure(u, id);
  }

  @Get('runs') @Permissions(P.PAYROLL_MANAGE) runs(@CurrentUser() u: AuthUser) {
    return this.svc.runs(u);
  }

  @Get('runs/:id') @Permissions(P.PAYROLL_MANAGE) run(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.run(u, id);
  }

  @Post('runs') @Permissions(P.PAYROLL_MANAGE) create(@CurrentUser() u: AuthUser, @Body() dto: RunDto) {
    return this.svc.create(u, dto);
  }

  @Post('runs/:id/compute') @Permissions(P.PAYROLL_MANAGE) compute(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.compute(u, id);
  }

  @Post('runs/:id/finalize') @Permissions(P.PAYROLL_MANAGE) finalize(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.finalize(u, id);
  }

  @Delete('runs/:id') @Permissions(P.PAYROLL_MANAGE) remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.remove(u, id);
  }

  @Get('payslips/me') @Permissions(P.PAYSLIP_SELF) mine(@CurrentUser() u: AuthUser) {
    return this.svc.myPayslips(u);
  }

  @Get('payslips/:id') payslip(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.payslip(u, id);
  }
}

@Module({ imports: [AttendanceModule], controllers: [PayrollController], providers: [PayrollService] })
export class PayrollModule {}
