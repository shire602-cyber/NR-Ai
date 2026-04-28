import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requestId } from '../../server/middleware/requestId';

function createMockRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    _headers: headers,
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v;
    }),
  } as unknown as Response & { _headers: Record<string, string> };
  return res;
}

function createMockReq(headers: Record<string, string> = {}): Request {
  return {
    headers,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe('requestId middleware', () => {
  it('mints a UUID when no header is present', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(res._headers['X-Request-Id']).toBe(req.id);
    expect(next).toHaveBeenCalledOnce();
  });

  it('honors a sane upstream X-Request-Id', () => {
    const req = createMockReq({ 'x-request-id': 'trace-abc.123' });
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.id).toBe('trace-abc.123');
    expect(res._headers['X-Request-Id']).toBe('trace-abc.123');
  });

  it('rejects unsafe characters and mints a fresh id', () => {
    const req = createMockReq({ 'x-request-id': '<script>alert(1)</script>' });
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.id).not.toBe('<script>alert(1)</script>');
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects oversized request ids', () => {
    const huge = 'a'.repeat(300);
    const req = createMockReq({ 'x-request-id': huge });
    const res = createMockRes();
    const next = vi.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.id).not.toBe(huge);
    expect(req.id.length).toBeLessThanOrEqual(128);
  });
});
