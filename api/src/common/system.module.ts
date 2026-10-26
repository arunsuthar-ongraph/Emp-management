import { Controller, Get, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './auth';
import { isSingleCompany, superAdminEnabled } from './config';
import { forgetSingleCompany, singleCompanySlug } from './tenant-context';
import { provisionCompany, RESERVED } from '../platform/provisioning';

/** Liveness + database check, used by Railway's health check. */
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public() @Get() async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}

/**
 * First start on an empty production database: creates the platform super admin from
 * SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD. Does nothing once any super admin exists.
 * (The demo seed is for local development only.)
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private log = new Logger('Bootstrap');
  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if (isSingleCompany()) return this.ensureSingleCompany();
    const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SUPERADMIN_PASSWORD;
    if (!email || !password || !superAdminEnabled()) return;
    if (await this.prisma.user.count({ where: { role: 'SUPER_ADMIN' } })) return;
    if (password.length < 10) {
      this.log.error('SUPERADMIN_PASSWORD must be at least 10 characters; super admin not created');
      return;
    }
    await this.prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role: 'SUPER_ADMIN' } });
    this.log.log(`Created platform super admin ${email}. You can remove SUPERADMIN_PASSWORD from the environment now.`);
  }

  /**
   * Single-company mode: the company and its admin login come from fixed environment variables
   * (COMPANY_NAME, ADMIN_EMAIL, ADMIN_PASSWORD; optional ADMIN_FIRST_NAME, ADMIN_LAST_NAME, COMPANY_STATE).
   * Creates the company on the first start; afterwards only makes sure that admin login exists.
   * Existing data is never changed, so edits made in the app (company name, password) are kept.
   */
  private async ensureSingleCompany() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    const firstName = process.env.ADMIN_FIRST_NAME?.trim() || 'Admin';
    const lastName = process.env.ADMIN_LAST_NAME?.trim() || '';
    const slug = await singleCompanySlug(this.prisma);

    if (!email || password.length < 8) {
      if (!slug) this.log.error('Single-company mode: set ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) to create the company and its admin login.');
      return;
    }

    if (!slug) {
      const companyName = process.env.COMPANY_NAME?.trim() || 'My Company';
      let newSlug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'company';
      if (RESERVED.includes(newSlug)) newSlug = `${newSlug}-co`;
      await provisionCompany(this.prisma, { companyName, slug: newSlug, state: process.env.COMPANY_STATE?.trim() || 'MH', firstName, lastName, email, password });
      forgetSingleCompany();
      this.log.log(`Created company "${companyName}" with admin login ${email}.`);
      return;
    }

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { slug } });
    if (await this.prisma.user.findFirst({ where: { tenantId: tenant.id, email } })) return;
    let n = (await this.prisma.employee.count({ where: { tenantId: tenant.id } })) + 1;
    while (await this.prisma.employee.findFirst({ where: { tenantId: tenant.id, code: `EMP${String(n).padStart(3, '0')}` } })) n++;
    const employee = await this.prisma.employee.create({
      data: { tenantId: tenant.id, code: `EMP${String(n).padStart(3, '0')}`, firstName, lastName, email, joiningDate: new Date() },
    });
    await this.prisma.user.create({ data: { tenantId: tenant.id, email, passwordHash: await bcrypt.hash(password, 10), role: 'COMPANY_ADMIN', employeeId: employee.id } });
    this.log.log(`Added admin login ${email} to "${tenant.name}".`);
  }
}

@Module({ controllers: [HealthController], providers: [BootstrapService] })
export class SystemModule {}
