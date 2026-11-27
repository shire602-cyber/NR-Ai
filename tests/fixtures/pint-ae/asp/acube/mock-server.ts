/**
 * A small local A-Cube UAE API for contract tests (node `http`, port 0, real sockets).
 *
 * It mirrors only what docs.acubeapi.com documents (read 2026-11-27):
 *   POST {login}                 {email,password,environment} -> 200 {token} (JWT, 24 h)
 *   POST /invoices | /credit-notes   application/xml + Bearer
 *        201 {uuid,status,invoiceNumber|creditNoteNumber,totalAmount}
 *        400 / 404 / 422 problem+json ({title,detail,status,type}; 422 adds violations[])
 *   GET  /{invoices|credit-notes}?direction=outgoing&itemsPerPage&page   (hydra collection)
 *   GET  /{invoices|credit-notes}/{uuid}          status (processed, delivered, accepted, ...)
 *   GET  /{invoices|credit-notes}/{uuid}/source   the original XML
 *
 * Deliberately NOT modelled, because A-Cube does not document it: any idempotency-key header,
 * duplicate-POST behaviour, 409 and rate-limit semantics. A scripted `status` reply stands in
 * for an undocumented error, and the mock accepts a second POST of the same XML as a new
 * document so a test can count (and forbid) a re-POST.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

export type MockKind = "invoices" | "credit-notes";

export interface MockRequest {
  method: string;
  path: string;
  search: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface MockDocument {
  uuid: string;
  kind: MockKind;
  number: string;
  xml: string;
  status: string;
}

/** What the next submit (POST /invoices or /credit-notes) does. Consumed in order. */
export type SubmitScript =
  | { type: "created"; status?: string }
  /** The document is stored but the response never arrives (lost response / client timeout). */
  | { type: "lost" }
  /** Nothing is stored and nothing is answered (the request stalls). */
  | { type: "stall" }
  | { type: "reply"; status: number; body?: unknown; contentType?: string };

export interface AcubeMock {
  /** `ACUBE_BASE_URL` value. */
  baseUrl: string;
  /** `ACUBE_LOGIN_URL` value. */
  loginUrl: string;
  requests: MockRequest[];
  documents: Map<string, MockDocument>;
  /** Queue the behaviour of the next submits; the default is `created`. */
  script: SubmitScript[];
  logins: () => number;
  posts: () => MockRequest[];
  setStatus: (uuid: string, status: string) => void;
  /** Make every token issued so far invalid (the next call answers 401 until a new login). */
  expireTokens: () => void;
  /** Fail the next logins with this HTTP status. */
  failLogins: (status: number, times?: number) => void;
  close: () => Promise<void>;
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function mockJwt(expSeconds = Math.floor(Date.now() / 1000) + 24 * 3600, jti = ""): string {
  return `${b64({ alg: "none" })}.${b64({ exp: expSeconds, jti })}.c2ln`;
}

export function problem(status: number, title: string, detail: string, extra: object = {}) {
  return {
    "@context": "/contexts/Error",
    "@type": "hydra:Error",
    type: `https://tools.ietf.org/html/rfc2616#section-10`,
    title,
    detail,
    status,
    ...extra,
  };
}

/** The documented 422 body: a violation list with propertyPath, message, code and hint. */
export function violationsBody(
  violations: Array<{ propertyPath: string; message: string; code: string; hint?: string }>
) {
  return problem(422, "An error occurred", "Validation failed", { violations });
}

const numberOf = (xml: string) => /<cbc:ID>([^<]+)<\/cbc:ID>/.exec(xml)?.[1]?.trim() ?? "UNKNOWN";

export async function startAcubeMock(): Promise<AcubeMock> {
  const requests: MockRequest[] = [];
  const documents = new Map<string, MockDocument>();
  const script: SubmitScript[] = [];
  let validTokens = new Set<string>();
  let loginCount = 0;
  let loginFailures: { status: number; left: number } | null = null;

  const send = (
    res: import("node:http").ServerResponse,
    status: number,
    body: unknown,
    contentType = "application/json"
  ) => {
    res.writeHead(status, { "content-type": contentType });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const docJson = (d: MockDocument) => ({
    uuid: d.uuid,
    direction: "outgoing",
    status: d.status,
    ...(d.kind === "invoices"
      ? { invoiceNumber: d.number, documentTypeCode: 380 }
      : { creditNoteNumber: d.number, documentTypeCode: 381 }),
    totalAmount: "0.00",
  });

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const url = new URL(req.url ?? "/", "http://mock.local");
    const record: MockRequest = {
      method: req.method ?? "",
      path: url.pathname,
      search: url.search,
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };
    requests.push(record);

    if (record.method === "POST" && record.path === "/login") {
      loginCount++;
      if (loginFailures && loginFailures.left > 0) {
        loginFailures.left--;
        return send(res, loginFailures.status, problem(loginFailures.status, "Login", "refused"));
      }
      const parsed = JSON.parse(record.body || "{}") as Record<string, unknown>;
      if (!parsed.email || !parsed.password || !parsed.environment) {
        return send(res, 400, problem(400, "Bad request", "email, password, environment"));
      }
      const token = mockJwt(undefined, randomUUID());
      validTokens.add(token);
      return send(res, 200, { token });
    }

    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
    if (!bearer || !validTokens.has(bearer)) {
      return send(res, 401, { code: 401, message: "Invalid JWT Token" });
    }

    if (
      record.method === "POST" &&
      (record.path === "/invoices" || record.path === "/credit-notes")
    ) {
      const kind: MockKind = record.path === "/invoices" ? "invoices" : "credit-notes";
      if (!String(req.headers["content-type"] ?? "").startsWith("application/xml")) {
        return send(res, 400, problem(400, "Bad request", "Content-Type must be application/xml"));
      }
      const next = script.shift() ?? { type: "created" as const };
      if (next.type === "stall") return; // never answered; the client aborts
      if (next.type === "reply") {
        return send(res, next.status, next.body ?? {}, next.contentType);
      }
      const doc: MockDocument = {
        uuid: randomUUID(),
        kind,
        number: numberOf(record.body),
        xml: record.body,
        status: next.type === "created" ? (next.status ?? "processed") : "processed",
      };
      documents.set(doc.uuid, doc);
      if (next.type === "lost") return; // stored, but the answer is lost
      return send(res, 201, docJson(doc));
    }

    const list = /^\/(invoices|credit-notes)$/.exec(record.path);
    if (record.method === "GET" && list) {
      const kind = list[1] as MockKind;
      const direction = url.searchParams.get("direction");
      const member =
        direction === "incoming"
          ? []
          : [...documents.values()].filter((d) => d.kind === kind).map(docJson);
      return send(res, 200, { member, totalItems: member.length }, "application/ld+json");
    }
    const one = /^\/(invoices|credit-notes)\/([^/]+)(\/source)?$/.exec(record.path);
    if (record.method === "GET" && one) {
      const doc = documents.get(one[2]);
      if (!doc || doc.kind !== one[1]) {
        return send(res, 404, problem(404, "Not Found", "Not Found"));
      }
      if (one[3]) return send(res, 200, doc.xml, "application/xml");
      return send(res, 200, docJson(doc));
    }
    return send(res, 404, problem(404, "Not Found", `mock has no route ${record.path}`));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("A-Cube mock did not bind");
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl: origin,
    loginUrl: `${origin}/login`,
    requests,
    documents,
    script,
    logins: () => loginCount,
    posts: () =>
      requests.filter(
        (r) => r.method === "POST" && (r.path === "/invoices" || r.path === "/credit-notes")
      ),
    setStatus(uuid, status) {
      const doc = documents.get(uuid);
      if (!doc) throw new Error(`mock: no document ${uuid}`);
      doc.status = status;
    },
    expireTokens() {
      validTokens = new Set();
    },
    failLogins(status, times = 1) {
      loginFailures = { status, left: times };
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
