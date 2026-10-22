import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { Permissions } from '../common/auth';
import { P } from '../common/permissions';
import { createTenantDefaults } from '../common/tenant-defaults';
import { todayIST } from '../common/dates';
import { BillingService } from '../billing/billing.service';

const RESERVED = ['www', 'app', 'api', 'admin', 'mail', 'static', 'platform'];

class CreateTenantDto {
  @IsNotEmpty() companyName: string;
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, { message: 'Subdomain may use lowercase letters, numbers and hyphens (max 32)' })
  slug: string;
  @IsOptional() @IsString() state?: string;
  @IsNotEmpty() firstName: string;
  @IsNotEmpty() lastName: string;
  @IsEmail() email: string;
  @MinLength(6) password: string;
  @IsOptional() @IsString() planId?: string; // trial plan (default: Growth)
}

class StatusDto {
  @IsBoolean() isActive: boolean;
}

@Injectable()
export class PlatformService {
  constructor(private prisma: PrismaService, private billing: BillingService) {}

  tenants() {
    return this.prisma.tenant.findMany({
      include: { _count: { select: { employees: true, users: true, payrollRuns: true } }, subscription: { include: { plan: { select: { name: true, code: true } } } } },
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
      await this.billing.startTrial(tenant.id, dto.planId, tx);
      return tenant;
    });
  }

  async setStatus(id: string, isActive: boolean) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException();
    return this.prisma.tenant.update({ where: { id }, data: { isActive } });
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

  @Patch(':id/status') status(@Param('id') id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(id, dto.isActive);
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}
