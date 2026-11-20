/**
 * A-Cube webhook authentication (E1).
 *
 * A-Cube signs every webhook call with IETF HTTP Message Signatures (RFC 9421), algorithm
 * Ed25519, key id "acube" (docs.acubeapi.com/documentation/common/http-signature):
 *
 *   signature-input: pyhms=("@method" "@authority" "@target-uri" "date" "content-digest");
 *                    created=1677383376;keyid="acube";alg="ed25519"
 *   signature:       pyhms=:<base64 signature>:
 *   content-digest:  sha-256=:<base64 sha-256 of the raw body>:
 *
 * The public key is published per environment at
 * https://common.api.acubeapi.com/signature-public-key?environment=sandbox|production as
 * {"public_key": "..."} (PEM in the docs' Python example). ACUBE_SIGNATURE_PUBLIC_KEY pins a key
 * (PEM or base64 of the raw 32-byte key) and skips the fetch.
 *
 * Replay: a request whose `created` is older than ACUBE_WEBHOOK_MAX_AGE_SECONDS (default 12 h,
 * which covers A-Cube's ~10 h retry schedule) or more than 5 minutes in the future is refused;
 * an identical re-delivery inside the window is accepted but deduplicated by the event inbox.
 */
import crypto, { type KeyObject } from "node:crypto";

export const ACUBE_KEY_ID = "acube";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const FUTURE_SKEW_S = 5 * 60;

export interface ParsedSignature {
  label: string;
  components: string[];
  /** The serialized inner list with parameters, exactly as sent (the @signature-params value). */
  paramsRaw: string;
  created: number | null;
  keyid: string | null;
  alg: string | null;
  signature: Buffer;
}

function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
}

/** Split a structured-field dictionary on top-level commas (not inside quotes or parens). */
function splitDictionary(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function parseSignatureHeaders(
  signatureInput: string | undefined,
  signature: string | undefined
): ParsedSignature | null {
  if (!signatureInput || !signature) return null;
  const inputs = new Map<string, string>();
  for (const member of splitDictionary(signatureInput)) {
    const eq = member.indexOf("=");
    if (eq > 0) inputs.set(member.slice(0, eq).trim(), member.slice(eq + 1).trim());
  }
  const sigs = new Map<string, string>();
  for (const member of splitDictionary(signature)) {
    const m = /^([A-Za-z0-9_*.-]+)=:([A-Za-z0-9+/=]+):$/.exec(member.trim());
    if (m) sigs.set(m[1], m[2]);
  }
  for (const [label, raw] of inputs) {
    const sig = sigs.get(label);
    if (!sig) continue;
    const m = /^\(([^)]*)\)(.*)$/.exec(raw);
    if (!m) continue;
    const components = (m[1].match(/"[^"]*"/g) ?? []).map(unquote);
    const params: Record<string, string> = {};
    for (const p of m[2].split(";").filter(Boolean)) {
      const i = p.indexOf("=");
      if (i > 0) params[p.slice(0, i).trim()] = unquote(p.slice(i + 1).trim());
    }
    const keyid = params.keyid ?? null;
    if (keyid !== null && keyid !== ACUBE_KEY_ID) continue;
    const created = params.created !== undefined ? Number(params.created) : null;
    return {
      label,
      components,
      paramsRaw: raw,
      created: Number.isFinite(created) ? created : null,
      keyid,
      alg: params.alg ?? null,
      signature: Buffer.from(sig, "base64"),
    };
  }
  return null;
}

export interface SignatureRequest {
  method: string;
  /** The full URL A-Cube called (scheme, authority, path and query). */
  targetUri: string;
  headers: Record<string, string | string[] | undefined>;
}

function headerValue(headers: SignatureRequest["headers"], name: string): string | null {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  if (!key) return null;
  const v = headers[key];
  if (v === undefined) return null;
  return (Array.isArray(v) ? v.join(", ") : v).trim();
}

export function buildSignatureBase(
  components: string[],
  paramsRaw: string,
  req: SignatureRequest
): string | null {
  const url = new URL(req.targetUri);
  const lines: string[] = [];
  for (const c of components) {
    let value: string | null;
    switch (c) {
      case "@method":
        value = req.method.toUpperCase();
        break;
      case "@authority":
        value = url.host.toLowerCase();
        break;
      case "@target-uri":
        value = url.toString();
        break;
      case "@scheme":
        value = url.protocol.replace(/:$/, "").toLowerCase();
        break;
      case "@path":
        value = url.pathname;
        break;
      case "@query":
        value = url.search || "?";
        break;
      case "@request-target":
        value = `${url.pathname}${url.search}`;
        break;
      default:
        if (c.startsWith("@")) return null; // unsupported derived component
        value = headerValue(req.headers, c);
    }
    if (value === null) return null;
    lines.push(`"${c}": ${value}`);
  }
  lines.push(`"@signature-params": ${paramsRaw}`);
  return lines.join("\n");
}

export function contentDigest(raw: Buffer): string {
  return `sha-256=:${crypto.createHash("sha256").update(raw).digest("base64")}:`;
}

export function verifyContentDigest(header: string | null, raw: Buffer): boolean {
  if (!header) return false;
  const m = /sha-256=:([A-Za-z0-9+/=]+):/.exec(header);
  if (!m) return false;
  const expected = crypto.createHash("sha256").update(raw).digest();
  const given = Buffer.from(m[1], "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** A public key from PEM, or from base64 of the raw 32-byte Ed25519 key. */
export function publicKeyFrom(material: string): KeyObject {
  const text = material.trim();
  if (text.includes("BEGIN")) return crypto.createPublicKey(text);
  const raw = Buffer.from(text, "base64");
  if (raw.length === 32) {
    return crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
  }
  return crypto.createPublicKey({ key: raw, format: "der", type: "spki" });
}

export type SignatureFailure =
  | "missing_signature"
  | "unsupported_algorithm"
  | "missing_component"
  | "bad_content_digest"
  | "stale"
  | "bad_signature";

export interface VerifyResult {
  ok: boolean;
  reason?: SignatureFailure;
  created?: number | null;
  signature?: string;
}

export function maxSignatureAgeSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ACUBE_WEBHOOK_MAX_AGE_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 12 * 60 * 60;
}

export function verifyAcubeSignature(args: {
  raw: Buffer;
  request: SignatureRequest;
  publicKey: KeyObject;
  now?: Date;
  maxAgeSeconds?: number;
}): VerifyResult {
  const { raw, request } = args;
  const parsed = parseSignatureHeaders(
    headerValue(request.headers, "signature-input") ?? undefined,
    headerValue(request.headers, "signature") ?? undefined
  );
  if (!parsed) return { ok: false, reason: "missing_signature" };
  if (parsed.alg && parsed.alg.toLowerCase() !== "ed25519") {
    return { ok: false, reason: "unsupported_algorithm" };
  }
  // The body must be covered: without content-digest a valid signature says nothing about it.
  if (!parsed.components.includes("content-digest")) {
    return { ok: false, reason: "missing_component" };
  }
  if (!verifyContentDigest(headerValue(request.headers, "content-digest"), raw)) {
    return { ok: false, reason: "bad_content_digest" };
  }
  const nowS = Math.floor((args.now ?? new Date()).getTime() / 1000);
  const maxAge = args.maxAgeSeconds ?? maxSignatureAgeSeconds();
  if (
    parsed.created === null ||
    parsed.created > nowS + FUTURE_SKEW_S ||
    nowS - parsed.created > maxAge
  ) {
    return { ok: false, reason: "stale", created: parsed.created };
  }
  const base = buildSignatureBase(parsed.components, parsed.paramsRaw, request);
  if (base === null) return { ok: false, reason: "missing_component" };
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(base, "utf8"), args.publicKey, parsed.signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature", created: parsed.created };
  return { ok: true, created: parsed.created, signature: parsed.signature.toString("base64") };
}

/**
 * Sign a request the way A-Cube does. Used by the contract tests and the fixture generator to
 * produce a valid webhook from a test keypair; never used against A-Cube itself.
 */
export function signAcubeRequest(args: {
  privateKey: KeyObject;
  method: string;
  targetUri: string;
  body: Buffer | string;
  date?: string;
  created?: number;
  label?: string;
}): Record<string, string> {
  const raw = Buffer.isBuffer(args.body) ? args.body : Buffer.from(args.body, "utf8");
  const headers: Record<string, string> = {
    date: args.date ?? new Date().toUTCString(),
    "content-digest": contentDigest(raw),
  };
  const created = args.created ?? Math.floor(Date.now() / 1000);
  const label = args.label ?? "pyhms";
  const components = ["@method", "@authority", "@target-uri", "date", "content-digest"];
  const paramsRaw = `(${components.map((c) => `"${c}"`).join(" ")});created=${created};keyid="${ACUBE_KEY_ID}";alg="ed25519"`;
  const base = buildSignatureBase(components, paramsRaw, {
    method: args.method,
    targetUri: args.targetUri,
    headers,
  });
  const sig = crypto.sign(null, Buffer.from(base as string, "utf8"), args.privateKey);
  return {
    ...headers,
    "signature-input": `${label}=${paramsRaw}`,
    signature: `${label}=:${sig.toString("base64")}:`,
  };
}

// ─── Public key cache ───────────────────────────────────────────────────

const KEY_TTL_MS = 6 * 60 * 60 * 1000;
const keyCache = new Map<string, { key: KeyObject; at: number }>();

export function resetAcubeKeyCache(): void {
  keyCache.clear();
}

export async function getAcubePublicKey(
  environment: "sandbox" | "production",
  env: NodeJS.ProcessEnv = process.env,
  opts: { fetch?: typeof fetch; refresh?: boolean; now?: number } = {}
): Promise<KeyObject> {
  if (env.ACUBE_SIGNATURE_PUBLIC_KEY) return publicKeyFrom(env.ACUBE_SIGNATURE_PUBLIC_KEY);
  const now = opts.now ?? Date.now();
  const cached = keyCache.get(environment);
  if (cached && !opts.refresh && now - cached.at < KEY_TTL_MS) return cached.key;
  const common = (env.ACUBE_COMMON_URL || "https://common.api.acubeapi.com").replace(/\/+$/, "");
  const res = await (opts.fetch ?? fetch)(
    `${common}/signature-public-key?environment=${encodeURIComponent(environment)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`A-Cube signature public key returned HTTP ${res.status}`);
  const body = (await res.json()) as { public_key?: string; publicKey?: string };
  const material = body.public_key ?? body.publicKey;
  if (!material) throw new Error("A-Cube signature public key response has no public_key");
  const key = publicKeyFrom(material);
  keyCache.set(environment, { key, at: now });
  return key;
}
