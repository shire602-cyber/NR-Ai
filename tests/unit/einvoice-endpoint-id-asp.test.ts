/**
 * PINT AE seller and buyer cbc:EndpointID (IBT-034 / IBT-049) on the wire, for BOTH accredited
 * ASPs, plus the gap where a buyer has neither a recorded endpoint nor a valid TRN.
 *
 * - A-Cube posts our PINT AE XML as-is: both parties must carry EndpointID schemeID="0235" with
 *   the 10-digit TIN derived from the 15-digit TRN.
 * - Complyance (GETS JSON, the default) maps the same document: parties.*.peppolId is the TIN
 *   and extensions.peppol_*_peppolIdScheme is 0235; in Unify XML mode the UBL rides inside the
 *   envelope unchanged.
 * - No endpoint and no valid TRN: the data check refuses with EINVOICE_BUYER_ENDPOINT_MISSING
 *   (field customer.endpointId) and no provider is ever called.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AcubeEInvoiceProvider,
  resetAcubeTokenCache,
} from "../../server/services/einvoice/providers/acube";
import { ComplyanceEInvoiceProvider } from "../../server/services/einvoice/providers/complyance";
import {
  BUYER_ENDPOINT_MISSING,
  generateEInvoiceXML,
  validateForEInvoicing,
} from "../../server/services/einvoice.service";
import { submitEInvoice } from "../../server/services/einvoice-submit.service";
import { runPintAeRules } from "../../server/services/einvoice/pint-ae-rules";
import { first, parseXml, textAt } from "../../server/services/einvoice/dom";
import type { EInvoiceProvider } from "../../server/services/einvoice-provider";
import { PINT_AE_FIXTURES, fixtureCompany, uaeBuyer } from "../fixtures/pint-ae/fixtures";

const SELLER_TIN = "1001234567"; // TRN 100123456700003
const BUYER_TIN = "1007654321"; // TRN 100765432100003

/** The UAE buyer with no recorded Peppol endpoint: EndpointID must come from its TRN. */
const trnOnlyBuyer = { ...uaeBuyer, endpointId: null, endpointScheme: null };

function document(customer = trnOnlyBuyer) {
  const f = PINT_AE_FIXTURES[0];
  return generateEInvoiceXML(f.invoice, f.lines, fixtureCompany, customer, f.opts).xml;
}

function endpoints(xml: string) {
  const root = parseXml(xml).documentElement as unknown as Element;
  const read = (p: string) => {
    const party = first(root, p) as Element;
    return {
      scheme: first(party, "cbc:EndpointID")?.getAttribute("schemeID") ?? null,
      value: textAt(party, "cbc:EndpointID"),
    };
  };
  return {
    seller: read("cac:AccountingSupplierParty/cac:Party"),
    buyer: read("cac:AccountingCustomerParty/cac:Party"),
  };
}

const EXPECTED = {
  seller: { scheme: "0235", value: SELLER_TIN },
  buyer: { scheme: "0235", value: BUYER_TIN },
};

const submission = (xml: string) => ({
  invoiceId: "inv-1",
  invoiceNumber: "INV-2027-0001",
  uuid: "19e2c9a3-b000-4fb0-9bd5-a9c4ebda2358",
  xml,
  documentType: "380",
  companyId: "00000000-0000-4000-8000-000000000001",
});

function recorded(provider: "acube" | "complyance", name: string) {
  const file = path.join(
    __dirname,
    "..",
    "fixtures",
    "pint-ae",
    "asp",
    provider,
    `${provider}-sandbox.json`
  );
  const all = JSON.parse(fs.readFileSync(file, "utf8")).interactions as Array<{
    name: string;
    response: { status: number; body?: unknown };
  }>;
  const hit = all.find((i) => i.name === name);
  if (!hit) throw new Error(`no recording ${name}`);
  return hit.response;
}

/** A fetch that answers from the doc-derived recordings in order and records every body sent. */
function scripted(provider: "acube" | "complyance", names: string[]) {
  const bodies: string[] = [];
  const queue = [...names];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(String(init.body ?? ""));
    const res = recorded(provider, queue.shift()!);
    return new Response(JSON.stringify(res.body ?? null), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

beforeEach(() => {
  // The recorded A-Cube login JWT has a fixed exp; pin Date only (see einvoice-acube-adapter).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:05:00Z"));
  resetAcubeTokenCache();
});
afterEach(() => {
  vi.useRealTimers();
  resetAcubeTokenCache();
});

describe("PINT AE EndpointID: the serializer", () => {
  it("derives seller and buyer EndpointID schemeID 0235 + TIN from the TRNs", () => {
    const xml = document();
    expect(endpoints(xml)).toEqual(EXPECTED);
    expect(runPintAeRules(xml).filter((f) => f.id === "PINT-EndpointID")).toEqual([]);
  });
});

describe("PINT AE EndpointID: A-Cube", () => {
  it("A-Cube receives the PINT AE XML with both EndpointIDs on scheme 0235", async () => {
    const xml = document();
    const { fetchImpl, bodies } = scripted("acube", ["login", "submit-invoice-201"]);
    const p = new AcubeEInvoiceProvider(
      {
        EINVOICE_PROVIDER: "acube",
        ACUBE_EMAIL: "sandbox@example.test",
        ACUBE_PASSWORD: "x",
      } as NodeJS.ProcessEnv,
      { fetch: fetchImpl }
    );
    const res = await p.submit(submission(xml));
    expect(res.status).toBe("submitted");
    const sentXml = bodies[1];
    expect(sentXml).toBe(xml);
    expect(endpoints(sentXml)).toEqual(EXPECTED);
  });
});

describe("PINT AE EndpointID: Complyance", () => {
  const env = {
    EINVOICE_PROVIDER: "complyance",
    COMPLYANCE_API_KEY: "cmp_sandbox_key_never_logged_0123456789",
  } as NodeJS.ProcessEnv;
  const provider = (fetchImpl: typeof fetch, extra: Record<string, string> = {}) =>
    new ComplyanceEInvoiceProvider({ ...env, ...extra } as NodeJS.ProcessEnv, {
      fetch: fetchImpl,
      sourceFor: async () => ({ name: "muhasib-test", version: "v1" }),
    });

  it("GETS JSON carries both parties' TIN as peppolId with scheme 0235", async () => {
    const { fetchImpl, bodies } = scripted("complyance", ["submit_ok"]);
    const res = await provider(fetchImpl).submit(submission(document()));
    expect(res.status).toBe("submitted");
    const body = JSON.parse(bodies[0]);
    expect(body.payload.parties.seller.peppolId).toBe(SELLER_TIN);
    expect(body.payload.parties.buyer.peppolId).toBe(BUYER_TIN);
    expect(body.payload.extensions).toMatchObject({
      peppol_seller_peppolIdScheme: "0235",
      peppol_buyer_peppolIdScheme: "0235",
    });
  });

  it("Unify XML mode sends the UBL with both EndpointIDs on scheme 0235", async () => {
    const { fetchImpl, bodies } = scripted("complyance", ["submit_ok"]);
    await provider(fetchImpl, { COMPLYANCE_SUBMIT_FORMAT: "xml" }).submit(submission(document()));
    const inner = bodies[0].replace(/^[\s\S]*<payload>/, "").replace(/<\/payload>[\s\S]*$/, "");
    expect(endpoints(inner)).toEqual(EXPECTED);
  });
});

describe("PINT AE EndpointID: a buyer with no endpoint and no valid TRN", () => {
  const noAddressBuyer = {
    ...uaeBuyer,
    trn: null,
    endpointId: null,
    endpointScheme: null,
  };

  it("the data check names the fix (customer.endpointId, EINVOICE_BUYER_ENDPOINT_MISSING)", () => {
    const f = PINT_AE_FIXTURES[0];
    const issues = validateForEInvoicing(
      { ...f.invoice, customerTrn: null },
      f.lines,
      fixtureCompany,
      { customer: noAddressBuyer }
    );
    const issue = issues.find((i) => i.code === BUYER_ENDPOINT_MISSING);
    expect(issue).toMatchObject({ field: "customer.endpointId" });
    expect(issue!.message).toMatch(/15-digit TRN/);
    expect(issue!.message).toMatch(/0235/);
    // Without the data check the generated document would fail PINT-EndpointID on the buyer.
    const xml = generateEInvoiceXML(
      { ...f.invoice, customerTrn: null },
      f.lines,
      fixtureCompany,
      noAddressBuyer,
      f.opts
    ).xml;
    const rule = runPintAeRules(xml).find((r) => r.id === "PINT-EndpointID");
    expect(rule?.location).toBe("buyer");
    expect(rule?.message).toMatch(/buyer's from the buyer's 15-digit TRN/);
  });

  it("submit refuses with 422 EINVOICE_VALIDATION_FAILED before either ASP is called", async () => {
    const f = PINT_AE_FIXTURES[0];
    for (const name of ["acube", "complyance"]) {
      const submit = vi.fn();
      const provider = { name, submit } as unknown as EInvoiceProvider;
      const res = await submitEInvoice({
        invoice: { ...f.invoice, status: "sent", customerTrn: null },
        lines: f.lines,
        company: fixtureCompany,
        provider,
        ctx: { customer: noAddressBuyer },
      });
      expect(res).toMatchObject({ ok: false, status: 422, code: "EINVOICE_VALIDATION_FAILED" });
      expect(res.ok === false && res.issues?.map((i) => i.code)).toContain(BUYER_ENDPOINT_MISSING);
      expect(submit).not.toHaveBeenCalled();
    }
  });
});

describe("PINT AE EndpointID: the fix is actionable in the UI (en and ar)", () => {
  it("the 422 body keeps the code, points at the customer's contact and has localised fix text", async () => {
    const { einvoiceIssuesFromError, einvoiceFieldHint, einvoiceIssueTextKey } =
      await import("../../client/src/lib/einvoice-issues");
    const { issueTextKey, fieldLabelKey } =
      await import("../../client/src/components/einvoice/einvoice-meta");
    const body = {
      code: "EINVOICE_VALIDATION_FAILED",
      issues: [{ field: "customer.endpointId", code: BUYER_ENDPOINT_MISSING, message: "x" }],
    };
    const [issue] = einvoiceIssuesFromError(body);
    expect(issue).toEqual({
      field: "customer.endpointId",
      code: BUYER_ENDPOINT_MISSING,
      message: "x",
    });
    expect(einvoiceFieldHint(issue.field)).toMatchObject({
      labelKey: "invoices.einvoiceField.customerEndpoint",
      whereKey: "invoices.einvoiceWhere.customer",
      href: "/contacts",
    });
    // A schematron/rule finding on the endpoint also sends the user to the contact.
    expect(einvoiceFieldHint("PINT AE rule PINT-EndpointID").href).toBe("/contacts");
    expect(fieldLabelKey("customer.endpointId")).toBe("einvoicing.field_customerEndpoint");

    const catalogs = (ns: string) =>
      (["en", "ar"] as const).map(
        (lang) =>
          [
            lang,
            JSON.parse(
              fs.readFileSync(
                path.join(__dirname, "..", "..", "client", "src", "locales", lang, `${ns}.json`),
                "utf8"
              )
            ) as Record<string, string>,
          ] as const
      );
    for (const [ns, keys] of [
      [
        "invoices",
        [einvoiceIssueTextKey(BUYER_ENDPOINT_MISSING)!, "invoices.einvoiceField.customerEndpoint"],
      ],
      ["einvoicing", [issueTextKey(BUYER_ENDPOINT_MISSING)!, "einvoicing.field_customerEndpoint"]],
    ] as const) {
      for (const [lang, cat] of catalogs(ns)) {
        for (const k of keys) {
          expect(cat[k], `${lang} ${k}`).toBeTruthy();
          if (lang === "ar") expect(cat[k], k).toMatch(/[؀-ۿ]/);
        }
      }
      const [, en] = catalogs(ns)[0];
      expect(en[keys[0]]).toMatch(/15-digit TRN/);
    }
  });
});
