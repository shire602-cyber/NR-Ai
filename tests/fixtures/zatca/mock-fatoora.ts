/**
 * Recorded-response stand-in for ZATCA Fatoora used by unit and DB tests.
 * It replays tests/fixtures/zatca/fatoora-sandbox.json and mints the CSID
 * certificates for the CSR's own public key with a throwaway "mock CA", so
 * the signed documents verify end to end. Never used outside tests.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCsr } from "../../../server/services/zatca/der";
import { pemToDer } from "../../../server/services/zatca/keys";
import { generateEgsKeyPair, issueCertificate } from "../../../server/services/zatca/keys";
import { verifyZatcaSignedXml } from "../../../server/services/zatca/sign";

type Recorded = { status: number; body: Record<string, unknown> };
const RECORDING = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fatoora-sandbox.json"), "utf8")
) as Record<string, Recorded>;

export interface MockFatooraOptions {
  validOtp?: string;
  /** Override the outcome of clearance/reporting calls in order. */
  submissionOutcomes?: Array<"ok" | "rejected" | "unavailable">;
}

export interface MockFatoora {
  fetch: typeof fetch;
  calls: Array<{ path: string; headers: Record<string, string>; body: Record<string, unknown> }>;
  /** Signed XML documents received, with their independent verification. */
  received: Array<{ path: string; xml: string; verified: boolean }>;
}

export function createMockFatoora(opts: MockFatooraOptions = {}): MockFatoora {
  const ca = generateEgsKeyPair();
  const outcomes = [...(opts.submissionOutcomes ?? [])];
  let serial = 1000n;
  let lastCsrSpki: Buffer | null = null;
  const calls: MockFatoora["calls"] = [];
  const received: MockFatoora["received"] = [];

  const mint = () => {
    if (!lastCsrSpki) throw new Error("no CSR seen");
    const cert = issueCertificate({
      subjectPublicKeyDer: lastCsrSpki,
      subjectCommonName: "EGS",
      issuerCommonName: "Mock ZATCA Sandbox CA",
      issuerPrivateKeyPem: ca.privateKeyPem,
      serial: serial++,
    });
    // ZATCA returns base64( base64(DER) )
    return Buffer.from(cert.base64, "utf8").toString("base64");
  };
  const reply = (r: Recorded, patch: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ ...r.body, ...patch }), { status: r.status });

  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    const p = new URL(url).pathname.replace(/^\/e-invoicing\/[^/]+/, "");
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path: p, headers, body });
    if (headers["Accept-Version"] !== "V2") return new Response("{}", { status: 406 });
    if (p === "/compliance") {
      if (opts.validOtp && headers.OTP !== opts.validOtp) return reply(RECORDING.complianceBadOtp);
      const pem = Buffer.from(String(body.csr), "base64").toString("utf8");
      lastCsrSpki = parseCsr(pemToDer(pem)).publicKeyDer;
      return reply(RECORDING.compliance, { binarySecurityToken: mint() });
    }
    if (!String(headers.Authorization ?? "").startsWith("Basic ")) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });
    }
    const xml = body.invoice ? Buffer.from(String(body.invoice), "base64").toString("utf8") : "";
    if (xml) received.push({ path: p, xml, verified: verifyZatcaSignedXml(xml).valid });
    if (p === "/compliance/invoices") return reply(RECORDING.complianceInvoice);
    if (p === "/production/csids")
      return reply(RECORDING.production, { binarySecurityToken: mint() });
    if (p === "/invoices/clearance/single" || p === "/invoices/reporting/single") {
      const outcome = outcomes.shift() ?? "ok";
      if (outcome === "unavailable") return reply(RECORDING.unavailable);
      if (outcome === "rejected") return reply(RECORDING.clearanceRejected);
      return p.includes("clearance")
        ? reply(RECORDING.clearance, { clearedInvoice: body.invoice })
        : reply(RECORDING.reporting);
    }
    return new Response("{}", { status: 404 });
  };
  return { fetch: impl as unknown as typeof fetch, calls, received };
}
