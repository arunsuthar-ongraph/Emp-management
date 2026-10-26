import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { forgetTenant, Permissions } from '../common/auth';
import { P } from '../common/permissions';
import { createTenantDefaults } from '../common/tenant-defaults';
import { todayIST } from '../common/dates';

// Infrastructure names plus the app's page paths: companies can also be addressed as /<slug>,
// so a slug must never collide with a page (keep in sync with NOT_A_COMPANY in web/src/tenant.ts).
const RESERVED = [
  'www', 'app', 'api', 'admin', 'mail', 'static', 'platform', 'assets', 'uploads', 'health',
  'login', 'employees', 'organization', 'leave', 'attendance', 'holidays', 'payroll', 'payslips', 'profile', 'settings', 'tenants',
];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const SLUG_MSG = 'Subdomain may use lowercase letters, numbers and hyphens (max 32)';

class CreateTenantDto {
  @IsNotEmpty() companyName: string;
  @Matches(SLUG, { message: SLUG_MSG })
  slug: string;
  @IsOptional() @IsString() state?: string;
  @IsNotEmpty() firstName: string;
  @IsNotEmpty() lastName: string;
  @IsEmail() email: string;
  @MinLength(6) password: string;
}

/** Company details the platform super admin can change. */
class UpdateTenantDto {
  @IsOptional() @IsNotEmpty() name?: string;
  @IsOptional() @Matches(SLUG, { message: SLUG_MSG }) slug?: string;
  @IsOptional() @IsNotEmpty() state?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() pan?: string;
  @IsOptional() @IsString() tan?: string;
  @IsOptional() @IsString() pfCode?: string;
  @IsOptional() @IsString() esiCode?: string;
}

class StatusDto {
  @IsBoolean() isActive: boolean;
}

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService) {}

  tenants() {
    return this.prisma.tenant.findMany({
      include: { _count: { select: { employees: true, users: true, payrollRuns: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Creates a company with default leave types/departments and its first Company Admin login. */
  async create(dto: CreateTenantDto) {
    const slug = dto.slug.toLowerCase();
    if (RESERVED.includes(slug)) throw new BadRequestException(`"${slug}" is reserved, choose another subdomain`);
    if (await this.prisma.tenant.findUnique({ where: { slug } })) throw new BadRequestException('This subdomain is already taken');

    const email = dto.email.toLowerCase();
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: dto.companyName, slug, state: dto.state || 'MH' } });
      await createTenantDefaults(tx, tenant.id);
      const dept = await tx.department.findFirst({ where: { tenantId: tenant.id, name: 'Management' } });
      const desg = await tx.designation.findFirst({ where: { tenantId: tenant.id, name: 'Director' } });
      const employee = await tx.employee.create({
        data: {
          tenantId: tenant.id,
          code: 'EMP001',
          firstName: dto.firstName,
          lastName: dto.lastName,
          email,
          joiningDate: todayIST(),
          departmentId: dept?.id,
          designationId: desg?.id,
        },
      });
      await tx.user.create({ data: { tenantId: tenant.id, email, passwordHash, role: 'COMPANY_ADMIN', employeeId: employee.id } });
      return tenant;
    });
  }

  /**
   * Update company details. Changing the subdomain moves the company's sign-in address at once:
   * existing sessions on the old address stop working and users sign in at the new one.
   */
  async update(id: string, dto: UpdateTenantDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Company not found');
    const slug = dto.slug?.toLowerCase();
    if (slug && slug !== tenant.slug) {
      if (RESERVED.includes(slug)) throw new BadRequestException(`"${slug}" is reserved, choose another subdomain`);
      if (await this.prisma.tenant.findUnique({ where: { slug } })) throw new BadRequestException('This subdomain is already taken');
    }
    const clean = (v?: string) => (v === undefined ? undefined : v.trim() || null); // '' clears a field
    const upper = (v?: string) => { const c = clean(v); return c ? c.toUpperCase() : c; };
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        slug,
        state: dto.state,
        address: clean(dto.address),
        pan: upper(dto.pan),
        tan: upper(dto.tan),
        pfCode: clean(dto.pfCode),
        esiCode: clean(dto.esiCode),
      },
      include: { _count: { select: { employees: true, users: true, payrollRuns: true } } },
    });
    forgetTenant(id); // after saving: sessions are re-checked against the new subdomain right away
    return updated;
  }

  async setStatus(id: string, isActive: boolean) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException();
    const updated = await this.prisma.tenant.update({ where: { id }, data: { isActive } });
    forgetTenant(id); // after saving: suspending signs the company's users out on their next request
    return updated;
  }
}

@Controller('platform/tenants')
@Permissions(P.PLATFORM_ADMIN)
export class PlatformController {
  constructor(private svc: PlatformService) {}

  @Get() list() {
    return this.svc.tenants();
  }

  @Post() create(@Body() dto: CreateTenantDto) {
    return this.svc.create(dto);
  }

  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.svc.update(id, dto);
  }

  @Patch(':id/status') status(@Param('id') id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(id, dto.isActive);
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}
