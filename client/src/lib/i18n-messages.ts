/**
 * Page-level message dictionaries.
 *
 * THE pattern for all new and migrated UI text (see docs in the PR / report):
 *
 *   // Invoices.i18n.ts (sits next to Invoices.tsx)
 *   export const messages = defineMessages("Invoices",
 *     { newInvoice: "New invoice", selected_one: "{count} invoice selected", selected_other: "{count} invoices selected" },
 *     { newInvoice: "فاتورة جديدة", selected_one: ..., selected_two: ..., selected_few: ..., selected_many: ..., selected_other: ... },
 *   );
 *
 *   // Invoices.tsx
 *   const tr = messages.useT();            // hook: re-renders on language switch
 *   tr("newInvoice")                        // typed key
 *   tr("greeting", { name })                // named {placeholders}: never concatenate
 *   tr.plural("selected", count)            // zero/one/two/few/many via Intl.PluralRules
 *   messages.t("newInvoice")                // non-hook form for module-level code
 *
 * Why not the central `t` dictionary in i18n.ts: it is already ~900 lines and
 * shared by every page, so every new screen would conflict with every other
 * branch. A per-page table is type-checked (the Arabic table must have exactly
 * the English keys), tree-shaken with the lazy page chunk, and reviewed by a
 * translator one screen at a time. Wording shared between pages comes from
 * `i18n-glossary.ts`, enforced by a unit test.
 */
import { useMemo } from "react";
import { useI18n, type Locale } from "./i18n";

export type MessageParams = Record<string, string | number | null | undefined>;

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const PLURAL_SUFFIX: readonly PluralCategory[] = ["zero", "one", "two", "few", "many", "other"];

/** Fill `{name}` placeholders. Unknown placeholders are left visible. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name] ?? "") : match
  );
}

const pluralRules: Record<Locale, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
  ar: new Intl.PluralRules("ar"),
};

/** The CLDR plural category of `n` in `locale` (Arabic has all six). */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  return pluralRules[locale].select(n) as PluralCategory;
}

export type PluralForms = Partial<Record<PluralCategory, string>> & { other: string };

/**
 * Choose the right form for a count. `{count}` inside a form is replaced by the
 * number (Western digits, grouped). An explicit `zero` form wins for 0 in every
 * language ("No invoices"), which is how English handles empty states.
 */
export function plural(locale: Locale, n: number, forms: PluralForms): string {
  const category: PluralCategory = n === 0 && forms.zero !== undefined ? "zero" : pluralCategory(locale, n);
  const form = forms[category] ?? forms.other;
  return interpolate(form, { count: new Intl.NumberFormat("en-US").format(n) });
}

type Table<K extends string> = Record<K, string>;
type PluralBase<K extends string> = K extends `${infer B}_other` ? B : never;

export interface Translator<K extends string> {
  (key: K, params?: MessageParams): string;
  plural: (base: PluralBase<K>, count: number, params?: MessageParams) => string;
  locale: Locale;
}

// All registered tables, so a message can travel as a plain string (zod
// schema messages are built once at module load) and be resolved when shown.
const registry = new Map<string, Record<Locale, Record<string, string>>>();
const MARKER = "⁣"; // invisible separator prefix for deferred messages

/** Resolve a deferred `messages.marker()` string for the active language. */
export function resolveMessage(text: string | undefined, locale: Locale): string | undefined {
  if (!text || text[0] !== MARKER) return text;
  const [ref, ...rest] = text.slice(1).split("⁣");
  const dot = ref.indexOf(".");
  const table = registry.get(ref.slice(0, dot));
  const template = table?.[locale][ref.slice(dot + 1)] ?? table?.en[ref.slice(dot + 1)] ?? ref;
  const params = rest.length ? (JSON.parse(rest[0]) as MessageParams) : undefined;
  return interpolate(template, params);
}

export function defineMessages<K extends string>(id: string, en: Table<K>, ar: Table<K>) {
  const tables: Record<Locale, Table<K>> = { en, ar };
  registry.set(id, tables);

  const lookup = (locale: Locale, key: string, params?: MessageParams) =>
    interpolate(tables[locale][key as K] || tables.en[key as K] || key, params);

  function build(locale: Locale): Translator<K> {
    const tr = ((key: K, params?: MessageParams) => lookup(locale, key, params)) as Translator<K>;
    tr.locale = locale;
    tr.plural = (base, count, params) => {
      const forms: Partial<Record<PluralCategory, string>> = {};
      for (const category of PLURAL_SUFFIX) {
        const template = tables[locale][`${base}_${category}` as K] || tables.en[`${base}_${category}` as K];
        if (template) forms[category] = interpolate(template, params);
      }
      return plural(locale, count, { other: String(count), ...forms });
    };
    return tr;
  }

  return {
    id,
    tables,
    /** Hook form: subscribes to the language so the component re-renders on switch. */
    useT(): Translator<K> {
      const locale = useI18n((state) => state.locale);
      return useMemo(() => build(locale), [locale]);
    },
    /** Non-hook form for module-level helpers; reads the language at call time. */
    t(key: K, params?: MessageParams): string {
      return lookup(useI18n.getState().locale, key, params);
    },
    /** Deferred message that is resolved by <FormMessage/> (zod schemas). */
    marker(key: K, params?: MessageParams): string {
      return `${MARKER}${id}.${key}${params ? `${MARKER}${JSON.stringify(params)}` : ""}`;
    },
  };
}
