import { Controller, Get, Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from './auth';

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
    const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SUPERADMIN_PASSWORD;
    if (!email || !password) return;
    if (await this.prisma.user.count({ where: { role: 'SUPER_ADMIN' } })) return;
    if (password.length < 10) {
      this.log.error('SUPERADMIN_PASSWORD must be at least 10 characters; super admin not created');
      return;
    }
    await this.prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 10), role: 'SUPER_ADMIN' } });
    this.log.log(`Created platform super admin ${email}. You can remove SUPERADMIN_PASSWORD from the environment now.`);
  }
}

@Module({ controllers: [HealthController], providers: [BootstrapService] })
export class SystemModule {}
