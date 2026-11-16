// Drizzle schema barrel (R20-09). The tables, insert schemas and types live in
// shared/schema/<domain>.ts; this file re-exports them so drizzle.config.ts
// ("./shared/schema.ts"), "@shared/schema" imports and generated migrations are
// unchanged. Add new tables to the owning domain module, not here.
// shared/schema/columns.ts (column helpers) is internal and not re-exported.
export * from "./schema/users";
export * from "./schema/companies";
export * from "./schema/consolidation";
export * from "./schema/einvoicing";
export * from "./schema/company-users";
export * from "./schema/report-delivery";
export * from "./schema/firms";
export * from "./schema/firm-practice";
export * from "./schema/ledger";
export * from "./schema/sales";
export * from "./schema/purchasing";
export * from "./schema/integrations";
export * from "./schema/payments";
export * from "./schema/receipts";
export * from "./schema/inventory";
export * from "./schema/contacts";
export * from "./schema/portal";
export * from "./schema/frontend-types";
export * from "./schema/messaging";
export * from "./schema/banking";
export * from "./schema/forecasting";
export * from "./schema/commerce";
export * from "./schema/notifications";
export * from "./schema/platform";
export * from "./schema/vat";
export * from "./schema/corporate-tax";
export * from "./schema/compliance";
export * from "./schema/firm-clients";
export * from "./schema/firm-automation";
