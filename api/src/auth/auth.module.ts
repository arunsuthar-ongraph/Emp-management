import { Body, Controller, Get, Injectable, Module, NotFoundException, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public, tenantSlugFrom } from '../common/auth';
import { ROLE_PERMISSIONS } from '../common/permissions';
import { HierarchyService } from '../common/hierarchy';

class LoginDto {
  @IsEmail() email: string;
  @IsNotEmpty() password: string;
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private hierarchy: HierarchyService) {}

  /** Company subdomain → its users only. Root domain → platform super admin only. */
  async login(dto: LoginDto, slug: string | null) {
    const email = dto.email.toLowerCase();
    let user;
    if (slug) {
      const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
      if (!tenant) throw new UnauthorizedException('Company not found');
      if (!tenant.isActive) throw new UnauthorizedException('This company account is suspended. Contact support.');
      user = await this.prisma.user.findFirst({ where: { tenantId: tenant.id, email } });
    } else {
      user = await this.prisma.user.findFirst({ where: { tenantId: null, email, role: 'SUPER_ADMIN' } });
    }
    if (!user || !user.isActive || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issue(user.id);
  }

  /** Public info for the login page of a subdomain. */
  async workspace(slug: string | null) {
    const tenant = slug ? await this.prisma.tenant.findUnique({ where: { slug } }) : null;
    if (!tenant) throw new NotFoundException('Company not found');
    return { name: tenant.name, slug: tenant.slug, isActive: tenant.isActive };
  }

  async issue(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { tenant: true } });
    const payload: AuthUser = {
      userId: user.id,
      tenantId: user.tenantId || '',
      tenantSlug: user.tenant?.slug || null,
      role: user.role,
      employeeId: user.employeeId,
    };
    return { token: this.jwt.sign(payload), user: await this.me(payload) };
  }

  async me(u: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: u.userId },
      include: { tenant: true, employee: { include: { designation: true, department: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role],
      // Leads people (reporting manager or department head) → sees approvals and team views
      isLead: await this.hierarchy.isLead(user.tenantId || '', user.employeeId),
      tenant: user.tenant ? { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug, state: user.tenant.state } : null,
      employee: user.employee
        ? {
            id: user.employee.id,
            code: user.employee.code,
            name: `${user.employee.firstName} ${user.employee.lastName}`,
            designation: user.employee.designation?.name,
            department: user.employee.department?.name,
          }
        : null,
    };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('login') login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto, tenantSlugFrom(req));
  }

  @Public() @Get('workspace') workspace(@Req() req: any) {
    return this.auth.workspace(tenantSlugFrom(req));
  }

  @Get('me') me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
