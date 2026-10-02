import { CircleHelp } from "lucide-react";
import { Link, useLocation } from "wouter";
import { helpSlugForPath } from "@/lib/help/route-map";
import { messages as pageMessages } from "./HelpLink.i18n";

/** A small link to the help article for the current screen. Renders nothing when no article applies. */
export function HelpLink({ slug }: { slug?: string }) {
  const tr = pageMessages.useT();
  const [location] = useLocation();
  const target = slug ?? helpSlugForPath(location);
  if (!target) return null;
  return (
    <Link
      href={`/help/${target}`}
      aria-label={tr("label")}
      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="link-help"
    >
      <CircleHelp className="h-4 w-4" aria-hidden="true" />
      <span className="max-sm:sr-only">{tr("text")}</span>
    </Link>
  );
}
