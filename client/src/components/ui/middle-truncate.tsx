import { cn } from "@/lib/utils";

/**
 * Document numbers (`BILL-20261116152435-003`) are identified by their ends: when the space
 * runs out the middle is elided ("BILL-2026…2435-003"), never the tail, and never in the
 * reading direction of the surrounding text (R2 item 22). The full value stays in `title`.
 */
export function MiddleTruncate({
  text,
  tail = 7,
  className,
}: {
  text: string;
  tail?: number;
  className?: string;
}) {
  const cut = text.length > tail + 4 ? text.length - tail : 0;
  const head = cut ? text.slice(0, cut) : text;
  const end = cut ? text.slice(cut) : "";
  return (
    <span
      dir="ltr"
      title={text}
      className={cn("inline-flex max-w-full min-w-0 [unicode-bidi:isolate]", className)}
    >
      <span className="min-w-0 truncate">{head}</span>
      {end && <span className="shrink-0">{end}</span>}
    </span>
  );
}
