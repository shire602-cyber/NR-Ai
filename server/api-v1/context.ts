import type { Request, Response } from "express";

/** What the key middleware learned about the caller; lives on req and res.locals. */
export interface V1Context {
  keyId: string;
  keyPrefix: string;
  companyId: string;
  userId: string;
  scopes: string[];
  ratePerMinute: number;
  ratePerDay: number;
}

declare global {
  namespace Express {
    interface Request {
      v1?: V1Context;
    }
  }
}

export function ctx(req: Request): V1Context {
  if (!req.v1) throw new Error("v1 context missing: apiKeyAuth must run first");
  return req.v1;
}

export type AfterJsonHook = (status: number, body: unknown) => Promise<void> | void;

export function addAfterJsonHook(res: Response, hook: AfterJsonHook): void {
  const hooks: AfterJsonHook[] = (res.locals.v1Hooks ??= []);
  hooks.push(hook);
}

/** Optional async mapper that turns an internal 2xx body into the v1 resource. */
export type SuccessMapper = (status: number, body: any, req: Request) => Promise<unknown> | unknown;
