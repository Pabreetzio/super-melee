const PROXY_BASE_PATH = '/super-melee';
const ROOM_PATH_PATTERN = /^\/net\/([A-Za-z0-9]+)\/?$/;

export function appBasePath(pathname = window.location.pathname): string {
  return pathname === PROXY_BASE_PATH || pathname.startsWith(`${PROXY_BASE_PATH}/`)
    ? PROXY_BASE_PATH
    : '';
}

export function stripAppBase(pathname: string): string {
  const base = appBasePath(pathname);
  if (!base) return pathname;
  const stripped = pathname.slice(base.length);
  return stripped === '' ? '/' : stripped;
}

export function withAppBase(pathname: string): string {
  const base = appBasePath();
  if (!base) return pathname;
  return `${base}${pathname === '/' ? '' : pathname}`;
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export function roomCodeFromPathname(pathname: string): string | null {
  const match = stripAppBase(pathname).match(ROOM_PATH_PATTERN);
  if (!match) return null;
  const normalized = normalizeRoomCode(match[1] ?? '');
  return normalized || null;
}

export function roomPath(code: string): string {
  return withAppBase(`/net/${normalizeRoomCode(code)}`);
}

export function roomUrl(code: string): string {
  return new URL(roomPath(code), window.location.origin).toString();
}
