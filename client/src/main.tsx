import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './App.css';
import App from './App';

function installCrashOverlay() {
  let overlay: HTMLDivElement | null = null;
  const show = (title: string, detail: string) => {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.zIndex = '99999';
      overlay.style.background = 'rgba(0, 0, 0, 0.92)';
      overlay.style.color = '#ffb3b3';
      overlay.style.padding = '16px';
      overlay.style.fontFamily = 'monospace';
      overlay.style.whiteSpace = 'pre-wrap';
      overlay.style.overflow = 'auto';
      document.body.appendChild(overlay);
    }
    overlay.textContent = `${title}\n\n${detail}`;
  };

  window.addEventListener('error', (event) => {
    const message = event.error?.stack ?? event.message ?? 'Unknown error';
    show('Runtime error', message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const message = typeof reason === 'string'
      ? reason
      : reason?.stack ?? reason?.message ?? JSON.stringify(reason, null, 2);
    show('Unhandled promise rejection', message);
  });
}

installCrashOverlay();

function isPrivateIpv4(hostname: string): boolean {
  return /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
}

function isLanOrLocalHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.local')
    || isPrivateIpv4(hostname);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

const hostname = window.location.hostname;
const shouldUseServiceWorker = 'serviceWorker' in navigator
  && window.location.protocol === 'https:'
  && !isLanOrLocalHost(hostname);

if ('serviceWorker' in navigator && !shouldUseServiceWorker) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) void registration.unregister();
  }).catch(() => {});
}

if (shouldUseServiceWorker) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
