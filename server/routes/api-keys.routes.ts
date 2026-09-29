import type { Express, Request, Response } from "express";
import { authMiddleware, requireCustomer } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { storage } from "../storage";
import { sendNotAvailable } from "../utils/not-available";

/**
 * No middleware authenticates requests with these keys and there is no public
 * API, so issuing a key would be a false promise. Listing and revoking stay
 * available so any keys created earlier can still be removed. Restore key
 * creation only together with the authenticating middleware and public API.
 */
const API_KEYS_ISSUANCE_MESSAGE =
  "API keys are not available yet. There is no public API to use them with.";

export function registerApiKeyRoutes(app: Express) {
  // =====================================
  // API KEY MANAGEMENT
  // =====================================

  // List all API keys for a company (masked)
  app.get(
    "/api/companies/:companyId/api-keys",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Access denied" });
      }

      const keys = await storage.getApiKeysByCompanyId(companyId);

      // Return masked keys — never expose keyHash
      const masked = keys.map(({ keyHash, ...key }) => ({
        ...key,
        keyPrefix: `muh_${key.keyPrefix}...`,
      }));

      res.json(masked);
    })
  );

  // Create a new API key — disabled (see API_KEYS_ISSUANCE_MESSAGE)
  app.post(
    "/api/companies/:companyId/api-keys",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      return sendNotAvailable(res, API_KEYS_ISSUANCE_MESSAGE);
    })
  );

  // Update an API key — disabled: re-activating a key would revive a credential
  // nothing can verify. Revoke (DELETE) remains available.
  app.put(
    "/api/api-keys/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (_req: Request, res: Response) => {
      return sendNotAvailable(res, API_KEYS_ISSUANCE_MESSAGE);
    })
  );

  // Delete/revoke an API key
  app.delete(
    "/api/api-keys/:id",
    authMiddleware,
    requireCustomer,
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;

      // Verify access via the user's companies
      const allCompanies = await storage.getCompaniesByUserId(userId);
      let found = false;

      for (const company of allCompanies) {
        const companyKeys = await storage.getApiKeysByCompanyId(company.id);
        if (companyKeys.some((k) => k.id === id)) {
          found = true;
          break;
        }
      }

      if (!found) {
        return res.status(403).json({ message: "Access denied" });
      }

      await storage.deleteApiKey(id);
      res.json({ message: "API key revoked successfully" });
    })
  );
}
