import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  AppError,
  NotFoundError,
  BadRequestError,
  globalErrorHandler,
  asyncHandler,
} from '../../server/middleware/errorHandler';
import { ZodError } from 'zod';

// Mock logger
vi.mock('../../server/config/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock('../../server/config/env', () => ({
  isProduction: () => false,
  getEnv: () => ({
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long-unique',
  }),
}));

function createMockRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: '/test',
    headers: {},
    ...overrides,
  } as Request;
}

describe('Error Handler Middleware', () => {
  describe('AppError', () => {
    it('should create an error with status code', () => {
      const error = new AppError('Not Found', 404);
      expect(error.message).toBe('Not Found');
      expect(error.statusCode).toBe(404);
      expect(error.isOperational).toBe(true);
    });

    it('should support non-operational errors', () => {
      const error = new AppError('Internal', 500, false);
      expect(error.isOperational).toBe(false);
    });
  });

  describe('Error factories', () => {
    it('should create NotFoundError', () => {
      const error = NotFoundError('User');
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('User not found');
    });

    it('should create BadRequestError', () => {
      const error = BadRequestError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe('Invalid input');
    });
  });

  describe('globalErrorHandler', () => {
    it('should handle AppError correctly', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const error = new AppError('Not Found', 404);

      globalErrorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ message: 'Not Found' });
    });

    it('should handle ZodError with validation details', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['email'],
          message: 'Required',
        },
      ]);

      globalErrorHandler(zodError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Validation error',
          errors: expect.any(Object),
        })
      );
    });

    it('should handle unknown errors with 500', () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const error = new Error('Something broke');

      globalErrorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('asyncHandler', () => {
    it('should pass resolved value through', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;

      const handler = asyncHandler(async (_req, res) => {
        res.json({ ok: true });
      });

      await handler(req, res, next);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it('should catch rejected promises and call next', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = vi.fn() as NextFunction;
      const error = new Error('Async failure');

      const handler = asyncHandler(async () => {
        throw error;
      });

      await handler(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
