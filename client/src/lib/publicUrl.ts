export function publicUrl(path: string): string {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }

  const base = import.meta.env.BASE_URL || '/';
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (cleanBase && cleanBase !== '/' && (cleanPath === cleanBase || cleanPath.startsWith(`${cleanBase}/`))) {
    return cleanPath;
  }
  return cleanBase === '' ? cleanPath : `${cleanBase}${cleanPath}`;
}
