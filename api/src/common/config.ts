/**
 * Domain settings, read at runtime (no rebuild needed when they change).
 *
 * ROOT_DOMAIN is the domain companies live under: <slug>.ROOT_DOMAIN.
 * Accepted from ROOT_DOMAIN, or VITE_ROOT_DOMAIN (same value the frontend build used),
 * or worked out from APP_URL (https://{slug}.example.com → example.com).
 */
function domainFromAppUrl(): string {
  const url = process.env.APP_URL;
  // Only subdomain-style (https://{slug}.example.com) says anything about a company domain;
  // a path-style APP_URL (https://host/{slug}) must not turn the host into a root domain.
  if (!url || !url.includes('{slug}.')) return '';
  try {
    return new URL(url.replace('{slug}.', '')).hostname;
  } catch {
    return '';
  }
}

const clean = (d?: string) => (d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\./, '');

export const ROOT_DOMAIN = clean(process.env.ROOT_DOMAIN) || clean(process.env.VITE_ROOT_DOMAIN) || clean(domainFromAppUrl());

/**
 * Sign-in address of a company, used in emails:
 *  1. APP_URL with {slug} filled in (subdomain style https://{slug}.example.com or path style https://host/{slug})
 *  2. https://<slug>.<ROOT_DOMAIN> when a company domain is configured
 *  3. https://<RAILWAY_PUBLIC_DOMAIN>/<slug> (Railway sets this for services with a generated domain)
 *  4. local development
 */
export function companyUrl(slug: string): string {
  const appUrl = process.env.APP_URL;
  // A localhost APP_URL copied from .env.example is ignored in production
  const usable = appUrl && !(process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/.test(appUrl));
  // Single-company mode: everything is at the main address, whatever the company slug
  if (isSingleCompany()) {
    if (usable) return appUrl.replace('{slug}.', '').replace('/{slug}', '').replace('{slug}', '').replace(/\/$/, '');
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    return 'http://localhost:5173';
  }
  if (usable) return appUrl.replace('{slug}', slug).replace(/\/$/, '');
  if (ROOT_DOMAIN && ROOT_DOMAIN !== 'localhost' && !ROOT_DOMAIN.endsWith('.localhost')) return `https://${slug}.${ROOT_DOMAIN}`;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/${slug}`;
  return `http://${slug}.localhost:5173`; // local development
}


const flag = (v: string | undefined, fallback: boolean) => (v === undefined || v.trim() === '' ? fallback : /^(1|true|yes|on)$/i.test(v.trim()));

/** SUPER_ADMIN_ENABLED=false turns the platform super admin off entirely (sign-in, sessions, bootstrap). Default: on. */
export const superAdminEnabled = () => flag(process.env.SUPER_ADMIN_ENABLED, true);

/**
 * SUPER_ADMIN_ENABLED=false means single-company mode: one company per deployment, signed in at the
 * main address (no subdomains or /<company> paths). Its admin sets it up on the first visit.
 */
export const isSingleCompany = () => !superAdminEnabled();

/** Multi-company mode only: PUBLIC_SIGNUP=true lets anyone create a company next to the super admin. */
export const signupEnabled = () => !isSingleCompany() && flag(process.env.PUBLIC_SIGNUP, false);

/** Settings the frontend needs at runtime (injected into index.html and served at /api/auth/config). */
export const publicConfig = () => ({
  rootDomain: ROOT_DOMAIN || null,
  mode: isSingleCompany() ? ('single' as const) : ('multi' as const),
  superAdmin: superAdminEnabled(),
  signup: signupEnabled(),
});
