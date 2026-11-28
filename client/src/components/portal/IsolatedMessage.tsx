import { Fragment } from "react";
import { formatMessage } from "@/lib/i18n";

/**
 * A translated sentence whose `{placeholders}` are wrapped in `<bdi>`, so a Latin company name
 * (or an Arabic one inside English copy) keeps its own direction and never reorders or wraps the
 * punctuation around it ("LLC." on its own line in Arabic).
 */
export function IsolatedMessage({
  template,
  values,
}: {
  template: string | undefined;
  values: Record<string, string | number>;
}) {
  const marker = (key: string) => `\u0000${key}\u0000`;
  const flat = formatMessage(
    template,
    Object.fromEntries(Object.keys(values).map((k) => [k, marker(k)]))
  );
  return (
    <>
      {flat
        .split("\u0000")
        .map((part, i) =>
          i % 2 === 1 ? <bdi key={i}>{values[part]}</bdi> : <Fragment key={i}>{part}</Fragment>
        )}
    </>
  );
}
