import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isSingleCompany } from './config';

/** Company sent by the web app (X-Tenant header, from the subdomain or /<company> path). */
export const tenantSlugFrom = (req: { headers: Record<string, unknown> }) =>
  String(req.headers['x-tenant'] || '').trim().toLowerCase() || null;

/**
 * Single-company mode (SUPER_ADMIN_ENABLED=false): the deployment serves exactly one company and the
 * address doesn't name it. It's COMPANY_SLUG if set, otherwise the first company created. Cached briefly.
 */
let single: { slug: string | null; at: number } | null = null;
let warned = false;
const log = new Logger('Company');

export async function singleCompanySlug(prisma: PrismaService): Promise<string | null> {
  if (single && Date.now() - single.at < 30_000) return single.slug;
  const pinned = process.env.COMPANY_SLUG?.trim().toLowerCase();
  const tenant = pinned
    ? await prisma.tenant.findUnique({ where: { slug: pinned }, select: { slug: true } })
    : await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' }, select: { slug: true } });
  if (!warned && !pinned) {
    const count = await prisma.tenant.count();
    if (count > 1) log.warn(`Single-company mode but ${count} companies exist; using "${tenant?.slug}". Set COMPANY_SLUG to choose another.`);
    warned = true;
  }
  single = { slug: tenant?.slug ?? null, at: Date.now() };
  return single.slug;
}

export const forgetSingleCompany = () => {
  single = null;
};

/** The company a request belongs to, in either mode (null = platform admin / not set up yet). */
export async function requestTenantSlug(req: { headers: Record<string, unknown> }, prisma: PrismaService) {
  return isSingleCompany() ? singleCompanySlug(prisma) : tenantSlugFrom(req);
}
