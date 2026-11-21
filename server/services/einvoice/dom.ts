/**
 * Namespace-aware DOM helpers for UBL documents (rule list, inbound parser). Paths are "/"-separated qualified names using the UBL
 * prefixes cac/cbc/ext regardless of the prefixes the document itself uses.
 */
// @xmldom/xmldom is declared as a direct dependency.
import { DOMParser } from "@xmldom/xmldom";

export const UBL_NS: Record<string, string> = {
  cac: "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
  cbc: "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
  ext: "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2",
  inv: "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
  cn: "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2",
  sig: "urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2",
  sac: "urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2",
  sbc: "urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2",
  ds: "http://www.w3.org/2000/09/xmldsig#",
  xades: "http://uri.etsi.org/01903/v1.3.2#",
};

export type XNode = Element;

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

/** Parse XML; throws XmlParseError on malformed input (no external entities are resolved). */
export function parseXml(xml: string): Document {
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (msg: string) => errors.push(msg),
      fatalError: (msg: string) => errors.push(msg),
    },
  }).parseFromString(xml, "text/xml");
  if (errors.length > 0 || !doc || !doc.documentElement) {
    throw new XmlParseError(errors[0] ?? "Document is not well-formed XML");
  }
  if (/<!DOCTYPE/i.test(xml)) throw new XmlParseError("DOCTYPE declarations are not accepted");
  return doc as unknown as Document;
}

function matches(node: Node, qname: string): boolean {
  if (node.nodeType !== 1) return false;
  const [prefix, local] = qname.includes(":") ? qname.split(":") : ["", qname];
  const e = node as Element;
  if (e.localName !== local) return false;
  if (!prefix) return true;
  return e.namespaceURI === UBL_NS[prefix];
}

export function children(node: XNode | Document, qname: string): XNode[] {
  const out: XNode[] = [];
  const list = node.childNodes;
  for (let i = 0; i < list.length; i++) {
    if (matches(list[i], qname)) out.push(list[i] as XNode);
  }
  return out;
}

/** All nodes at a relative path ("cac:Party/cac:PostalAddress/cbc:CityName"). */
export function all(node: XNode | Document, path: string): XNode[] {
  let current: (XNode | Document)[] = [node];
  for (const step of path.split("/").filter(Boolean)) {
    const next: XNode[] = [];
    for (const n of current) next.push(...children(n, step));
    current = next;
  }
  return current as XNode[];
}

export function first(node: XNode | Document, path: string): XNode | null {
  return all(node, path)[0] ?? null;
}

export function text(node: XNode | null | undefined): string | null {
  if (!node) return null;
  const t = node.textContent;
  return t === null ? null : t.trim();
}

export function textAt(node: XNode | Document, path: string): string | null {
  return text(first(node, path));
}

export function partyVatTrn(party: XNode | null): string | null {
  if (!party) return null;
  const vat = all(party, "cac:PartyTaxScheme").find(
    (tax) => textAt(tax, "cac:TaxScheme/cbc:ID") === "VAT"
  );
  return vat ? textAt(vat, "cbc:CompanyID") : null;
}

export function attr(node: XNode | null | undefined, name: string): string | null {
  if (!node) return null;
  const v = node.getAttribute(name);
  return v === null || v === "" ? null : v;
}

export function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Fils (integer hundredths) of a decimal string — exact for 2dp amounts. */
export function fils(value: string | null | undefined): number {
  const n = num(value);
  return n === null ? 0 : Math.round(n * 100);
}

/** Descendants (any depth) matching a qualified name. */
export function descendants(node: XNode | Document, qname: string): XNode[] {
  const out: XNode[] = [];
  const walk = (n: Node) => {
    const list = n.childNodes;
    for (let i = 0; i < list.length; i++) {
      if (matches(list[i], qname)) out.push(list[i] as XNode);
      if (list[i].nodeType === 1) walk(list[i]);
    }
  };
  walk(node as unknown as Node);
  return out;
}
