/**
 * Minimal, dependency-free XML tree builder for the e-invoice generators
 * (PINT AE). Elements are plain objects; `serializeXml` escapes
 * text and attributes and indents two spaces per level. Children that are
 * null/undefined/false are dropped so optional UBL elements read naturally:
 *
 *   el("cac:Party", null,
 *     el("cbc:EndpointID", { schemeID: "0235" }, "1001234567"),
 *     buyer.trn && el("cac:PartyTaxScheme", null, ...));
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlChild[];
  comment?: false;
}
export interface XmlComment {
  comment: true;
  text: string;
}
export type XmlChild = XmlElement | XmlComment | string;
export type XmlInput = XmlChild | null | undefined | false | XmlInput[];

function flatten(input: XmlInput[], out: XmlChild[]): XmlChild[] {
  for (const c of input) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) flatten(c, out);
    else out.push(c);
  }
  return out;
}

export function el(
  name: string,
  attrs: Record<string, string | number | null | undefined> | null,
  ...children: XmlInput[]
): XmlElement {
  const a: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === "") continue;
    a[k] = String(v);
  }
  return { name, attrs: a, children: flatten(children, []) };
}

/** Element with text content; returns null when the value is empty (optional field). */
export function opt(
  name: string,
  value: string | number | null | undefined,
  attrs: Record<string, string | number | null | undefined> | null = null
): XmlElement | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return el(name, attrs, String(value));
}

export function comment(text: string): XmlComment {
  return { comment: true, text: text.replace(/--/g, "- -") };
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serializeNode(node: XmlChild, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);
  if (typeof node === "string") {
    out.push(pad + escapeXml(node));
    return;
  }
  if (node.comment === true) {
    out.push(`${pad}<!-- ${node.text} -->`);
    return;
  }
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  if (node.children.length === 0) {
    out.push(`${pad}<${node.name}${attrs}/>`);
    return;
  }
  if (node.children.length === 1 && typeof node.children[0] === "string") {
    out.push(`${pad}<${node.name}${attrs}>${escapeXml(node.children[0])}</${node.name}>`);
    return;
  }
  out.push(`${pad}<${node.name}${attrs}>`);
  for (const c of node.children) serializeNode(c, depth + 1, out);
  out.push(`${pad}</${node.name}>`);
}

export function serializeXml(root: XmlElement): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  serializeNode(root, 0, out);
  return out.join("\n") + "\n";
}
