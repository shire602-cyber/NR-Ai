import { useTranslation } from "@/lib/i18n";

/**
 * Inline translated text for JSX text nodes: `<T k="pages.cancel" />`.
 *
 * Reads the active locale from the i18n store, so it stays correct in
 * components that have no `useTranslation()` hook of their own (render-prop
 * helpers, module-level sub-components). The key must exist in
 * client/src/locales/en/*.json; tests/unit/i18n-catalog.test.ts enforces that
 * every `k=` and `t["..."]` key used in source has both an en and an ar value.
 */
export function T({ k }: { k: string }) {
  const { t } = useTranslation();
  return <>{t[k] ?? k}</>;
}
