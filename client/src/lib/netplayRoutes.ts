const ROOM_PATH_PATTERN = /^\/net\/([A-Za-z0-9]+)\/?$/;

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export function roomCodeFromPathname(pathname: string): string | null {
  const match = pathname.match(ROOM_PATH_PATTERN);
  if (!match) return null;
  const normalized = normalizeRoomCode(match[1] ?? '');
  return normalized || null;
}

export function roomPath(code: string): string {
  return `/net/${normalizeRoomCode(code)}`;
}

export function roomUrl(code: string): string {
  return new URL(roomPath(code), window.location.origin).toString();
}
