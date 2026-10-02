// Which gateway provider is active. Real Stripe Connect when its keys are set; the fake one only in tests
// (PAYMENT_GATEWAY_FAKE=1, refused at boot in production); otherwise nothing: "not configured".

import Stripe from "stripe";
import { getEnv } from "../../config/env";
import { FAKE_CONNECT_WEBHOOK_SECRET, FAKE_PLATFORM_WEBHOOK_SECRET, FakeGatewayAdapter } from "./fake.adapter";
import { StripeConnectAdapter } from "./stripe-connect.adapter";
import type { GatewayProvider } from "./types";

let stripeAdapter: StripeConnectAdapter | null = null;
let fakeAdapter: FakeGatewayAdapter | null = null;

export const isFakeGatewayOn = (): boolean => getEnv().PAYMENT_GATEWAY_FAKE === "1" && getEnv().NODE_ENV !== "production";

/** The active provider, or null when online payment is off on this server. */
export function getGatewayProvider(): GatewayProvider | null {
  if (isFakeGatewayOn()) return (fakeAdapter ??= new FakeGatewayAdapter());
  const adapter = (stripeAdapter ??= new StripeConnectAdapter());
  return adapter.isConfigured() ? adapter : null;
}

export type GatewayMode = "stripe" | "fake" | "none";
export const gatewayMode = (): GatewayMode => getGatewayProvider()?.name ?? "none";

/** The secrets a webhook may be signed with: the platform endpoint first, then the Connect endpoint. */
export function webhookSecrets(): string[] {
  const env = getEnv();
  const out = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((s): s is string => !!s);
  if (isFakeGatewayOn()) out.push(FAKE_PLATFORM_WEBHOOK_SECRET, FAKE_CONNECT_WEBHOOK_SECRET);
  return out;
}

/** A Stripe instance that can verify signatures (needs no real key for that). */
export function webhookVerifier(): Stripe | null {
  const key = getEnv().STRIPE_SECRET_KEY;
  if (key) return new Stripe(key, { apiVersion: "2024-12-18.acacia" as any });
  return isFakeGatewayOn() ? new Stripe("sk_test_fake_key_for_signature_checks", { apiVersion: "2024-12-18.acacia" as any }) : null;
}

export * from "./types";
