import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Same variable as the API (Railway passes service variables to the build too).
  // VITE_SUPER_ADMIN_ENABLED overrides it for the frontend only. Unset = follow the server.
  const raw = (env.VITE_SUPER_ADMIN_ENABLED ?? env.SUPER_ADMIN_ENABLED ?? '').trim();
  const buildMode = raw === '' ? '' : /^(1|true|yes|on)$/i.test(raw) ? 'multi' : 'single';

  return {
    plugins: [react()],
    define: {
      __BUILD_MODE__: JSON.stringify(buildMode),
    },
    server: {
      port: 5173,
      allowedHosts: ['.localhost'], // company subdomains, e.g. acme.localhost
      proxy: { '/api': 'http://localhost:3000' },
    },
  };
});
