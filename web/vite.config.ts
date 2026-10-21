import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['.localhost'], // company subdomains, e.g. acme.localhost
    proxy: { '/api': 'http://localhost:3000' },
  },
});
