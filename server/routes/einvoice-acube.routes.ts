/**
 * A-Cube connection, onboarding and webhooks (E1).
 *
 *   GET  /api/companies/:companyId/einvoicing/acube            connection card state
 *   POST /api/companies/:companyId/einvoicing/acube/reserve    reserve the company's TIN
 *   POST /api/companies/:companyId/einvoicing/acube/sync       re-read the legal entity
 *   POST /api/companies/:companyId/einvoicing/acube/webhooks   register event destinations
 *   POST /api/webhooks/einvoice/acube/:environment/:companyId  A-Cube events (Ed25519-signed)
 *
 * Without A-Cube configured every call answers 503 EINVOICE_PROVIDER_NOT_CONFIGURED and the card
 * says so; nothing claims a connection that does not exist.
 */
import crypto from "node:crypto";
import express, { type Express, type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
import { requireScopedCompanyPermission } from "../middleware/companyRolePolicy";
import { strictBody } from "../http/strict-body";
import { DomainError } from "../errors";
import { createLogger } from "../config/logger";
import { recordAudit } from "../services/audit.service";
import { listJobs, registerJob } from "../platform/job-registry";
import type { Company } from "../../shared/schema";
import {
  ACUBE_ACCREDITATION_NUMBER,
  ACUBE_PROVIDER_NAME,
  AcubeApiError,
  AcubeEInvoiceProvider,
  MOF_ASP_REGISTER_URL,
  acubeEnvironment,
} from "../services/einvoice/providers/acube";
import {
  getAcubePublicKey,
  maxSignatureAgeSeconds,
  verifyAcubeSignature,
} from "../services/einvoice/acube-signature";
import {
  ACUBE_POLL_JOB,
  PROVIDER_EVENTS_JOB,
  canonicalEventType,
  enqueueProviderEvent,
  providerEventKey,
  providerEventSummary,
  runAcubePoll,
  runProviderEvents,
} from "../services/einvoice/provider-events";
import {
  companyTin,
  getLegalEntity,
  patchFromAcube,
  requireCompanyTin,
  upsertLegalEntity,
} from "../services/einvoice/legal-entities";
import { companyProviderConfiguration } from "../services/einvoice/providers/company-provider";
import { EINVOICE_TIMELINE, einvoicingScope } from "../services/einvoice/scope";
import { reportWindowDays } from "../services/einvoice/tracks";

const log = createLogger("einvoice-acube-routes");

const userOf = (req: Request): string => (req as Request & { user: { id: string } }).user.id;

/** The body after `strictBody(schema)` replaced it with the parsed, canonical value. */
function validated<T>(req: Request): T {
  return req.body as T;
}

/** The name A-Cube is listed under in EmaraTax's ASP list (A-Cube onboarding docs). */
export const EMARATAX_ACUBE_LISTING = "PLATFORM ACUBE TECHNOLOGIES L.L.C";

/** Events registered at A-Cube (OpenAPI enum names; the prose uses document.* names). */
const DEFAULT_WEBHOOK_EVENTS = [
  "invoice.outbound",
  "invoice.inbound",
  "credit_note.outbound",
  "credit_note.inbound",
  "legal_entity.synchronized",
];

async function acubeConfiguration(company: Company) {
  return company.einvoicePartner === ACUBE_PROVIDER_NAME
    ? companyProviderConfiguration(company.id, ACUBE_PROVIDER_NAME)
    : null;
}

async function acubeProvider(company: Company) {
  const config = await acubeConfiguration(company);
  if (!config) throw new DomainError("EINVOICE_PROVIDER_NOT_CONFIGURED", 503);
  return { provider: new AcubeEInvoiceProvider(config.env), webhookToken: config.webhookSecret };
}

function webhookBaseUrl(): string | null {
  const base = process.env.ACUBE_WEBHOOK_BASE_URL || process.env.AUTH_PUBLIC_URL || "";
  return base ? base.replace(/\/+$/, "") : null;
}

function webhookPath(environment: string, companyId: string): string {
  return `/api/webhooks/einvoice/acube/${environment}/${companyId}`;
}

type StepState = "done" | "current" | "todo" | "failed";

export async function acubeConnectionView(
  company: Company & Record<string, unknown>,
  le: Awaited<ReturnType<typeof getLegalEntity>>
) {
  const config = await acubeConfiguration(company);
  const configured = !!config;
  const environment = acubeEnvironment();
  const status = le?.status ?? null;
  const steps: Array<{ key: "reserve" | "approve" | "synced"; state: StepState }> = [
    { key: "reserve", state: le ? "done" : configured ? "current" : "todo" },
    {
      key: "approve",
      state:
        status === "active"
          ? "done"
          : status === "inactive"
            ? "failed"
            : status === "reserved" || status === "pending"
              ? "current"
              : "todo",
    },
    {
      key: "synced",
      state:
        status === "active" ? (le?.registrySyncAt || le?.smpSyncAt ? "done" : "current") : "todo",
    },
  ];
  const base = webhookBaseUrl();
  const scope = einvoicingScope({
    einvoiceScope: (company.einvoiceScope as string | null) ?? null,
    einvoiceTurnoverBand: (company.einvoiceTurnoverBand as string | null) ?? null,
    einvoiceGoLiveDate: (company.einvoiceGoLiveDate as string | null) ?? null,
  });
  return {
    provider: ACUBE_PROVIDER_NAME,
    configured,
    environment,
    accreditationNumber: ACUBE_ACCREDITATION_NUMBER,
    registerUrl: MOF_ASP_REGISTER_URL,
    emaraTaxListing: EMARATAX_ACUBE_LISTING,
    tin: companyTin(company as Company & { peppolParticipantId?: string | null }),
    legalEntity: le
      ? {
          status: le.status,
          legalEntityId: le.legalEntityId,
          tin: le.tin,
          nameEn: le.nameEn,
          nameAr: le.nameAr,
          vatTrn: le.vatTrn,
          peppolAddress: le.peppolAddress,
          capabilities: (le.capabilities as string[] | null) ?? [],
          approver: le.approver,
          approverEmail: le.approverEmail,
          lastAction: le.lastAction,
          lastError: le.lastError,
          reservationExpiresAt: le.reservationExpiresAt,
          smpSyncAt: le.smpSyncAt,
          registrySyncAt: le.registrySyncAt,
          lastSyncAt: le.lastSyncAt,
          activatedAt: le.activatedAt,
        }
      : null,
    canSend: configured && status === "active",
    steps,
    goLive: {
      ...scope,
      timeline: EINVOICE_TIMELINE,
      // Assumption (docs/einvoicing-acube.md), configurable with EINVOICE_REPORT_WINDOW_DAYS.
      reportWindowDays: reportWindowDays(),
    },
    webhook: {
      url: base ? `${base}${webhookPath(environment, company.id)}` : null,
      tokenConfigured: !!config?.webhookSecret,
      signaturePinned: !!process.env.ACUBE_SIGNATURE_PUBLIC_KEY,
    },
  };
}

const reserveBody = z
  .object({
    approver: z.enum(["me", "someone_else"]),
    approverEmail: z.string().trim().email().max(254).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.approver === "someone_else" && !v.approverEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approverEmail"],
        message: "Enter the email of the person who signs in to EmaraTax",
      });
    }
  });
type ReserveBody = z.output<typeof reserveBody>;

const emptyBody = z.object({}).strict();

/** Any JSON object: A-Cube's payloads are small and are re-read from the API before use. */
const webhookPayload = z.record(z.string(), z.unknown());

function webhookIdentifier(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Read A-Cube's native resource UUID fields alongside the canonical prose payloads. */
function normaliseAcubeEvent(payload: Record<string, unknown>) {
  const type = canonicalEventType(payload);
  if (!type) return null;
  if (type === "legal_entity.synchronized") {
    const legalEntityId =
      webhookIdentifier(payload.legalEntityUuid) ?? webhookIdentifier(payload.legalEntityId);
    if (!legalEntityId && !webhookIdentifier(payload.tin)) return null;
    return { type, payload: { ...payload, legalEntityId } };
  }

  const declared = String(payload.eventType ?? payload.event ?? "").toLowerCase();
  const creditNote = declared.startsWith("credit_note.");
  const nativeId = creditNote ? payload.creditNoteUuid : payload.invoiceUuid;
  const documentId = webhookIdentifier(nativeId) ?? webhookIdentifier(payload.documentId);
  if (!documentId) return null;
  return {
    type,
    payload: {
      ...payload,
      documentId,
      ...(creditNote ? { documentType: "credit-note" } : {}),
    },
  };
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function webhookTokenHeaderName(): string {
  return process.env.ACUBE_WEBHOOK_TOKEN_HEADER?.trim() || "X-Acube-Token";
}

export function registerEInvoiceAcubeRoutes(app: Express) {
  if (!listJobs().some((j) => j.name === PROVIDER_EVENTS_JOB)) {
    registerJob({
      name: PROVIDER_EVENTS_JOB,
      cron: "* * * * *",
      description: "Process queued e-invoicing provider events (A-Cube webhooks and poll results)",
      run: async () => {
        await runProviderEvents();
      },
    });
  }
  if (!listJobs().some((j) => j.name === ACUBE_POLL_JOB)) {
    registerJob({
      name: ACUBE_POLL_JOB,
      cron: "*/10 * * * *",
      description: "Poll A-Cube for in-flight e-invoice status and incoming documents (fallback)",
      run: async () => {
        await runAcubePoll();
        await runProviderEvents();
      },
    });
  }

  app.get(
    "/api/companies/:companyId/einvoicing/acube",
    authMiddleware,
    requireScopedCompanyPermission("reports.read"),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const le = await getLegalEntity(company.id, ACUBE_PROVIDER_NAME, acubeEnvironment());
      res.json({
        ...(await acubeConnectionView(company as Company & Record<string, unknown>, le)),
        events: await providerEventSummary(company.id),
      });
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/acube/reserve",
    authMiddleware,
    requireScopedCompanyPermission("settings.company"),
    strictBody(reserveBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const { provider } = await acubeProvider(company);
      const body = validated<ReserveBody>(req);
      const tin = requireCompanyTin(company);
      let reserved;
      try {
        reserved = await provider.reserveLegalEntity(tin);
      } catch (err) {
        if (err instanceof AcubeApiError) {
          throw new DomainError(err.code, err.status >= 500 ? 502 : 422);
        }
        throw err;
      }
      const patch = patchFromAcube(reserved);
      if (patch.status === "active") {
        const prior = await getLegalEntity(company.id, ACUBE_PROVIDER_NAME, provider.environment);
        if (prior?.status !== "active" || prior.legalEntityId !== reserved.legalEntityId) {
          patch.activatedAt = new Date();
        }
      }
      const le = await upsertLegalEntity(
        company.id,
        ACUBE_PROVIDER_NAME,
        provider.environment,
        tin,
        {
          ...patch,
          approver: body.approver,
          approverEmail: body.approver === "someone_else" ? (body.approverEmail ?? null) : null,
          lastError: null,
        }
      );
      await recordAudit({
        userId: userOf(req),
        companyId: company.id,
        action: "company.einvoicing_acube_reserve",
        entityType: "company",
        entityId: company.id,
        after: { tin, status: le.status, approver: body.approver, environment: le.environment },
        req,
      });
      res.json(await acubeConnectionView(company as Company & Record<string, unknown>, le));
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/acube/sync",
    authMiddleware,
    requireScopedCompanyPermission("settings.company"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const { provider } = await acubeProvider(company);
      const le = await getLegalEntity(company.id, ACUBE_PROVIDER_NAME, provider.environment);
      if (!le?.legalEntityId) {
        throw new DomainError(
          "EINVOICE_LEGAL_ENTITY_NOT_RESERVED",
          409,
          undefined,
          "Reserve the TIN first."
        );
      }
      const tin = requireCompanyTin(company);
      if (tin !== le.tin) throw new DomainError("EINVOICE_SUPPLIER_ENDPOINT_MISMATCH", 422);
      let current;
      try {
        current = await provider.getLegalEntity(le.legalEntityId, tin);
      } catch (err) {
        if (err instanceof AcubeApiError) throw new DomainError(err.code, 502);
        throw err;
      }
      const patch = patchFromAcube({ ...current, action: "SYNC" });
      if (patch.status === "active" && le.status !== "active") patch.activatedAt = new Date();
      const row = await upsertLegalEntity(
        company.id,
        ACUBE_PROVIDER_NAME,
        provider.environment,
        le.tin,
        patch
      );
      res.json(await acubeConnectionView(company as Company & Record<string, unknown>, row));
    })
  );

  app.post(
    "/api/companies/:companyId/einvoicing/acube/webhooks",
    authMiddleware,
    requireScopedCompanyPermission("settings.company"),
    strictBody(emptyBody),
    asyncHandler(async (req: Request, res: Response) => {
      const company = await storage.getCompany(req.params.companyId);
      if (!company) throw new DomainError("COMPANY_NOT_FOUND", 404);
      const { provider, webhookToken } = await acubeProvider(company);
      const base = webhookBaseUrl();
      if (!base || !base.startsWith("https://")) {
        throw new DomainError(
          "EINVOICE_WEBHOOK_URL_NOT_CONFIGURED",
          409,
          undefined,
          "Set ACUBE_WEBHOOK_BASE_URL to the public https address of this app."
        );
      }
      const events = (process.env.ACUBE_WEBHOOK_EVENTS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const out = await provider.ensureEventDestinations({
        target: `${base}${webhookPath(provider.environment, company.id)}`,
        events: events.length ? events : DEFAULT_WEBHOOK_EVENTS,
        authKey: webhookTokenHeaderName(),
        authToken: webhookToken,
      });
      res.json(out);
    })
  );

  // ─── Webhook (A-Cube → us) ─────────────────────────────────────────

  app.post(
    "/api/webhooks/einvoice/acube/:environment/:companyId?",
    express.raw({ type: "*/*", limit: "256kb" }),
    asyncHandler(async (req: Request, res: Response) => {
      const environment = req.params.environment;
      if (environment !== "sandbox" && environment !== "production") {
        return res.status(404).json({ code: "NOT_FOUND", message: "Unknown environment" });
      }
      const companyId = req.params.companyId?.toLowerCase();
      const config = companyId
        ? await companyProviderConfiguration(companyId, ACUBE_PROVIDER_NAME, { environment })
        : null;
      if (!config) {
        return res.status(503).json({
          code: "EINVOICE_PROVIDER_NOT_CONFIGURED",
          message: "A-Cube is not connected for this environment.",
        });
      }
      const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      const token = config.webhookSecret;
      if (token) {
        if (!tokenMatches(req.get(webhookTokenHeaderName()), token)) {
          return res
            .status(401)
            .json({ code: "EINVOICE_WEBHOOK_BAD_TOKEN", message: "Invalid webhook token" });
        }
      }

      // @target-uri is the URL A-Cube called: the configured public base when set (behind a
      // proxy), else this request's own scheme and host.
      const base = webhookBaseUrl() ?? `${req.protocol}://${req.get("host")}`;
      const request = {
        method: req.method,
        targetUri: `${base}${req.originalUrl}`,
        headers: req.headers as Record<string, string | string[] | undefined>,
      };
      const maxAgeSeconds = maxSignatureAgeSeconds();
      let verdict = verifyAcubeSignature({
        raw,
        request,
        publicKey: await getAcubePublicKey(environment, config.env),
        maxAgeSeconds,
      });
      if (
        !verdict.ok &&
        verdict.reason === "bad_signature" &&
        !process.env.ACUBE_SIGNATURE_PUBLIC_KEY
      ) {
        // The key may have rotated: fetch it once more before refusing.
        verdict = verifyAcubeSignature({
          raw,
          request,
          publicKey: await getAcubePublicKey(environment, config.env, { refresh: true }),
          maxAgeSeconds,
        });
      }
      if (!verdict.ok) {
        log.warn({ reason: verdict.reason }, "A-Cube webhook signature refused");
        return res.status(401).json({
          code: "EINVOICE_WEBHOOK_BAD_SIGNATURE",
          message: "Invalid HTTP message signature",
          reason: verdict.reason,
        });
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.toString("utf8"));
      } catch {
        return res.status(400).json({ code: "INVALID_JSON", message: "Body is not JSON" });
      }
      const parsed = webhookPayload.safeParse(json);
      if (!parsed.success) {
        return res.status(400).json({ code: "VALIDATION_ERROR", message: "Expected an object" });
      }
      const event = normaliseAcubeEvent(parsed.data);
      if (!event) {
        return res.status(202).json({ received: true, ignored: true });
      }
      const { type, payload } = event;
      const queued = await enqueueProviderEvent({
        provider: ACUBE_PROVIDER_NAME,
        environment,
        type,
        eventId: providerEventKey(type, payload),
        companyId,
        payload,
      });
      // Answer fast; the job retries anything this immediate run does not finish.
      if (queued.id && process.env.ACUBE_WEBHOOK_INLINE !== "false") {
        const id = queued.id;
        setImmediate(() => {
          runProviderEvents({ id, limit: 1 }).catch(() =>
            log.warn("immediate event processing failed")
          );
        });
      }
      res.status(200).json({ received: true, duplicate: queued.duplicate });
    })
  );
}
