/**
 * A deliberately small markdown subset for the help articles, parsed to a plain
 * AST. The renderer maps the AST to React elements; nothing here ever produces
 * an HTML string, so article text cannot inject markup or script.
 *
 * Supported: ## and ### headings, paragraphs, - and 1. lists, > notes, fenced
 * code, **bold**, *italic*, `code`, [text](href). Links are limited to
 * site-relative paths, https: and mailto:; anything else renders as plain text.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; internal: boolean; c: Inline[] };

export type Block =
  | { t: "h2" | "h3"; id: string; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "quote"; c: Inline[] }
  | { t: "code"; v: string };

export interface FrontMatter {
  title: string;
  summary: string;
  category: string;
  keywords: string[];
  related: string[];
}

export interface ParsedArticle extends FrontMatter {
  body: string;
}

/** Splits `---` front matter from the body. Missing fields default to empty. */
export function parseFrontMatter(source: string): ParsedArticle {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const empty: FrontMatter = { title: "", summary: "", category: "", keywords: [], related: [] };
  if (!text.startsWith("---\n")) return { ...empty, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { ...empty, body: text };
  const meta: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
  return {
    title: meta.title ?? "",
    summary: meta.summary ?? "",
    category: meta.category ?? "",
    keywords: list(meta.keywords),
    related: list(meta.related),
    body: text.slice(end + 4).replace(/^\n+/, ""),
  };
}

const SAFE_HREF = /^(\/(?!\/)|https:\/\/|mailto:)/;

export function isSafeHref(href: string): boolean {
  return SAFE_HREF.test(href.trim()) && !/[\u0000-\u001f\s]/.test(href.trim());
}

/** Inline parsing: code first (its content is literal), then links, bold, italic. */
export function parseInline(input: string): Inline[] {
  const out: Inline[] = [];
  let rest = input;
  const push = (v: string) => {
    if (!v) return;
    const last = out[out.length - 1];
    if (last && last.t === "text") last.v += v;
    else out.push({ t: "text", v });
  };
  while (rest.length > 0) {
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      out.push({ t: "code", v: code[1] });
      rest = rest.slice(code[0].length);
      continue;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      const href = link[2];
      if (isSafeHref(href)) out.push({ t: "link", href, internal: href.startsWith("/"), c: parseInline(link[1]) });
      else push(link[1]);
      rest = rest.slice(link[0].length);
      continue;
    }
    const strong = /^\*\*([^*]+)\*\*/.exec(rest);
    if (strong) {
      out.push({ t: "strong", c: parseInline(strong[1]) });
      rest = rest.slice(strong[0].length);
      continue;
    }
    const em = /^\*([^*\s][^*]*)\*/.exec(rest);
    if (em) {
      out.push({ t: "em", c: parseInline(em[1]) });
      rest = rest.slice(em[0].length);
      continue;
    }
    // plain run up to the next special character
    const next = rest.slice(1).search(/[`[*]/);
    const take = next === -1 ? rest.length : next + 1;
    push(rest.slice(0, take));
    rest = rest.slice(take);
  }
  return out;
}

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function plainText(inlines: Inline[]): string {
  return inlines
    .map((i) => (i.t === "text" || i.t === "code" ? i.v : plainText(i.c)))
    .join("");
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      blocks.push({ t: "code", v: buf.join("\n") });
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      const c = parseInline(heading[2].trim());
      blocks.push({ t: heading[1].length === 2 ? "h2" : "h3", id: slugifyHeading(plainText(c)), c });
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", c: parseInline(buf.join(" ")) });
      continue;
    }
    const ul = /^[-*]\s+/.test(line);
    const ol = /^\d+\.\s+/.test(line);
    if (ul || ol) {
      const marker = ul ? /^[-*]\s+/ : /^\d+\.\s+/;
      const items: Inline[][] = [];
      while (i < lines.length && marker.test(lines[i])) items.push(parseInline(lines[i++].replace(marker, "")));
      blocks.push({ t: ul ? "ul" : "ol", items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|>|[-*]\s|\d+\.\s|```)/.test(lines[i])) buf.push(lines[i++].trim());
    blocks.push({ t: "p", c: parseInline(buf.join(" ")) });
  }
  return blocks;
}
