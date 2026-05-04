import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../client/src/lib/queryClient';
import { clearCsrfToken } from '../../client/src/lib/csrf';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

describe('apiRequest CSRF recovery', () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  it('refetches the CSRF token and replays one failed mutation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'stale-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'CSRF_INVALID', message: 'Invalid or missing CSRF token' }, { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest('PATCH', '/api/companies/company-1', { name: 'Najma' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const firstMutation = fetchMock.mock.calls[1][1] as RequestInit;
    expect(firstMutation.credentials).toBe('include');
    expect((firstMutation.headers as Record<string, string>)['x-csrf-token']).toBe('stale-token');

    const retryMutation = fetchMock.mock.calls[3][1] as RequestInit;
    expect(retryMutation.credentials).toBe('include');
    expect((retryMutation.headers as Record<string, string>)['x-csrf-token']).toBe('fresh-token');
  });

  it('returns null for successful empty responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'token' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('DELETE', '/api/backups/backup-1')).resolves.toBeNull();
  });
});
