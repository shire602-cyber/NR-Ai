function cleanPath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/';
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return trimmed || '/';
}

export function isFirmWorkspacePath(pathname: string): boolean {
  const path = cleanPath(pathname);
  return path === '/firm' || path.startsWith('/firm/');
}

export function shouldClearClientWorkspaceForPath(pathname: string): boolean {
  return isFirmWorkspacePath(pathname);
}
