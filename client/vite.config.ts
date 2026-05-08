import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const BACKEND_PORT = 43991;
const BASE_PATH = '/super-melee';
const ROOT_DEV_PREFIXES = [
  '/@vite',
  '/@react-refresh',
  '/@id/',
  '/@fs/',
  '/node_modules/.vite/',
  '/node_modules/vite/',
  '/src/',
  '/atlases/',
  '/battle/',
  '/fonts/',
  '/icons/',
  '/music/',
  '/ships/',
  '/sounds/',
  '/manifest.webmanifest',
  '/meleemenu-',
];

export default defineConfig({
  base: `${BASE_PATH}/`,
  plugins: [
    {
      name: 'super-melee-dev-base-rewrite',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === BASE_PATH) {
            req.url = `${BASE_PATH}/`;
          } else if (req.url && !req.url.startsWith(`${BASE_PATH}/`) && ROOT_DEV_PREFIXES.some(prefix => req.url!.startsWith(prefix))) {
            req.url = `${BASE_PATH}${req.url}`;
          }
          next();
        });
      },
    },
    react(),
  ],
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
    allowedHosts: true,
    port: 43187,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${BACKEND_PORT}`, ws: true },
      '/super-melee/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
        rewrite: (p) => p.replace(/^\/super-melee/, ''),
      },
      '/api': { target: `http://localhost:${BACKEND_PORT}` },
      '/super-melee/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        rewrite: (p) => p.replace(/^\/super-melee/, ''),
      },
    },
  },
});
