// A small, safe XML reader for ISO 20022 statements: elements, attributes and text only.
// DOCTYPE and entity declarations are refused (no entity expansion, no external references), comments and
// processing instructions are skipped, and nesting depth and size are bounded. Namespaces are ignored (local names).

import { decodeEntities } from "./numbers";
import { StatementParseError } from "./types";

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const MAX_DEPTH = 40;

export function parseXmlLite(source: string): XmlNode {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) {
    throw new StatementParseError("The XML declares a DOCTYPE or entity, which is not accepted.", { tag: "DOCTYPE" });
  }
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tokenRe = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/\s*([^>\s]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(source)) !== null) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[2] !== undefined) {
      const name = localName(m[2]);
      if (stack.length < 2 || top.name !== name) {
        throw new StatementParseError(`The XML is not well formed: unexpected closing tag </${m[2]}>.`, { tag: m[2] });
      }
      stack.pop();
    } else if (m[3] !== undefined) {
      const node: XmlNode = { name: localName(m[3]), attrs: parseAttrs(m[4] ?? ""), children: [], text: "" };
      top.children.push(node);
      if (m[5] !== "/") {
        if (stack.length >= MAX_DEPTH) throw new StatementParseError("The XML is nested too deeply.", { tag: node.name });
        stack.push(node);
      }
    } else if (m[6] !== undefined) {
      top.text += decodeEntities(m[6]);
    }
  }
  if (stack.length !== 1) {
    throw new StatementParseError(`The XML is not well formed: <${stack[stack.length - 1].name}> is never closed.`, { tag: stack[stack.length - 1].name });
  }
  return root;
}

function localName(name: string): string {
  const i = name.indexOf(":");
  return i >= 0 ? name.slice(i + 1) : name;
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out[localName(m[1])] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}

/** First descendant reached by a path of child names ("Bal/Tp/CdOrPrtry/Cd"), or undefined. */
export function child(node: XmlNode | undefined, path: string): XmlNode | undefined {
  let cur: XmlNode | undefined = node;
  for (const part of path.split("/")) {
    if (!cur) return undefined;
    cur = cur.children.find((c) => c.name === part);
  }
  return cur;
}

export const childText = (node: XmlNode | undefined, path: string): string | undefined => {
  const n = child(node, path);
  return n ? n.text.trim() : undefined;
};

export const childrenNamed = (node: XmlNode | undefined, name: string): XmlNode[] =>
  node ? node.children.filter((c) => c.name === name) : [];

/** All descendants with this name, depth first. */
export function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
