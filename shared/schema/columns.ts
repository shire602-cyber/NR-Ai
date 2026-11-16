// Shared Drizzle column types used by the shared/schema/* modules.
// Split out of shared/schema.ts (R20-09); shared/schema.ts stays the public barrel.

import { customType } from "drizzle-orm/pg-core";

// Monetary amount stored as NUMERIC(15,2) in Postgres for exact decimal arithmetic.
// fromDriver rounds to 2 decimals so JS-side floating-point drift cannot accumulate
// across multi-line entries (a long-term decimal library is the proper fix).
export const money = customType<{ data: number; driverData: string }>({
  dataType() {
    return "numeric(15,2)";
  },
  fromDriver(value: string): number {
    return Math.round(parseFloat(value) * 100) / 100;
  },
  toDriver(value: number) {
    return String(value);
  },
});

// Exchange rates need higher decimal precision than monetary amounts.
export const rate = customType<{ data: number; driverData: string }>({
  dataType() {
    return "numeric(15,6)";
  },
  fromDriver(value: string): number {
    return parseFloat(value);
  },
  toDriver(value: number) {
    return String(value);
  },
});

// VAT rates (e.g. 0.05 for UAE 5%) need exact decimal storage; real() cannot
// represent 0.05 exactly in IEEE-754.
export const vatRateType = customType<{ data: number; driverData: string }>({
  dataType() {
    return "numeric(5,4)";
  },
  fromDriver(value: string): number {
    return parseFloat(value);
  },
  toDriver(value: number) {
    return String(value);
  },
});

// Calendar date (Postgres DATE) carried as "YYYY-MM-DD" (W2-A ledger kernel).
export const ledgerDate = customType<{ data: string; driverData: string | Date }>({
  dataType() {
    return "date";
  },
  fromDriver(value: string | Date): string {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  },
  toDriver(value: string) {
    return value;
  },
});
