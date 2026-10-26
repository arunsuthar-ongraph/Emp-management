/**
 * Which company a page belongs to. Two ways, so the app works with or without wildcard DNS:
 *
 *  - Subdomain: https://acme.<ROOT_DOMAIN>     (custom domain with *.wildcard, or acme.localhost in dev)
 *  - Path:      https://<any-host>/acme       (e.g. Railway's generated *.up.railway.app domain)
 *
 * No company in the address means the platform super-admin portal.
 *
 * The root domain is resolved at runtime, in this order:
 *  1. injected by the server into index.html (ROOT_DOMAIN on the API, no rebuild needed)
 *  2. VITE_ROOT_DOMAIN baked in at build time
 *  3. localhost when running locally, otherwise the current address (path mode only)
 */
declare global {
  interface Window {
    __APP_CONFIG__?: { rootDomain?: string | null; mode?: 'single' | 'multi'; superAdmin?: boolean; signup?: boolean };
  }
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** First path segments that are app pages, not companies. Keep in sync with RESERVED on the server. */
const NOT_A_COMPANY = new Set([
  'login', 'signup', 'employees', 'organization', 'leave', 'attendance', 'holidays', 'payroll', 'payslips',
  'profile', 'settings', 'tenants', 'assets', 'api', 'uploads', 'health', 'www',
]);

const isLocal = (h: string) => h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1';

function configuredRootDomain(): string | null {
  const host = window.location.hostname.toLowerCase();
  const configured = (window.__APP_CONFIG__?.rootDomain || import.meta.env.VITE_ROOT_DOMAIN || '').toLowerCase();
  // A hosted page never uses a localhost setting (e.g. a dev value copied into production)
  if (configured && (!isLocal(configured) || isLocal(host))) return configured;
  return isLocal(host) ? 'localhost' : null;
}

/** Explicitly configured root domain, or null when company subdomains aren't available (path mode). */
const CONFIGURED_ROOT = configuredRootDomain();
export const ROOT_DOMAIN = CONFIGURED_ROOT || window.location.hostname.toLowerCase();

function fromSubdomain(): string | null {
  if (!CONFIGURED_ROOT) return null;
  const host = window.location.hostname.toLowerCase();
  if (host === CONFIGURED_ROOT || !host.endsWith(`.${CONFIGURED_ROOT}`)) return null;
  const sub = host.slice(0, -(CONFIGURED_ROOT.length + 1));
  return sub && sub !== 'www' && !sub.includes('.') ? sub : null;
}

function fromPath(): string | null {
  const first = window.location.pathname.split('/')[1]?.toLowerCase() || '';
  return SLUG.test(first) && !NOT_A_COMPANY.has(first) ? first : null;
}

/** Single-company deployment: the address never names a company; the server knows which one it is. */
export const SINGLE_COMPANY = window.__APP_CONFIG__?.mode === 'single';

const SUB = SINGLE_COMPANY ? null : fromSubdomain();
const PATH = SUB || SINGLE_COMPANY ? null : fromPath();

/** Company slug for this page (subdomain wins over path), or null on the platform portal. */
export const tenantSlug = (): string | null => SUB || PATH;

/** Router base path: '/acme' in path mode, '' otherwise. */
export const BASENAME = PATH ? `/${PATH}` : '';

/** An in-app path including the company prefix, for full-page redirects. */
export const appPath = (p: string) => `${BASENAME}${p}`;

/** Sign-in sessions are kept per company, since path-mode companies share one browser origin. */
export const tokenKey = () => (tenantSlug() ? `token:${tenantSlug()}` : 'token');

const origin = () => {
  const { protocol, port } = window.location;
  return { protocol, port: port ? `:${port}` : '' };
};

/** True when companies get their own subdomain (root domain configured); false means path addresses. */
export const usesSubdomains = () => !SINGLE_COMPANY && !!CONFIGURED_ROOT;

/** Full sign-in URL of a company. */
export function tenantUrl(slug: string) {
  const { protocol, port } = origin();
  if (CONFIGURED_ROOT) return `${protocol}//${slug}.${CONFIGURED_ROOT}${port}`;
  return `${window.location.origin}/${slug}`;
}

/** Same address for display, without the protocol (e.g. acme.peopledesk.in or app.up.railway.app/acme). */
export const tenantAddress = (slug: string) => tenantUrl(slug).replace(/^https?:\/\//, '');

/** What goes before/after a company slug in address inputs. */
export const slugAddon = (): { before?: string; after?: string } =>
  CONFIGURED_ROOT ? { after: `.${CONFIGURED_ROOT}` } : { before: `${window.location.host}/` };

/** The platform portal (no company). */
export function platformUrl() {
  const { protocol, port } = origin();
  return CONFIGURED_ROOT ? `${protocol}//${CONFIGURED_ROOT}${port}` : window.location.origin;
}
