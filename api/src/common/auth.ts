import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasPermission, Permission } from './permissions';

/**
 * Current subdomain + enabled flag per company, cached briefly so sessions can be checked
 * on every request without a database hit each time. Cleared when a company is edited or suspended.
 */
const tenantCache = new Map<string, { slug: string; isActive: boolean; at: number }>();
export const forgetTenant = (tenantId: string) => tenantCache.delete(tenantId);

export interface AuthUser {
  userId: string;
  tenantId: string;
  tenantSlug: string | null;
  role: Role;
  employeeId: string | null;
}

/** Company subdomain sent by the web app (X-Tenant header). Empty on the root/platform domain. */
export const tenantSlugFrom = (req: { headers: Record<string, unknown> }) =>
  String(req.headers['x-tenant'] || '').trim().toLowerCase() || null;

export const Public = () => SetMetadata('isPublic', true);
export const Permissions = (...perms: Permission[]) => SetMetadata('permissions', perms);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

/** Global guard: verifies the JWT, then checks that the role has every @Permissions() listed. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('isPublic', targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();
    try {
      req.user = this.jwt.verify<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Session expired, please login again');
    }
    // A token is only valid on the subdomain it was issued for; the platform admin uses the root domain.
    if ((req.user.tenantSlug || null) !== tenantSlugFrom(req)) {
      throw new UnauthorizedException('Please sign in on your company address');
    }
    // The company may have been moved to a new subdomain or suspended since this session started
    if (req.user.tenantId) {
      let t = tenantCache.get(req.user.tenantId);
      if (!t || Date.now() - t.at > 30_000) {
        const row = await this.prisma.tenant.findUnique({ where: { id: req.user.tenantId }, select: { slug: true, isActive: true } });
        t = { slug: row?.slug ?? '', isActive: !!row?.isActive, at: Date.now() };
        tenantCache.set(req.user.tenantId, t);
      }
      if (!t.isActive) throw new UnauthorizedException('This company account is suspended. Contact support.');
      if (t.slug !== req.user.tenantSlug) throw new UnauthorizedException('Your company has a new sign-in address. Please sign in again.');
    }

    const perms = this.reflector.getAllAndOverride<Permission[]>('permissions', targets) || [];
    if (!perms.every((p) => hasPermission(req.user.role, p))) {
      throw new ForbiddenException('You do not have access to this action');
    }
    return true;
  }
}

/** Throws if the user has no linked employee profile (e.g. super admin). */
export function requireEmployee(user: AuthUser): string {
  if (!user.employeeId) throw new ForbiddenException('No employee profile linked to this login');
  return user.employeeId;
}
