// Price lists (Phase 8 D1): a named set of unit prices per product, assigned to a customer. A new document
// line for that customer defaults its unit price to the list price (still editable); the line stores the list id.

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { customerContacts, priceListItems, priceLists, products } from "../../shared/schema";
import { AppError } from "../errors";
import { normalizeUnitPrice } from "./document-line-limits";

const refuse = (statusCode: number, code: string, message: string) => new AppError({ message, statusCode, code });

export type PriceListCheck = { ok: true } | { ok: false; code: "PRICE_LIST_NOT_FOUND"; message: string };

/** A price list id from a request must belong to the company (null/undefined = none). */
export async function checkPriceListsForCompany(companyId: string, ids: Array<string | null | undefined>): Promise<PriceListCheck> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return { ok: true };
  if (wanted.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
    return { ok: false, code: "PRICE_LIST_NOT_FOUND", message: "priceListId is not a price list of this company." };
  }
  const rows = await db
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(and(eq(priceLists.companyId, companyId), inArray(priceLists.id, wanted)));
  return rows.length === wanted.length
    ? { ok: true }
    : { ok: false, code: "PRICE_LIST_NOT_FOUND", message: "priceListId is not a price list of this company." };
}

export interface PriceListInput {
  name: string;
  currency?: string;
  isActive?: boolean;
  items?: Array<{ productId: string; unitPrice: number }>;
}

async function assertProducts(companyId: string, productIds: string[]) {
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), inArray(products.id, unique)));
  if (rows.length !== unique.length) throw refuse(422, "INVALID_PRODUCT", "A product on the price list is not a product of this company.");
}

export async function listPriceLists(companyId: string) {
  const lists = await db.select().from(priceLists).where(eq(priceLists.companyId, companyId)).orderBy(asc(priceLists.name));
  const items = await db.select().from(priceListItems).where(eq(priceListItems.companyId, companyId));
  return lists.map((l: any) => ({ ...l, items: items.filter((i: any) => i.priceListId === l.id).map((i: any) => ({ productId: i.productId, unitPrice: Number(i.unitPrice) })) }));
}

export async function getPriceList(companyId: string, id: string) {
  const [list] = await db.select().from(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.companyId, companyId)));
  if (!list) return null;
  const items = await db.select().from(priceListItems).where(and(eq(priceListItems.priceListId, id), eq(priceListItems.companyId, companyId)));
  return { ...list, items: items.map((i: any) => ({ productId: i.productId, unitPrice: Number(i.unitPrice) })) };
}

function cleanItems(items: PriceListInput["items"]) {
  const seen = new Set<string>();
  const out: Array<{ productId: string; unitPrice: number }> = [];
  for (const it of items ?? []) {
    if (seen.has(it.productId)) throw refuse(422, "DUPLICATE_PRODUCT", "A product can appear on a price list only once.");
    seen.add(it.productId);
    const price = normalizeUnitPrice(it.unitPrice);
    if (!(price > 0)) throw refuse(422, "INVALID_PRICE", "A list price must be above 0.");
    out.push({ productId: it.productId, unitPrice: price });
  }
  return out;
}

export async function createPriceList(companyId: string, input: PriceListInput) {
  const items = cleanItems(input.items);
  await assertProducts(companyId, items.map((i) => i.productId));
  try {
    return await db.transaction(async (tx: typeof db) => {
      const [list] = await tx
        .insert(priceLists)
        .values({ companyId, name: input.name.trim(), currency: (input.currency || "AED").toUpperCase(), isActive: input.isActive ?? true } as any)
        .returning();
      if (items.length) {
        await tx.insert(priceListItems).values(items.map((i) => ({ companyId, priceListId: list.id, ...i })) as any);
      }
      return { ...list, items };
    });
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") throw refuse(409, "PRICE_LIST_EXISTS", "A price list with this name already exists.");
    throw err;
  }
}

export async function updatePriceList(companyId: string, id: string, input: Partial<PriceListInput>) {
  const existing = await getPriceList(companyId, id);
  if (!existing) return null;
  const items = input.items ? cleanItems(input.items) : null;
  if (items) await assertProducts(companyId, items.map((i) => i.productId));
  try {
    await db.transaction(async (tx: typeof db) => {
      await tx
        .update(priceLists)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(priceLists.id, id), eq(priceLists.companyId, companyId)));
      if (items) {
        await tx.delete(priceListItems).where(and(eq(priceListItems.priceListId, id), eq(priceListItems.companyId, companyId)));
        if (items.length) await tx.insert(priceListItems).values(items.map((i) => ({ companyId, priceListId: id, ...i })) as any);
      }
    });
  } catch (err: any) {
    if (err?.code === "23505" || err?.cause?.code === "23505") throw refuse(409, "PRICE_LIST_EXISTS", "A price list with this name already exists.");
    throw err;
  }
  return getPriceList(companyId, id);
}

export async function deletePriceList(companyId: string, id: string): Promise<boolean> {
  const rows = await db.delete(priceLists).where(and(eq(priceLists.id, id), eq(priceLists.companyId, companyId))).returning({ id: priceLists.id });
  return rows.length > 0;
}

/** The prices a customer's list gives for a document currency: {priceListId, prices: {productId: unitPrice}}. */
export async function resolvePriceList(companyId: string, contactId: string, currency: string) {
  const [contact] = await db
    .select({ id: customerContacts.id, priceListId: customerContacts.priceListId })
    .from(customerContacts)
    .where(and(eq(customerContacts.id, contactId), eq(customerContacts.companyId, companyId)));
  if (!contact) throw refuse(404, "CONTACT_NOT_FOUND", "Contact not found");
  if (!contact.priceListId) return { priceListId: null, prices: {} as Record<string, number> };
  const list = await getPriceList(companyId, contact.priceListId);
  if (!list || !list.isActive || list.currency.toUpperCase() !== (currency || "AED").toUpperCase()) {
    return { priceListId: null, prices: {} as Record<string, number> };
  }
  return {
    priceListId: list.id as string,
    prices: Object.fromEntries(list.items.map((i: any) => [i.productId, i.unitPrice])) as Record<string, number>,
  };
}
