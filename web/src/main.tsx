/**
 * Loads the deployment's settings before starting the app, because how the current company is
 * worked out (single company, subdomain or /<company> path) depends on them.
 *
 * The mode comes from SUPER_ADMIN_ENABLED, read by both sides:
 *  - the frontend build bakes it in (__BUILD_MODE__, see vite.config.ts)
 *  - the API reads it at startup and sends it here (injected into index.html, or /api/auth/config in dev)
 * If both are known and disagree, the app stops with an explanation instead of half-working.
 */
declare const __BUILD_MODE__: '' | 'single' | 'multi';

const label = (m: string) => (m === 'single' ? 'false (single company)' : 'true (multi-company)');

function showMismatch(buildMode: string, serverMode: string) {
  document.getElementById('root')!.innerHTML = `
    <div style="max-width:560px;margin:15vh auto;padding:24px;font-family:system-ui,sans-serif;line-height:1.5;color:#1b2430">
      <h2 style="margin:0 0 8px">Configuration mismatch</h2>
      <p>The frontend was built with <b>SUPER_ADMIN_ENABLED=${label(buildMode)}</b>, but the server is running with
      <b>SUPER_ADMIN_ENABLED=${label(serverMode)}</b>.</p>
      <p>Set the same value for both (one variable on the Railway service is enough) and redeploy, so the frontend is rebuilt.</p>
    </div>`;
}

async function start() {
  if (!window.__APP_CONFIG__?.mode) {
    try {
      const r = await fetch('/api/auth/config');
      window.__APP_CONFIG__ = { ...window.__APP_CONFIG__, ...(await r.json()) };
    } catch {
      // API not reachable: fall back to the build setting below
    }
  }
  const serverMode = window.__APP_CONFIG__?.mode;
  if (__BUILD_MODE__ && serverMode && __BUILD_MODE__ !== serverMode) {
    showMismatch(__BUILD_MODE__, serverMode);
    return;
  }
  window.__APP_CONFIG__ = { ...window.__APP_CONFIG__, mode: serverMode || __BUILD_MODE__ || 'multi' };
  await import('./boot');
}

start();

export {};
