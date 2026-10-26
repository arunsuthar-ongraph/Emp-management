import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { createTenantDefaults } from '../common/tenant-defaults';
import { todayIST } from '../common/dates';

// Infrastructure names plus the app's page paths: companies can also be addressed as /<slug>,
// so a slug must never collide with a page (keep in sync with NOT_A_COMPANY in web/src/tenant.ts).
export const RESERVED = [
  'www', 'app', 'api', 'admin', 'mail', 'static', 'platform', 'assets', 'uploads', 'health',
  'login', 'signup', 'employees', 'organization', 'leave', 'attendance', 'holidays', 'payroll', 'payslips', 'profile', 'settings', 'tenants',
];
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const SLUG_MSG = 'Company address may use lowercase letters, numbers and hyphens (max 32)';

export interface NewCompany {
  companyName: string;
  slug: string;
  state?: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export async function assertSlugAvailable(prisma: PrismaService, slug: string) {
  if (RESERVED.includes(slug)) throw new BadRequestException(`"${slug}" is reserved, choose another address`);
  if (await prisma.tenant.findUnique({ where: { slug } })) throw new BadRequestException('This company address is already taken');
}

/**
 * Creates a company with default leave types, departments and designations, plus its first
 * Company Admin (as employee EMP001). Used by the platform admin and by public sign-up.
 */
export async function provisionCompany(prisma: PrismaService, dto: NewCompany) {
  const slug = dto.slug.toLowerCase();
  await assertSlugAvailable(prisma, slug);
  const email = dto.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(dto.password, 10);

  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: dto.companyName.trim(), slug, state: dto.state || 'MH' } });
    await createTenantDefaults(tx, tenant.id);
    const dept = await tx.department.findFirst({ where: { tenantId: tenant.id, name: 'Management' } });
    const desg = await tx.designation.findFirst({ where: { tenantId: tenant.id, name: 'Director' } });
    const employee = await tx.employee.create({
      data: {
        tenantId: tenant.id,
        code: 'EMP001',
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email,
        joiningDate: todayIST(),
        departmentId: dept?.id,
        designationId: desg?.id,
      },
    });
    const user = await tx.user.create({ data: { tenantId: tenant.id, email, passwordHash, role: 'COMPANY_ADMIN', employeeId: employee.id } });
    return { tenant, user };
  });
}
