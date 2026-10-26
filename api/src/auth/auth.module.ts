import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpException, HttpStatus, Injectable, Module, NotFoundException, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { requestTenantSlug } from '../common/tenant-context';
import { ROLE_PERMISSIONS } from '../common/permissions';
import { HierarchyService } from '../common/hierarchy';
import { isSingleCompany, publicConfig, signupEnabled, superAdminEnabled } from '../common/config';
import { provisionCompany, SLUG, SLUG_MSG } from '../platform/provisioning';

class LoginDto {
  @IsEmail() email: string;
  @IsNotEmpty() password: string;
}

class SignupDto {
  @IsNotEmpty() companyName: string;
  @IsOptional() @Matches(SLUG, { message: SLUG_MSG }) slug?: string; // multi-company mode only
  @IsOptional() @IsString() state?: string;
  @IsNotEmpty() firstName: string;
  @IsNotEmpty() lastName: string;
  @IsEmail() email: string;
  @MinLength(8, { message: 'Password must be at least 8 characters' }) password: string;
}

/** Public sign-up is open to anyone, so limit how many companies one address can create. */
const signupLog = new Map<string, number[]>();
function checkSignupRate(ip: string) {
  const hourAgo = Date.now() - 3600_000;
  const recent = (signupLog.get(ip) || []).filter((t) => t > hourAgo);
  if (recent.length >= 5) throw new HttpException('Too many sign-ups from this network. Try again in an hour.', HttpStatus.TOO_MANY_REQUESTS);
  signupLog.set(ip, [...recent, Date.now()]);
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
      if (isSingleCompany()) throw new UnauthorizedException('The app is not set up yet: set ADMIN_EMAIL and ADMIN_PASSWORD on the server');
      if (!superAdminEnabled()) throw new UnauthorizedException('Sign in on your company address');
      user = await this.prisma.user.findFirst({ where: { tenantId: null, email, role: 'SUPER_ADMIN' } });
    }
    if (!user || !user.isActive || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issue(user.id);
  }

  /** Self-service: create a company and its first Company Admin, signed in straight away. */
  /** Multi-company mode with PUBLIC_SIGNUP=true: self-service creation of a company. Off in single-company mode. */
  async signup(dto: SignupDto, ip: string) {
    if (!signupEnabled()) throw new NotFoundException();
    if (!dto.slug) throw new BadRequestException('Choose a company address');
    checkSignupRate(ip);
    const { tenant, user } = await provisionCompany(this.prisma, { ...dto, slug: dto.slug });
    return { ...(await this.issue(user.id)), slug: tenant.slug };
  }

  /** Public settings for the sign-in page. Single-company mode also returns the company name. */
  async config() {
    if (!isSingleCompany()) return publicConfig();
    const slug = await requestTenantSlug({ headers: {} }, this.prisma);
    const tenant = slug ? await this.prisma.tenant.findUnique({ where: { slug }, select: { name: true } }) : null;
    return { ...publicConfig(), configured: !!tenant, companyName: tenant?.name ?? null };
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
      avatarUrl: user.avatarUrl,
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
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  @Public() @Post('login') async login(@Body() dto: LoginDto, @Req() req: any) {
    return this.auth.login(dto, await requestTenantSlug(req, this.prisma));
  }

  /** Which sign-in options this deployment offers (super admin, public sign-up) and its company domain. */
  @Public() @Get('config') config() {
    return this.auth.config();
  }

  @Public() @Post('signup') signup(@Body() dto: SignupDto, @Req() req: any) {
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    return this.auth.signup(dto, ip);
  }

  @Public() @Get('workspace') async workspace(@Req() req: any) {
    return this.auth.workspace(await requestTenantSlug(req, this.prisma));
  }

  @Get('me') me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}
