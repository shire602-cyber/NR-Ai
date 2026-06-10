import type { Express, Request, Response } from 'express';
import { authMiddleware, requireCustomer } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';
import { requireFeature } from '../middleware/featureGate';
import { storage } from '../storage';
import crypto from 'crypto';

export function registerApiKeyRoutes(app: Express) {
  // =====================================
  // API KEY MANAGEMENT
  // =====================================

  // List all API keys for a company (masked)
  app.get(
    '/api/companies/:companyId/api-keys',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      const keys = await storage.getApiKeysByCompanyId(companyId);

      // Return masked keys — never expose keyHash
      const masked = keys.map(({ keyHash, ...key }) => ({
        ...key,
        keyPrefix: `muh_${key.keyPrefix}...`,
      }));

      res.json(masked);
    }),
  );

  // Create a new API key
  app.post(
    '/api/companies/:companyId/api-keys',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { companyId } = req.params;
      const { name, scopes } = req.body;

      const hasAccess = await storage.hasCompanyAccess(userId, companyId);
      if (!hasAccess) {
        return res.status(403).json({ message: 'Access denied' });
      }

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ message: 'API key name is required' });
      }

      // Generate a random 32-byte hex key
      const rawKey = crypto.randomBytes(32).toString('hex');
      const keyPrefix = rawKey.substring(0, 8);
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      const created = await storage.createApiKey({
        companyId,
        name: name.trim(),
        keyHash,
        keyPrefix,
        scopes: scopes || 'read',
        createdBy: userId,
        isActive: true,
      });

      // Return the full key ONLY on creation — it can never be retrieved again
      const { keyHash: _hash, ...safeKey } = created;
      res.status(201).json({
        ...safeKey,
        key: rawKey,
        keyPrefix: `muh_${keyPrefix}...`,
      });
    }),
  );

  // Update an API key (name, scopes, isActive)
  app.put(
    '/api/api-keys/:id',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
    asyncHandler(async (req: Request, res: Response) => {
      const userId = (req as any).user.id;
      const { id } = req.params;
      const { name, scopes, isActive } = req.body;

      // Fetch existing key to verify ownership
      const keys = await storage.getApiKeysByCompanyId('');
      // We need to find this key across companies the user can access
      // Instead, update and verify via the key's company
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
        return res.status(403).json({ message: 'Access denied' });
      }

      const updateData: Record<string, any> = {};
      if (name !== undefined) updateData.name = name.trim();
      if (scopes !== undefined) updateData.scopes = scopes;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updated = await storage.updateApiKey(id, updateData);
      const { keyHash: _hash, ...safeKey } = updated;

      res.json({
        ...safeKey,
        keyPrefix: `muh_${safeKey.keyPrefix}...`,
      });
    }),
  );

  // Delete/revoke an API key
  app.delete(
    '/api/api-keys/:id',
    authMiddleware,
    requireCustomer,
    requireFeature('apiAccess'),
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
        return res.status(403).json({ message: 'Access denied' });
      }

      await storage.deleteApiKey(id);
      res.json({ message: 'API key revoked successfully' });
    }),
  );
}
