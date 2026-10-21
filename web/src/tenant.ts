/**
 * Company is identified by subdomain: <slug>.<ROOT_DOMAIN>.
 * The bare root domain (or www) is the platform super-admin portal.
 * Local dev: http://acme.localhost:5173 (modern browsers resolve *.localhost to 127.0.0.1).
 */
export const ROOT_DOMAIN = (import.meta.env.VITE_ROOT_DOMAIN || 'localhost').toLowerCase();

export function tenantSlug(): string | null {
  const host = window.location.hostname.toLowerCase();
  if (host === ROOT_DOMAIN || !host.endsWith(`.${ROOT_DOMAIN}`)) return null;
  const sub = host.slice(0, -(ROOT_DOMAIN.length + 1));
  return sub && sub !== 'www' && !sub.includes('.') ? sub : null;
}

/** Full URL of a company's subdomain, keeping the current protocol and port. */
export function tenantUrl(slug: string) {
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${ROOT_DOMAIN}${port ? `:${port}` : ''}`;
}

export function platformUrl() {
  const { protocol, port } = window.location;
  return `${protocol}//${ROOT_DOMAIN}${port ? `:${port}` : ''}`;
}
