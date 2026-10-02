// Linking a company to a bank feed: the provider customer of the company, and the proof that an entity (a bank login
// made in the browser through the Link SDK) belongs to THAT customer. The browser only reports an entity id, so without
// this check any signed-in user could attach another tenant's bank by guessing or reusing an id.

import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { bankProviderCustomers } from "../../shared/schema";
import { AppError } from "../errors";
import { LeanClient, type ProviderEntity } from "./open-banking.service";

const PROVIDER = "lean";

/** The company's customer id at the provider, created on first use. */
export async function ensureProviderCustomer(client: LeanClient, companyId: string): Promise<string> {
  const find = async () => {
    const [row] = await db
      .select()
      .from(bankProviderCustomers)
      .where(and(eq(bankProviderCustomers.companyId, companyId), eq(bankProviderCustomers.provider, PROVIDER)));
    return row?.externalCustomerId ?? null;
  };
  const existing = await find();
  if (existing) return existing;
  const created = await client.createCustomer(companyId);
  await db.insert(bankProviderCustomers).values({ companyId, provider: PROVIDER, externalCustomerId: created }).onConflictDoNothing();
  return (await find()) ?? created;
}

export async function providerCustomerOf(companyId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(bankProviderCustomers)
    .where(and(eq(bankProviderCustomers.companyId, companyId), eq(bankProviderCustomers.provider, PROVIDER)));
  return row?.externalCustomerId ?? null;
}

/**
 * The entities of this company's customer created since `sinceYmd` (the day its Link session started), newest first.
 * The provider lists per application and date range only, so the window is kept narrow and the filter is ours.
 */
export async function latestEntitiesForCompany(client: LeanClient, companyId: string, sinceYmd: string): Promise<ProviderEntity[]> {
  const customerId = await providerCustomerOf(companyId);
  if (!customerId) return [];
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const entities = await client.listEntities(sinceYmd, tomorrow);
  return entities
    .filter((e) => e.customerId === customerId)
    .sort((a, b) => Date.parse(b.createdAt ?? "") - Date.parse(a.createdAt ?? "") || 0);
}

/** 403 BANK_ENTITY_NOT_OWNED unless the entity exists at the provider and belongs to this company's customer. */
export async function assertEntityOwned(client: LeanClient, companyId: string, entityId: unknown, sinceYmd: string): Promise<string> {
  const denied = new AppError({ message: "This bank login does not belong to this company.", statusCode: 403, code: "BANK_ENTITY_NOT_OWNED" });
  if (typeof entityId !== "string" || !/^[0-9a-fA-F-]{8,64}$/.test(entityId)) throw denied;
  const entity = (await latestEntitiesForCompany(client, companyId, sinceYmd)).find((e) => e.id === entityId);
  if (!entity) throw denied;
  return entity.id;
}
