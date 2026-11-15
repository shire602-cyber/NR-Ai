/**
 * The single network client for ZATCA Fatoora (API version V2). Every call
 * to ZATCA goes through this class; tests inject a recorded sandbox-shaped
 * fetch (tests/fixtures/zatca/).
 *
 * EXTERNAL: a real call needs ZATCA_ENV (sandbox | simulation | production),
 * optionally ZATCA_API_BASE_URL, and a one-time OTP from the taxpayer's Fatoora
 * portal for each EGS unit. Without ZATCA_ENV every endpoint answers 503
 * ZATCA_NOT_CONFIGURED.
 */
import { DomainError } from "../../errors";
import type { ZatcaEnvironment } from "./keys";

export const ZATCA_BASE_URLS: Record<ZatcaEnvironment, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

export interface ZatcaConfig {
  environment: ZatcaEnvironment;
  baseUrl: string;
  timeoutMs: number;
}

export function zatcaConfig(env: NodeJS.ProcessEnv = process.env): ZatcaConfig | null {
  const raw = (env.ZATCA_ENV ?? "").trim().toLowerCase();
  if (!raw) return null;
  const environment: ZatcaEnvironment =
    raw === "production" ? "production" : raw === "simulation" ? "simulation" : "sandbox";
  const timeout = Number(env.ZATCA_API_TIMEOUT_MS);
  return {
    environment,
    baseUrl: (env.ZATCA_API_BASE_URL || ZATCA_BASE_URLS[environment]).replace(/\/+$/, ""),
    timeoutMs: timeout > 0 ? timeout : 30_000,
  };
}

export function requireZatcaConfig(env: NodeJS.ProcessEnv = process.env): ZatcaConfig {
  const cfg = zatcaConfig(env);
  if (!cfg) {
    throw new DomainError(
      "ZATCA_NOT_CONFIGURED",
      503,
      undefined,
      "ZATCA e-invoicing is not configured. Set ZATCA_ENV and onboard each EGS unit with a Fatoora OTP."
    );
  }
  return cfg;
}

export interface ZatcaValidationResults {
  status?: string;
  infoMessages?: Array<{ code?: string; message?: string }>;
  warningMessages?: Array<{ code?: string; message?: string }>;
  errorMessages?: Array<{ code?: string; message?: string }>;
}

export interface ZatcaResponse<T> {
  httpStatus: number;
  ok: boolean;
  body: T & { validationResults?: ZatcaValidationResults; errors?: unknown };
}

export interface CsidResponse {
  requestID?: number | string;
  dispositionMessage?: string;
  binarySecurityToken?: string;
  secret?: string;
}

export interface SubmissionResponse {
  clearanceStatus?: string;
  reportingStatus?: string;
  clearedInvoice?: string;
}

export interface ZatcaCredentials {
  binarySecurityToken: string;
  secret: string;
}

export interface ZatcaDocumentPayload {
  invoiceHash: string;
  uuid: string;
  /** base64 of the signed XML */
  invoice: string;
}

type FetchLike = typeof fetch;

export class ZatcaTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZatcaTransportError";
  }
}

export class ZatcaClient {
  constructor(
    private readonly cfg: ZatcaConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  get environment(): ZatcaEnvironment {
    return this.cfg.environment;
  }

  private auth(c: ZatcaCredentials): string {
    return `Basic ${Buffer.from(`${c.binarySecurityToken}:${c.secret}`, "utf8").toString("base64")}`;
  }

  private async post<T>(
    path: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<ZatcaResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Version": "V2",
          "Accept-Language": "en",
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = {};
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        parsed = { raw: text.slice(0, 2000) };
      }
      return { httpStatus: res.status, ok: res.ok, body: parsed as ZatcaResponse<T>["body"] };
    } catch (err) {
      throw new ZatcaTransportError((err as Error).message || "ZATCA request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Step 1 of onboarding: CSR + OTP → compliance CSID. */
  complianceCsid(csrBase64: string, otp: string) {
    return this.post<CsidResponse>("/compliance", { csr: csrBase64 }, { OTP: otp });
  }

  /** Step 2: submit sample invoices signed with the compliance CSID. */
  complianceInvoice(creds: ZatcaCredentials, doc: ZatcaDocumentPayload) {
    return this.post<SubmissionResponse>("/compliance/invoices", doc, {
      Authorization: this.auth(creds),
    });
  }

  /** Step 3: compliance request id → production CSID. */
  productionCsid(creds: ZatcaCredentials, complianceRequestId: string) {
    return this.post<CsidResponse>(
      "/production/csids",
      { compliance_request_id: complianceRequestId },
      { Authorization: this.auth(creds) }
    );
  }

  /** Standard (B2B) tax invoices: real-time clearance. */
  clearance(creds: ZatcaCredentials, doc: ZatcaDocumentPayload) {
    return this.post<SubmissionResponse>("/invoices/clearance/single", doc, {
      Authorization: this.auth(creds),
      "Clearance-Status": "1",
    });
  }

  /** Simplified (B2C) tax invoices: reporting within 24 hours. */
  reporting(creds: ZatcaCredentials, doc: ZatcaDocumentPayload) {
    return this.post<SubmissionResponse>("/invoices/reporting/single", doc, {
      Authorization: this.auth(creds),
      "Clearance-Status": "0",
    });
  }
}
