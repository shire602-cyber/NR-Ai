/**
 * E-commerce route helpers (W5-B, R19-03, R19-08): schemas, secret masking and the
 * per-integration permission check. The routes are registered in
 * server/routes/analytics.routes.ts (registerEcommerceRoutes).
 */
import type { Request } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { ecommerceIntegrations, type EcommerceIntegration } from "../../../shared/schema";
import { getCompanyRole } from "../../middleware/companyRolePolicy";
import { DomainError } from "../../errors";
import { zText, zUuid } from "../../../shared/validators/primitives";
import { roleHasAnyPermission, type Permission } from "../../../shared/permissions";
import { isNraFirmRole } from "../../../shared/access";
import { ECOMMERCE_PLATFORMS } from "./index";

/** Credentials never leave the server once stored — responses carry presence flags only. */
export function maskIntegrationSecrets(integration: EcommerceIntegration) {
  const { apiKey, accessToken, refreshToken, webhookSecret, ...rest } = integration;
  return {
    ...rest,
    hasApiKey: !!apiKey,
    hasAccessToken: !!accessToken,
    hasRefreshToken: !!refreshToken,
    hasWebhookSecret: !!webhookSecret,
  };
}

export const companyQuery = z.object({ companyId: zUuid }).passthrough();

export const connectBody = z
  .object({
    companyId: zUuid,
    platform: z.enum(ECOMMERCE_PLATFORMS),
    shopDomain: zText(255).optional().nullable(),
    accessToken: zText(500).optional().nullable(),
    apiKey: zText(500).optional().nullable(),
  })
  .strict();

export const toggleBody = z.object({ isActive: z.boolean() }).strict();

/** Load an integration and check the caller's permission in its company (404 for non-members). */
export async function integrationFor(
  req: Request,
  permission: Permission | null
): Promise<EcommerceIntegration> {
  const id = req.params.integrationId;
  const parsed = zUuid.safeParse(id);
  if (!parsed.success) throw new DomainError("NOT_FOUND", 404, undefined, "Integration not found");
  const [integration] = await db
    .select()
    .from(ecommerceIntegrations)
    .where(eq(ecommerceIntegrations.id, parsed.data));
  if (!integration) throw new DomainError("NOT_FOUND", 404, undefined, "Integration not found");
  const user = req.user!;
  if (user.isAdmin || isNraFirmRole(user.firmRole)) return integration;
  const role = await getCompanyRole(user.id, integration.companyId);
  if (!role) throw new DomainError("NOT_FOUND", 404, undefined, "Integration not found");
  if (permission && !roleHasAnyPermission(role, [permission])) {
    throw new DomainError("PERMISSION_DENIED", 403, { permission, role });
  }
  return integration;
}
