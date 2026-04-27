import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requestId } from '../../server/middleware/requestId';

function mockReq(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    getHeader: (name: string) => headers[name],
    headers,
  } as unknown as Response & { headers: Record<string, string> };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('requestId middleware', () => {
  it('generates a UUID and attaches it to req and response header', () => {
    const req = mockReq();
    const res = mockRes();
    const next: NextFunction = vi.fn();

    requestId(req, res, next);

    expect(req.id).toBeDefined();
    expect(UUID_RE.test(req.id!)).toBe(true);
    expect(res.headers['X-Request-Id']).toBe(req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it('honors a valid inbound X-Request-Id header for trace propagation', () => {
    const inbound = '11111111-2222-3333-4444-555555555555';
    const req = mockReq({ 'x-request-id': inbound });
    const res = mockRes();

    requestId(req, res, vi.fn());

    expect(req.id).toBe(inbound);
    expect(res.headers['X-Request-Id']).toBe(inbound);
  });

  it('rejects a malformed inbound X-Request-Id and generates a fresh one', () => {
    const req = mockReq({ 'x-request-id': 'not-a-uuid; <script>' });
    const res = mockRes();

    requestId(req, res, vi.fn());

    expect(req.id).not.toBe('not-a-uuid; <script>');
    expect(UUID_RE.test(req.id!)).toBe(true);
  });
});
