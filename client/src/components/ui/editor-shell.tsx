import * as React from "react";
import { ChevronDown, Eye } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface EditorShellProps {
  /** Header: same anatomy as PageHeader (back link, eyebrow, title, one-line description). */
  title: React.ReactNode;
  eyebrow?: string;
  description?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  /** A StatusBadge next to the header actions (e.g. Draft). */
  status?: React.ReactNode;
  /** Secondary header actions (outline / ghost). The primary action lives in the footer. */
  headerActions?: React.ReactNode;
  /** The form. Group fields in SectionCards; line items are a table inside the form. */
  children: React.ReactNode;
  /** Live document preview, sticky beside the form from 1024 px; collapsible below. */
  preview?: React.ReactNode;
  previewLabel?: string;
  /**
   * Below 1024 px the preview is collapsed under a toggle after the form (default). "first"
   * shows it open above the form instead, for a panel the user starts from (WQ2 bill capture).
   */
  mobilePreview?: "collapsed" | "first";
  /** Sticky footer, inline-start side: totals summary (e.g. "Total AED 9,500.00"). */
  footerSummary?: React.ReactNode;
  /** Sticky footer, inline-end side: Cancel / Save draft / primary (primary last). */
  footer: React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * EditorShell (spec 2.2, 3.7) — anything with line items is a full-page editor, not a dialog:
 * header, a form column (max 760 without preview), a sticky live preview at the inline end
 * (desktop) and a sticky action footer that stays above the mobile bottom nav.
 */
export function EditorShell({
  title,
  eyebrow,
  description,
  backHref,
  backLabel,
  status,
  headerActions,
  children,
  preview,
  previewLabel,
  mobilePreview = "collapsed",
  footerSummary,
  footer,
  className,
  testId,
}: EditorShellProps) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const previewId = React.useId();
  return (
    <div
      className={cn(
        "flex min-h-[calc(100dvh-var(--header-height)-var(--page-block-start)-var(--mobile-nav-height))] flex-col",
        className
      )}
      data-testid={testId ?? "editor-shell"}
    >
      {/* Rendered inside the app's .page-container; the footer bleeds to its edges. */}
      {/* Fable P1: an editor without a live preview is one centred 760 px column (header and
          form together), so the right half of a wide screen is never left blank. */}
      <div className={cn("flex-1 space-y-6", !preview && "mx-auto w-full max-w-narrow")}>
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          backHref={backHref}
          backLabel={backLabel}
          actions={
            status || headerActions ? (
              <>
                {status}
                {headerActions}
              </>
            ) : undefined
          }
        />
        <div
          className={cn(
            "grid gap-stack lg:gap-8",
            preview && "lg:grid-cols-[minmax(0,1fr)_minmax(340px,460px)]"
          )}
        >
          <div className="editor-surface min-w-0 space-y-6">{children}</div>
          {preview ? (
            <aside
              className={cn("min-w-0", mobilePreview === "first" && "max-lg:order-first")}
              aria-label={previewLabel ?? t["components.ui.preview"]}
            >
              <button
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border border-border bg-card px-card py-3.5 text-small font-medium text-foreground shadow-card-soft lg:hidden",
                  mobilePreview === "first" && "hidden"
                )}
                aria-expanded={previewOpen}
                aria-controls={previewId}
                onClick={() => setPreviewOpen((v) => !v)}
              >
                <span className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-muted-foreground" aria-hidden />
                  {previewLabel ?? t["components.ui.preview"]}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-fast",
                    previewOpen && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
              <div
                id={previewId}
                className={cn(
                  "mt-4 lg:sticky lg:top-8 lg:mt-0 lg:block",
                  previewOpen || mobilePreview === "first" ? "block" : "hidden"
                )}
              >
                {preview}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
      <div
        className="surface-glass sticky bottom-0 z-20 -mx-gutter -mb-[var(--page-block-end)] mt-10 border-t border-border"
        data-testid="editor-shell-footer"
      >
        <div className="flex w-full flex-wrap items-center justify-between gap-4 px-gutter py-4">
          <div className="min-w-0 text-small text-muted-foreground">{footerSummary}</div>
          <div className="flex flex-wrap items-center justify-end gap-3">{footer}</div>
        </div>
      </div>
    </div>
  );
}
