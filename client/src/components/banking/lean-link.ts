// The Lean Link SDK (docs.leantech.me/docs/web): a loader script that exposes a global `Lean`. It is only requested
// after the server has handed out a Link session, which only happens when Lean is configured; the content security
// policy lets the host through only in that case as well.

import type { LeanSession } from "@/lib/banking-api-types";

const LOADER_URL = "https://cdn.leantech.me/link/loader/prod/ae/latest/lean-link-loader.min.js";

export interface LeanCallbackData {
  status: "SUCCESS" | "ERROR" | "CANCELLED" | "REDIRECT" | "LINK_CLOSED_PROGRAMMATICALLY" | string;
  message?: string;
  secondary_status?: string;
  last_api_response?: string;
  lean_correlation_id?: string;
  [key: string]: unknown;
}

interface LeanGlobal {
  connect: (config: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    Lean?: LeanGlobal;
  }
}

let loader: Promise<LeanGlobal> | null = null;

export function loadLeanSdk(): Promise<LeanGlobal> {
  if (window.Lean) return Promise.resolve(window.Lean);
  loader ??= new Promise<LeanGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LOADER_URL;
    script.async = true;
    script.onload = () => (window.Lean ? resolve(window.Lean) : reject(new Error("Lean SDK missing")));
    script.onerror = () => {
      loader = null;
      script.remove();
      reject(new Error("Lean SDK failed to load"));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/** Open the bank login. Resolves with what the SDK reports when the person closes it. */
export async function openLeanLink(session: LeanSession): Promise<LeanCallbackData> {
  const lean = await loadLeanSdk();
  return await new Promise<LeanCallbackData>((resolve) => {
    lean.connect({
      app_token: session.appToken,
      customer_id: session.customerId,
      access_token: session.accessToken,
      sandbox: session.sandbox,
      permissions: ["identity", "accounts", "transactions", "balance"],
      callback: (data: LeanCallbackData) => resolve(data),
    });
  });
}

/** The entity id, when the SDK reports one. The documented callback does not, so this can be null (see the feed panel). */
export function entityIdFrom(data: LeanCallbackData): string | null {
  for (const key of ["entity_id", "entityId"]) {
    const v = data[key];
    if (typeof v === "string" && /^[0-9a-fA-F-]{8,64}$/.test(v)) return v;
  }
  return null;
}
