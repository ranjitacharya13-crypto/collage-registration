 import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Development-only: permits ngrok's temporary public tunnel hostname.
    allowedHosts: true,
    proxy: { '/api': 'http://127.0.0.1:1215' },
  },
});
