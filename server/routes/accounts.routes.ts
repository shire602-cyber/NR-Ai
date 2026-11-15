import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import type { Account } from "../../shared/schema";
import { recordAudit } from "../services/audit.service";
import { strictBody } from "../http/strict-body";
import { parsedBody } from "../http/parsed-body";
import { DomainError } from "../errors";
import {
  archiveAccountBody,
  createAccountBody,
  isSubTypeForType,
  updateAccountBody,
  type CreateAccountBody,
  type UpdateAccountBody,
} from "../../shared/validators/accounts";

/**
 * A parent must be in the same company, of the same account type, and must not be the account
 * itself or one of its descendants (cycle check walks up from the candidate parent).
 */
async function assertValidParent(
  companyId: string,
  type: string,
  parentId: string,
  selfId?: string
): Promise<void> {
  if (selfId && parentId === selfId) {
    throw new DomainError(
      "ACCOUNT_PARENT_CYCLE",
      400,
      undefined,
      "An account cannot be its own parent"
    );
  }
  const all = await storage.getAccountsByCompanyId(companyId);
  const byId = new Map(all.map((a) => [a.id, a]));
  const parent = byId.get(parentId);
  if (!parent)
    throw new DomainError("ACCOUNT_PARENT_NOT_FOUND", 404, undefined, "Parent account not found");
  if (parent.type !== type) {
    throw new DomainError(
      "ACCOUNT_PARENT_TYPE_MISMATCH",
      400,
      undefined,
      "A parent account must have the same account type"
    );
  }
  const seen = new Set<string>();
  let cursor: Account | undefined = parent;
  while (cursor) {
    if (selfId && cursor.id === selfId) {
      throw new DomainError(
        "ACCOUNT_PARENT_CYCLE",
        400,
        undefined,
        "Account hierarchy cannot contain a cycle"
      );
    }
    if (seen.has(cursor.id)) break;
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
}

// Walk the user's companies and return the first match. Storage queries are
// already tenant-scoped, so this also enforces the access check — if no
// company owns the row, the user has no business seeing it.
async function findAccountForUser(userId: string, accountId: string): Promise<Account | undefined> {
  const userCompanies = await storage.getCompaniesByUserId(userId);
  for (const c of userCompanies) {
    const account = await storage.getAccount(accountId, c.id);
    if (account) return account;
  }
  return undefined;
}

export function registerAccountRoutes(app: Express) {
  // =====================================
  // Account Routes
  // =====================================

  // Customer-only: Full chart of accounts access
  app.get(
    "/api/companies/:companyId/accounts",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const accounts = await storage.getAccountsByCompanyId(companyId);
      res.json(accounts);
    })
  );

  // Customer-only: Create accounts
  app.post(
    "/api/companies/:companyId/accounts",
    authMiddleware,
    requireCustomer,
    strictBody(createAccountBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      // Verify company access
      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const body = parsedBody<CreateAccountBody>(req);
      if (body.parentId) await assertValidParent(companyId, body.type, body.parentId);

      const account = await storage.createAccount({
        ...body,
        subType: body.subType ?? null,
        parentId: body.parentId ?? null,
        companyId,
        isSystemAccount: false,
      });

      await recordAudit({
        userId,
        companyId,
        action: "account.create",
        entityType: "account",
        entityId: account.id,
        before: null,
        after: { code: account.code, type: account.type, nameEn: account.nameEn },
        req,
      });

      res.json(account);
    })
  );

  // Customer-only: Update accounts
  app.put(
    "/api/accounts/:id",
    authMiddleware,
    requireCustomer,
    strictBody(updateAccountBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;
      const body = parsedBody<UpdateAccountBody>(req);

      // Find which of the user's companies owns this account.
      const account = await findAccountForUser(userId, id);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      // System accounts are wired into posting logic: their identity cannot change.
      if (
        account.isSystemAccount &&
        ((body.type !== undefined && body.type !== account.type) ||
          (body.code !== undefined && body.code !== account.code))
      ) {
        throw new DomainError(
          "SYSTEM_ACCOUNT_LOCKED",
          409,
          undefined,
          "System accounts cannot change code or type."
        );
      }

      // Block account type changes once the account has any journal lines.
      // Switching e.g. an asset to an income account would silently invert all
      // historical balances on every report.
      if (body.type !== undefined && body.type !== account.type) {
        const hasTransactions = await storage.accountHasTransactions(id);
        if (hasTransactions) {
          return res.status(422).json({
            message: "Cannot change account type — account has existing transactions.",
          });
        }
      }

      const nextType = body.type ?? account.type;
      const nextSubType = body.subType === undefined ? account.subType : body.subType;
      if (nextSubType && !isSubTypeForType(nextType, nextSubType)) {
        throw new DomainError(
          "ACCOUNT_SUB_TYPE_MISMATCH",
          400,
          { subType: nextSubType, type: nextType },
          `Sub type "${nextSubType}" is not valid for a ${nextType} account`
        );
      }
      if (body.parentId) await assertValidParent(account.companyId, nextType, body.parentId, id);

      const updatedAccount = await storage.updateAccount(id, account.companyId, {
        ...body,
        updatedAt: new Date(),
      });

      // Account-type changes are especially sensitive — they re-classify how
      // every existing balance rolls into the trial balance / financial
      // statements — so log them with extra emphasis.
      const typeChanged = body.type && body.type !== account.type;
      await recordAudit({
        userId,
        companyId: account.companyId,
        action: typeChanged ? "account.type_change" : "account.update",
        entityType: "account",
        entityId: id,
        before: { code: account.code, type: account.type, nameEn: account.nameEn },
        after: {
          code: updatedAccount.code,
          type: updatedAccount.type,
          nameEn: updatedAccount.nameEn,
        },
        req,
      });

      res.json(updatedAccount);
    })
  );

  // Customer-only: Archive accounts (soft delete)
  app.post(
    "/api/accounts/:id/archive",
    authMiddleware,
    requireCustomer,
    strictBody(archiveAccountBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const account = await findAccountForUser(userId, id);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      // System accounts cannot be archived (pre-check for better error message)
      if (account.isSystemAccount) {
        return res.status(409).json({
          message:
            "System accounts cannot be archived. These are essential for proper bookkeeping.",
        });
      }

      try {
        const archivedAccount = await storage.archiveAccountForCompany(id, account.companyId);
        await recordAudit({
          userId,
          companyId: account.companyId,
          action: "account.archive",
          entityType: "account",
          entityId: id,
          before: { code: account.code, isArchived: false, isActive: account.isActive },
          after: { code: account.code, isArchived: true, isActive: false },
          req,
          extra: { reason: (req.body as { reason?: string | null }).reason ?? null },
        });
        res.json(archivedAccount);
      } catch (archiveError: any) {
        // Handle race condition where account was marked as system between read and update
        if (archiveError.message.includes("system account")) {
          return res.status(409).json({
            message:
              "System accounts cannot be archived. These are essential for proper bookkeeping.",
          });
        }
        throw archiveError;
      }
    })
  );

  // Customer-only: Unarchive accounts
  app.post(
    "/api/accounts/:id/unarchive",
    authMiddleware,
    requireCustomer,
    strictBody(archiveAccountBody),
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const account = await findAccountForUser(userId, id);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      const unarchivedAccount = await storage.updateAccount(id, account.companyId, {
        isArchived: false,
        isActive: true,
        updatedAt: new Date(),
      });
      await recordAudit({
        userId,
        companyId: account.companyId,
        action: "account.unarchive",
        entityType: "account",
        entityId: id,
        before: { code: account.code, isArchived: account.isArchived },
        after: { code: account.code, isArchived: false, isActive: true },
        req,
      });
      res.json(unarchivedAccount);
    })
  );

  // Customer-only: Delete accounts (permanent - only for non-system accounts with no transactions)
  app.delete(
    "/api/accounts/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const account = await findAccountForUser(userId, id);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      // System accounts cannot be deleted
      if (account.isSystemAccount) {
        return res.status(400).json({
          message: "System accounts cannot be deleted. You can archive them instead if needed.",
        });
      }

      // Check if account has any transactions
      const hasTransactions = await storage.accountHasTransactions(id);
      if (hasTransactions) {
        return res.status(400).json({
          message:
            "Cannot delete account with existing transactions. Please archive the account instead, or remove all journal entries first.",
        });
      }

      const siblings = await storage.getAccountsByCompanyId(account.companyId);
      if (siblings.some((a) => a.parentId === id)) {
        throw new DomainError(
          "ACCOUNT_HAS_CHILDREN",
          409,
          undefined,
          "Cannot delete an account that has child accounts. Move or delete them first."
        );
      }

      await storage.deleteAccount(id, account.companyId);
      await recordAudit({
        userId,
        companyId: account.companyId,
        action: "account.delete",
        entityType: "account",
        entityId: id,
        before: { code: account.code, type: account.type, nameEn: account.nameEn },
        after: null,
        req,
      });
      res.json({ message: "Account deleted successfully" });
    })
  );

  // Get accounts with balances for Chart of Accounts
  // Customer-only: Accounts with balances
  app.get(
    "/api/companies/:companyId/accounts-with-balances",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { companyId } = req.params;
      const userId = (req as any).user.id;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const { dateStart, dateEnd } = req.query;
      let dateRange: { start: Date; end: Date } | undefined;

      if (dateStart && dateEnd) {
        dateRange = {
          start: new Date(dateStart as string),
          end: new Date(dateEnd as string),
        };
      }

      const accountsWithBalances = await storage.getAccountsWithBalances(companyId, dateRange);
      res.json(accountsWithBalances);
    })
  );

  // Get account ledger
  // Customer-only: Account ledger
  app.get(
    "/api/accounts/:id/ledger",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params;
      const userId = (req as any).user.id;

      const account = await findAccountForUser(userId, id);
      if (!account) {
        return res.status(404).json({ message: "Account not found" });
      }

      const { dateStart, dateEnd, search, limit, offset } = req.query;

      const options: {
        dateStart?: Date;
        dateEnd?: Date;
        search?: string;
        limit?: number;
        offset?: number;
      } = {};

      if (dateStart) options.dateStart = new Date(dateStart as string);
      if (dateEnd) options.dateEnd = new Date(dateEnd as string);
      if (search) options.search = search as string;
      if (limit) options.limit = parseInt(limit as string);
      if (offset) options.offset = parseInt(offset as string);

      const ledger = await storage.getAccountLedger(id, options);
      res.json(ledger);
    })
  );
}
