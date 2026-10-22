import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ArrayNotEmpty, IsArray, IsDateString, IsEmail, IsEnum, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Permissions } from '../common/auth';
import { hasPermission, P } from '../common/permissions';
import { toDate } from '../common/dates';
import { HierarchyService } from '../common/hierarchy';
import { BillingService } from '../billing/billing.service';

class EmployeeDto {
  @IsOptional() @IsString() code?: string;
  @IsNotEmpty() firstName: string;
  @IsNotEmpty() lastName: string;
  @IsEmail() email: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsDateString() dob?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() emergencyName?: string;
  @IsOptional() @IsString() emergencyPhone?: string;
  @IsDateString() joiningDate: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() designationId?: string;
  @IsOptional() @IsString() managerId?: string;
  @IsOptional() @IsString() pan?: string;
  @IsOptional() @IsString() uan?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankAccount?: string;
  @IsOptional() @IsString() ifsc?: string;
  @IsOptional() @IsNumber() ctcAnnual?: number;
  // Login account
  @IsOptional() @IsIn(['COMPANY_ADMIN', 'HR_ADMIN', 'PAYROLL_ADMIN', 'MANAGER', 'EMPLOYEE']) role?: Role;
  @IsOptional() @MinLength(6) password?: string;
}

class BulkDto {
  @IsArray() @ArrayNotEmpty() employeeIds: string[];
  @IsOptional() @IsString() departmentId?: string | null;
  @IsOptional() @IsString() managerId?: string | null;
}

export interface ListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  departmentId?: string;
  managerId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

class StatusDto {
  @IsEnum(['ACTIVE', 'INACTIVE']) status: 'ACTIVE' | 'INACTIVE';
  @IsOptional() @IsDateString() exitDate?: string;
}

const include = {
  department: true,
  designation: true,
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { id: true, role: true, isActive: true, avatarUrl: true } },
} satisfies Prisma.EmployeeInclude;

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService, private hierarchy: HierarchyService, private billing: BillingService) {}

  /** Salary is visible only to roles that manage payroll. */
  private present<T extends { ctcAnnual: Prisma.Decimal }>(e: T, user: AuthUser) {
    const canSeeSalary = hasPermission(user.role, P.PAYROLL_MANAGE);
    return { ...e, ctcAnnual: canSeeSalary ? Number(e.ctcAnnual) : undefined };
  }

  /** Server-side paged list. Department filter includes its sub-departments. */
  async list(user: AuthUser, q: ListQuery) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));
    const where: Prisma.EmployeeWhereInput = { tenantId: user.tenantId };
    if (q.status) where.status = q.status;
    if (q.managerId) where.managerId = q.managerId;
    if (q.departmentId) where.departmentId = { in: await this.hierarchy.departmentWithChildren(user.tenantId, q.departmentId) };
    if (q.search?.trim()) {
      const t = q.search.trim();
      where.OR = [
        { code: { contains: t, mode: 'insensitive' } },
        { firstName: { contains: t, mode: 'insensitive' } },
        { lastName: { contains: t, mode: 'insensitive' } },
        { email: { contains: t, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.employee.findMany({ where, include, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.employee.count({ where }),
    ]);
    return { items: rows.map((e) => this.present(e, user)), total, page, pageSize };
  }

  /** Lightweight lookup for searchable selects (max 30 rows); `ids` resolves current values. */
  options(user: AuthUser, search?: string, ids?: string) {
    const t = search?.trim();
    return this.prisma.employee.findMany({
      where: {
        tenantId: user.tenantId,
        ...(ids ? { id: { in: ids.split(',') } } : { status: 'ACTIVE' }),
        ...(t && {
          OR: [
            { code: { contains: t, mode: 'insensitive' } },
            { firstName: { contains: t, mode: 'insensitive' } },
            { lastName: { contains: t, mode: 'insensitive' } },
          ],
        }),
      },
      select: { id: true, code: true, firstName: true, lastName: true, designation: { select: { name: true } } },
      orderBy: { firstName: 'asc' },
      take: 30,
    });
  }

  /** Move many employees at once to a department and/or reporting manager. */
  async bulk(user: AuthUser, dto: BulkDto) {
    const data: Prisma.EmployeeUncheckedUpdateManyInput = {};
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId || null;
    if (dto.managerId !== undefined) {
      await this.hierarchy.assertNoManagerCycle(user.tenantId, dto.employeeIds, dto.managerId);
      data.managerId = dto.managerId || null;
    }
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to update');
    const res = await this.prisma.employee.updateMany({ where: { id: { in: dto.employeeIds }, tenantId: user.tenantId }, data });
    return { updated: res.count };
  }

  async get(user: AuthUser, id: string) {
    const e = await this.prisma.employee.findFirst({ where: { id, tenantId: user.tenantId }, include });
    if (!e) throw new NotFoundException('Employee not found');
    return this.present(e, user);
  }

  private async nextCode(tenantId: string) {
    const count = await this.prisma.employee.count({ where: { tenantId } });
    return `EMP${String(count + 1).padStart(3, '0')}`;
  }

  private data(dto: EmployeeDto, user: AuthUser) {
    const { role, password, ctcAnnual, dob, joiningDate, ...rest } = dto;
    return {
      ...rest,
      email: dto.email.toLowerCase(),
      departmentId: dto.departmentId || null,
      designationId: dto.designationId || null,
      managerId: dto.managerId || null,
      dob: dob ? toDate(dob) : null,
      joiningDate: toDate(joiningDate),
      ...(ctcAnnual !== undefined && hasPermission(user.role, P.PAYROLL_MANAGE) ? { ctcAnnual } : {}),
    };
  }

  async create(user: AuthUser, dto: EmployeeDto) {
    await this.billing.assertCanAddEmployee(user.tenantId);
    const code = dto.code || (await this.nextCode(user.tenantId));
    if (await this.prisma.employee.findFirst({ where: { tenantId: user.tenantId, code } })) {
      throw new BadRequestException(`Employee code ${code} already exists`);
    }
    const employee = await this.prisma.employee.create({
      data: { ...this.data(dto, user), code, tenantId: user.tenantId },
    });
    if (dto.password) await this.upsertLogin(user, employee.id, employee.email, dto.role || 'EMPLOYEE', dto.password);
    return this.get(user, employee.id);
  }

  async update(user: AuthUser, id: string, dto: EmployeeDto) {
    const existing = await this.get(user, id);
    await this.hierarchy.assertNoManagerCycle(user.tenantId, [id], dto.managerId);
    await this.prisma.employee.update({ where: { id }, data: this.data(dto, user) });
    if (dto.password || (dto.role && existing.user)) {
      await this.upsertLogin(user, id, dto.email.toLowerCase(), dto.role || existing.user?.role || 'EMPLOYEE', dto.password);
    }
    return this.get(user, id);
  }

  /**
   * Deactivating an employee hands over their place in the hierarchy:
   * direct reports move to the employee's own manager, departments they head lose the head,
   * and leave requests waiting on them go to the HR queue.
   */
  async setStatus(user: AuthUser, id: string, dto: StatusDto) {
    const emp = await this.get(user, id);
    const leaving = dto.status === 'INACTIVE';
    if (!leaving && emp.status !== 'ACTIVE') await this.billing.assertCanAddEmployee(user.tenantId);
    await this.prisma.$transaction([
      this.prisma.employee.update({
        where: { id },
        data: { status: dto.status, exitDate: leaving ? toDate(dto.exitDate || new Date()) : null },
      }),
      this.prisma.user.updateMany({ where: { employeeId: id }, data: { isActive: !leaving } }),
      ...(leaving
        ? [
            this.prisma.employee.updateMany({ where: { managerId: id }, data: { managerId: emp.managerId } }),
            this.prisma.department.updateMany({ where: { headId: id }, data: { headId: null } }),
            this.prisma.leaveRequest.updateMany({ where: { currentApproverId: id, status: 'PENDING' }, data: { currentApproverId: null } }),
          ]
        : []),
    ]);
    return this.get(user, id);
  }

  private async upsertLogin(user: AuthUser, employeeId: string, email: string, role: Role, password?: string) {
    if (role === 'COMPANY_ADMIN' && user.role !== 'COMPANY_ADMIN') {
      throw new BadRequestException('Only a company admin can create another admin');
    }
    const existing = await this.prisma.user.findUnique({ where: { employeeId } });
    const clash = await this.prisma.user.findFirst({ where: { tenantId: user.tenantId, email } });
    if (clash && clash.id !== existing?.id) throw new BadRequestException('This email is already used by another login in your company');
    const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
    if (existing) {
      await this.prisma.user.update({ where: { id: existing.id }, data: { email, role, ...(passwordHash && { passwordHash }) } });
    } else if (passwordHash) {
      await this.prisma.user.create({ data: { tenantId: user.tenantId, employeeId, email, role, passwordHash } });
    }
  }
}

@Controller('employees')
export class EmployeesController {
  constructor(private svc: EmployeesService) {}

  @Get() @Permissions(P.EMPLOYEE_READ) list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.svc.list(u, q);
  }

  /** Any signed-in user may look up colleagues by name (no personal data returned). */
  @Get('options') options(@CurrentUser() u: AuthUser, @Query('search') search?: string, @Query('ids') ids?: string) {
    return this.svc.options(u, search, ids);
  }

  @Post('bulk') @Permissions(P.EMPLOYEE_WRITE) bulk(@CurrentUser() u: AuthUser, @Body() dto: BulkDto) {
    return this.svc.bulk(u, dto);
  }

  @Get(':id') @Permissions(P.EMPLOYEE_READ) get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.get(u, id);
  }

  @Post() @Permissions(P.EMPLOYEE_WRITE) create(@CurrentUser() u: AuthUser, @Body() dto: EmployeeDto) {
    return this.svc.create(u, dto);
  }

  @Patch(':id') @Permissions(P.EMPLOYEE_WRITE) update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: EmployeeDto) {
    return this.svc.update(u, id, dto);
  }

  @Patch(':id/status') @Permissions(P.EMPLOYEE_WRITE) status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(u, id, dto);
  }
}

@Module({ controllers: [EmployeesController], providers: [EmployeesService] })
export class EmployeesModule {}
