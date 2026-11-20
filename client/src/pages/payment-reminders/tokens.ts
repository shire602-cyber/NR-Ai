// Merge-field syntax shared by the reminder message editors (see TokenEditor.tsx).

export type TokenSyntax = "single" | "double";

export interface TokenField {
  key: string;
  label: string;
}

const PATTERN: Record<TokenSyntax, RegExp> = {
  single: /\{(\w+)\}/g,
  double: /\{\{(\w+)\}\}/g,
};

export function tokenText(key: string, syntax: TokenSyntax): string {
  return syntax === "double" ? `{{${key}}}` : `{${key}}`;
}

export type MessagePart = { kind: "text"; text: string } | { kind: "token"; key: string };

/** Splits a stored message into text runs and merge fields. */
export function splitMessage(value: string, syntax: TokenSyntax): MessagePart[] {
  const parts: MessagePart[] = [];
  const re = new RegExp(PATTERN[syntax].source, "g");
  let last = 0;
  for (const match of value.matchAll(re)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: value.slice(last, at) });
    parts.push({ kind: "token", key: match[1] });
    last = at + match[0].length;
  }
  if (last < value.length) parts.push({ kind: "text", text: value.slice(last) });
  return parts;
}
