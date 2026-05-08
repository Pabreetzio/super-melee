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
const ROOT_APP_ROUTES = [
  '/net',
  '/styles',
  '/bg-builder',
  '/typography',
  '/settings',
];

function withBasePath(url: string): string {
  return `${BASE_PATH}${url}`;
}

function rootRouteMatches(url: string, route: string): boolean {
  return url === route || url.startsWith(`${route}/`) || url.startsWith(`${route}?`);
}

function configureWebSocketProxy(proxy: { on: (event: string, handler: (err: NodeJS.ErrnoException) => void) => void }) {
  proxy.on('error', (err) => {
    if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') return;
    console.warn(`[vite proxy] websocket error: ${err.message}`);
  });
}

export default defineConfig({
  base: `${BASE_PATH}/`,
  plugins: [
    {
      name: 'super-melee-dev-base-rewrite',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url?.startsWith(`${BASE_PATH}${BASE_PATH}/`)) {
            req.url = req.url.slice(BASE_PATH.length);
          } else if (req.url === '/' || req.url === BASE_PATH) {
            req.url = withBasePath('/');
          } else if (req.url && !req.url.startsWith(`${BASE_PATH}/`) && ROOT_DEV_PREFIXES.some(prefix => req.url!.startsWith(prefix))) {
            req.url = withBasePath(req.url);
          } else if (req.url && ROOT_APP_ROUTES.some(route => rootRouteMatches(req.url!, route))) {
            req.url = withBasePath(req.url);
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
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
        configure: configureWebSocketProxy,
      },
      '/super-melee/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
        rewrite: (p) => p.replace(/^\/super-melee/, ''),
        configure: configureWebSocketProxy,
      },
      '/api': { target: `http://localhost:${BACKEND_PORT}` },
      '/super-melee/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        rewrite: (p) => p.replace(/^\/super-melee/, ''),
      },
    },
  },
});
