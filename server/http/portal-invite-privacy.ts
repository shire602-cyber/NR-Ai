/** Keep invitation request targets out of logs, including retired token-in-path endpoints. */
export function portalInviteLogPath(url: string): string | undefined {
  const path = url
    .replace(/^https?:\/\/[^/]+/i, "")
    .split(/[?#]/, 1)[0]
    .toLowerCase();
  if (/^\/api\/portal-invitations(?:\/|$)/.test(path)) return "/api/portal-invitations";
  if (/^\/portal\/join\/?$/.test(path)) return "/portal/join";
  if (
    /^\/api\/companies\/[^/]+\/(?:customer-contacts\/[^/]+\/)?portal-invitations(?:\/|$)/.test(path)
  ) {
    return "/api/companies/:companyId/portal-invitations";
  }
  return undefined;
}
