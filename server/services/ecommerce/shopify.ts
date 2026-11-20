/**
 * Shopify adapter (W5-B, R19-03). Uses the merchant's Admin API access token
 * (custom app). Connect verifies the token with GET /admin/api/<v>/shop.json;
 * sync imports orders as DRAFT invoices and refunds as DRAFT credit notes,
 * idempotent by external id (ecommerce_transactions unique (integration, external_id)).
 */
import { toFils } from "../../../shared/money";
import { ecommerceHttp } from "./http";
import { PlatformAuthError, PlatformError, type AdapterContext, type SyncCounts } from "./types";
import { createDraftInvoice } from "../connectors/draft-documents";
import { createDraftCreditNote } from "../invoice-posting.service";
import { getRate } from "../fx/rates";

export const SHOPIFY_API_VERSION = "2024-07";
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;

export function normaliseShopDomain(raw: string): string | null {
  const d = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const full = d.includes(".") ? d : `${d}.myshopify.com`;
  return SHOP_DOMAIN.test(full) ? full : null;
}

function base(shop: string): string {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`;
}

async function shopifyGet(shop: string, token: string, path: string) {
  const res = await ecommerceHttp()(`${base(shop)}${path}`, {
    headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
  });
  if (res.status === 401 || res.status === 403) {
    throw new PlatformAuthError("Shopify rejected the access token");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new PlatformError(`Shopify API returned HTTP ${res.status}`);
  }
  return res;
}

/** Verify the token; returns the shop's display name. */
export async function verifyShopify(shop: string, token: string): Promise<{ name: string }> {
  const res = await shopifyGet(shop, token, "/shop.json");
  const name = (res.body as { shop?: { name?: string } })?.shop?.name;
  if (!name) throw new PlatformError("Unexpected Shopify shop response");
  return { name };
}

interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  tax_lines?: Array<{ price: string }>;
}
interface ShopifyRefund {
  id: number;
  created_at: string;
  note?: string | null;
  refund_line_items?: Array<{
    quantity: number;
    subtotal: string | number;
    total_tax: string | number;
  }>;
  transactions?: Array<{ amount: string; kind?: string; status?: string }>;
}
interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  currency: string;
  total_price: string;
  subtotal_price?: string;
  total_tax?: string;
  financial_status?: string;
  cancelled_at?: string | null;
  email?: string | null;
  customer?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
  line_items: ShopifyLineItem[];
  refunds?: ShopifyRefund[];
}

function nextPageInfo(link: string | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (/rel="next"/.test(part)) {
      const m = /page_info=([^&>]+)/.exec(part);
      if (m) return m[1];
    }
  }
  return null;
}

function customerName(o: ShopifyOrder): string {
  const n = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ").trim();
  return n || o.customer?.email || o.email || `Shopify customer (${o.name})`;
}

const dateOnly = (iso: string) => iso.slice(0, 10);

async function rateFor(companyId: string, currency: string, date: string): Promise<number | null> {
  if (currency.toUpperCase() === "AED") return 1;
  const r = await getRate(companyId, currency.toUpperCase(), "AED", date);
  return r.rate;
}

/** Import orders and refunds. Each external id is processed at most once. */
export async function syncShopify(ctx: AdapterContext): Promise<SyncCounts> {
  const counts: SyncCounts = { imported: 0, skipped: 0, documents: 0, pending: 0 };
  const shop = ctx.integration.shopDomain!;
  const token = ctx.credentials.accessToken!;
  const since = ctx.integration.lastSyncAt
    ? `&updated_at_min=${encodeURIComponent(new Date(ctx.integration.lastSyncAt).toISOString())}`
    : "";
  let path = `/orders.json?status=any&limit=250${since}`;
  for (let page = 0; page < 20; page++) {
    const res = await shopifyGet(shop, token, path);
    const orders = ((res.body as { orders?: ShopifyOrder[] })?.orders ?? []) as ShopifyOrder[];
    for (const order of orders) await importOrder(ctx, order, counts);
    const next = nextPageInfo(res.headers["link"]);
    if (!next) break;
    path = `/orders.json?limit=250&page_info=${next}`;
  }
  await retryPendingRefunds(ctx, counts);
  return counts;
}

async function importOrder(ctx: AdapterContext, order: ShopifyOrder, counts: SyncCounts) {
  const externalId = `order:${order.id}`;
  const inserted = await ctx.recordTransaction({
    externalId,
    transactionType: "order",
    amount: order.total_price,
    currency: order.currency,
    customerName: customerName(order),
    customerEmail: order.customer?.email ?? order.email ?? null,
    description: `Shopify order ${order.name}`,
    status: order.cancelled_at ? "cancelled" : (order.financial_status ?? "pending"),
    transactionDate: order.created_at,
    metadata: { orderId: order.id, name: order.name },
  });
  if (!inserted) {
    counts.skipped++;
  } else {
    counts.imported++;
    if (!order.cancelled_at && order.line_items.length) {
      const date = dateOnly(order.created_at);
      const rate = await rateFor(ctx.companyId, order.currency, date);
      const invoice = await createDraftInvoice(
        ctx.companyId,
        {
          customerName: customerName(order).slice(0, 300),
          date,
          currency: order.currency.toUpperCase(),
          exchangeRate: rate,
          notes: `Imported from Shopify order ${order.name}. Review VAT treatment before issuing.`,
          lines: order.line_items
            .filter((li) => li.quantity > 0 && Number(li.price) > 0)
            .map((li) => {
              const taxed = (li.tax_lines ?? []).some((t) => Number(t.price) > 0);
              return {
                description: li.title.slice(0, 1000),
                quantity: li.quantity,
                unitPrice: toFils(li.price),
                vatRate: taxed ? 0.05 : 0,
                vatSupplyType: taxed ? "standard_rated" : "zero_rated",
              };
            }),
        },
        ctx.actorUserId
      );
      await ctx.linkDocument(externalId, invoice.id);
      counts.documents++;
    }
  }
  for (const refund of order.refunds ?? []) await importRefund(ctx, order, refund, counts);
}

function refundAmounts(refund: ShopifyRefund): { netFils: number; taxFils: number } {
  const items = refund.refund_line_items ?? [];
  if (items.length) {
    return {
      netFils: items.reduce((s, i) => s + toFils(String(i.subtotal)), 0),
      taxFils: items.reduce((s, i) => s + toFils(String(i.total_tax)), 0),
    };
  }
  const gross = (refund.transactions ?? [])
    .filter((t) => !t.kind || t.kind === "refund")
    .reduce((s, t) => s + toFils(t.amount), 0);
  return { netFils: gross, taxFils: 0 };
}

async function importRefund(
  ctx: AdapterContext,
  order: ShopifyOrder,
  refund: ShopifyRefund,
  counts: SyncCounts
) {
  const { netFils, taxFils } = refundAmounts(refund);
  const externalId = `refund:${refund.id}`;
  const inserted = await ctx.recordTransaction({
    externalId,
    transactionType: "refund",
    amount: String(-(netFils + taxFils) / 100),
    currency: order.currency,
    customerName: customerName(order),
    customerEmail: order.customer?.email ?? order.email ?? null,
    description: `Shopify refund on ${order.name}`,
    status: "pending",
    transactionDate: refund.created_at,
    metadata: { orderId: order.id, refundId: refund.id, netFils, taxFils, name: order.name },
  });
  if (!inserted) {
    counts.skipped++;
    return;
  }
  counts.imported++;
  await tryCreditNote(
    ctx,
    externalId,
    `order:${order.id}`,
    refund.created_at,
    netFils,
    taxFils,
    counts
  );
}

/** A credit note needs an ISSUED invoice; until the order's draft is issued the refund waits. */
async function tryCreditNote(
  ctx: AdapterContext,
  refundExternalId: string,
  orderExternalId: string,
  createdAt: string,
  netFils: number,
  taxFils: number,
  counts: SyncCounts
) {
  const invoice = await ctx.documentFor(orderExternalId);
  if (!invoice || invoice.status === "draft" || netFils <= 0) {
    counts.pending++;
    return;
  }
  const cn = await createDraftCreditNote({
    invoiceId: invoice.id,
    companyId: ctx.companyId,
    date: dateOnly(createdAt),
    reason: `Shopify refund ${refundExternalId}`,
    lines: [
      {
        description: `Refund (${refundExternalId})`,
        quantity: 1,
        unitPriceFils: netFils,
        vatRate: taxFils > 0 ? 0.05 : 0,
        vatSupplyType: taxFils > 0 ? "standard_rated" : "zero_rated",
      },
    ],
  });
  await ctx.linkDocument(refundExternalId, cn.id, "succeeded");
  counts.documents++;
}

async function retryPendingRefunds(ctx: AdapterContext, counts: SyncCounts) {
  const scratch: SyncCounts = { imported: 0, skipped: 0, documents: 0, pending: 0 };
  for (const t of await ctx.pendingRefunds()) {
    const meta = t.metadata as { orderId?: number; netFils?: number; taxFils?: number };
    if (!meta.orderId) continue;
    await tryCreditNote(
      ctx,
      t.externalId,
      `order:${meta.orderId}`,
      t.transactionDate.toISOString(),
      Number(meta.netFils ?? 0),
      Number(meta.taxFils ?? 0),
      scratch
    ).catch(() => undefined);
  }
  counts.documents += scratch.documents;
}
