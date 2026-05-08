import { spawn } from 'node:child_process';
import net from 'node:net';

const BACKEND_PORT = 43991;
const SERVER_INSPECT_PORT = 9230;
const CLIENT_INSPECT_PORT = 9231;

let shuttingDown = false;
const children = new Set();

function spawnChild(command, args, label, cwd = process.cwd()) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`[dev-stack] ${label} exited with code=${code} signal=${signal ?? 'none'}`);
      shutdown(code ?? 1);
    }
  });

  return child;
}

function runStep(command, args, label, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });

    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} exited with code=${code} signal=${signal ?? 'none'}`));
    });
  });
}

function waitForPort(port, timeoutMs = 15_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });

      socket.once('connect', () => {
        socket.end();
        resolve();
      });

      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for port ${port}`));
          return;
        }
        setTimeout(tryConnect, 150);
      });
    };

    tryConnect();
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    stopChild(child);
  }

  setTimeout(() => process.exit(exitCode), 250);
}

function stopChild(child) {
  if (child.killed || !child.pid) return;

  if (process.platform === 'win32') {
    spawn('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${child.pid} -Force -ErrorAction SilentlyContinue`], {
      stdio: 'ignore',
      shell: false,
    });
    return;
  }

  child.kill();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) {
    stopChild(child);
  }
});

const serverDir = new URL('../server/', import.meta.url);
const clientDir = new URL('../client/', import.meta.url);

spawnChild(
  process.execPath,
  [`--inspect=${SERVER_INSPECT_PORT}`, '--import', 'tsx', 'src/server.ts'],
  'server',
  serverDir,
);

try {
  await waitForPort(BACKEND_PORT);
  console.log(`[dev-stack] backend ready on :${BACKEND_PORT}; starting Vite`);
  await runStep(process.execPath, ['./scripts/generate-atlases.mjs'], 'client atlas generation', clientDir);
  spawnChild(
    process.execPath,
    [`--inspect=${CLIENT_INSPECT_PORT}`, 'node_modules/vite/bin/vite.js'],
    'client',
    clientDir,
  );
} catch (error) {
  console.error(`[dev-stack] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
}
