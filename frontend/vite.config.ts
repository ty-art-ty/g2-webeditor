import { defineConfig } from 'vite';

// Dev-Proxy aufs Backend, damit `npm run dev` ohne CORS-Gefrickel funktioniert.
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
