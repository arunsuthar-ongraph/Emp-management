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
import { hasPermission, Permission } from './permissions';

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
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
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
