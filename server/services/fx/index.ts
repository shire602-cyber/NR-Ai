/**
 * FX module entry point. Registers the tenant-scoped rate services in the platform
 * service registry so document modules can call them without importing this module:
 *
 *   const getRate = resolve<FxGetRate>("fx.getRate");
 *   const { rate, stale } = await getRate(companyId, "USD", "AED", "2026-11-14");
 */
import { has, provide } from "../../platform/service-registry";
import { convert, getRate, toVatFilingCurrency } from "./rates";
import { registerFxFeedJob } from "./feed";

export * from "./rates";
export * from "./exposure";
export * from "./revaluation";
export * from "./bank-balances";
export * from "./feed";

export type FxGetRate = typeof getRate;
export type FxConvert = typeof convert;
export type FxToVatFilingCurrency = typeof toVatFilingCurrency;

/** Idempotent: safe to call every time routes are registered (tests rebuild the app). */
export function registerFxServices(): void {
  if (!has("fx.getRate")) provide("fx.getRate", getRate);
  if (!has("fx.convert")) provide("fx.convert", convert);
  if (!has("fx.toVatFilingCurrency")) provide("fx.toVatFilingCurrency", toVatFilingCurrency);
  registerFxFeedJob();
}
