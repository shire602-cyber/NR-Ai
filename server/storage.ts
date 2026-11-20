// Storage facade (R20-09). The implementation is split per domain under
// server/storage/: types.ts (IStorage and its argument types), helpers.ts and one class
// per domain (users, companies, report-delivery, ledger, sales, receipts, contacts,
// integrations, banking, operations, insights, engagement, compliance, firm). The domain
// classes are chained with `extends`, so DatabaseStorage keeps every method on its
// prototype chain and the public surface (`storage`, `DatabaseStorage`, `IStorage`, the
// exported types and `normalizeEmail`) is unchanged.
// storage.createJournalEntry is a legacy adapter over server/ledger; new code must not add
// call sites (see AGENTS.md).
import { FirmStorage } from "./storage/firm";
import type { IStorage } from "./storage/types";

export { normalizeEmail } from "./storage/helpers";
export type {
  AuditLogFilter,
  InvoiceSummary,
  IStorage,
  NewUserInput,
  PostReceiptAtomicArgs,
  ReviseReceiptAtomicArgs,
  SplitReceiptAtomicArgs,
} from "./storage/types";

export class DatabaseStorage extends FirmStorage implements IStorage {}

export const storage = new DatabaseStorage();
