// Optional PII masking before text leaves the server for an external model
// provider (R17-26). Controlled by AI_REDACT_PII=true. Masks UAE TRNs, IBANs, email
// addresses, phone numbers and any explicitly supplied names (customers, contacts).
// Masking is reversible within one request through the returned `restore` function.

const TRN_RE = /\b100[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\b\d{15}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?<![\w.])\+?\d[\d\s().-]{8,16}\d(?![\w.])/g;

export function isRedactionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AI_REDACT_PII === "true";
}

export interface Redactor {
  redact(text: string): string;
  restore(text: string): string;
  /** Number of values masked so far. */
  readonly count: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createRedactor(opts: { names?: string[] } = {}): Redactor {
  const forward = new Map<string, string>();
  const backward = new Map<string, string>();
  const counters: Record<string, number> = {};

  const token = (kind: string, value: string): string => {
    const key = `${kind}:${value}`;
    const existing = forward.get(key);
    if (existing) return existing;
    counters[kind] = (counters[kind] ?? 0) + 1;
    const placeholder = `[${kind}_${counters[kind]}]`;
    forward.set(key, placeholder);
    backward.set(placeholder, value);
    return placeholder;
  };

  const names = (opts.names ?? [])
    .map((n) => n.trim())
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length);

  return {
    redact(text: string): string {
      if (!text) return text;
      let out = text;
      for (const name of names) {
        out = out.replace(new RegExp(escapeRegExp(name), "gi"), () => token("NAME", name));
      }
      out = out.replace(EMAIL_RE, (m) => token("EMAIL", m));
      out = out.replace(IBAN_RE, (m) => token("IBAN", m));
      out = out.replace(TRN_RE, (m) => token("TRN", m));
      out = out.replace(PHONE_RE, (m) => token("PHONE", m));
      return out;
    },
    restore(text: string): string {
      let out = text;
      for (const [placeholder, value] of backward) out = out.split(placeholder).join(value);
      return out;
    },
    get count() {
      return forward.size;
    },
  };
}

/** Redact string `content` of chat messages (plain-string and text-part content). */
export function redactMessages<T extends { content?: unknown }>(
  messages: T[],
  redactor: Redactor
): T[] {
  return messages.map((m) => {
    if (typeof m.content === "string") return { ...m, content: redactor.redact(m.content) };
    if (Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((part: any) =>
          part && part.type === "text" && typeof part.text === "string"
            ? { ...part, text: redactor.redact(part.text) }
            : part
        ),
      };
    }
    return m;
  });
}
