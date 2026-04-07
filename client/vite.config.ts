import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Serve extracted UQM assets at root (e.g. /ships/human/cruiser-big-000.png)
  // Assets are gitignored; extract per SETUP.md before running.
  publicDir: path.resolve(__dirname, '../assets'),
  resolve: {
    alias: {
      shared: path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true },
      '/api': { target: 'http://localhost:3001' },
    },
  },
});
