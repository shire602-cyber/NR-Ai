import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { PAGE_SIZES, type PageView } from "@/lib/list-paging";
import { messages } from "./ListPager.i18n";

interface Props {
  view: PageView;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  /** When the server caps the list, say so instead of letting the end look like the end. */
  cap?: number;
  testId?: string;
}

/** Previous / next, a range and a page size for a list that is loaded in full. */
export function ListPager({ view, pageSize, onPage, onPageSize, cap, testId = "list-pager" }: Props) {
  const tr = messages.useT();
  const rtl = useI18n((s) => s.locale) === "ar";
  const Prev = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm" data-testid={testId}>
      <div className="space-y-0.5">
        <p className="text-muted-foreground" data-testid={`${testId}-range`}>
          {tr("range", { from: view.from, to: view.to, total: view.total })}
        </p>
        {cap !== undefined && view.total >= cap && <p className="text-xs text-[hsl(var(--chart-4))]">{tr("capped", { cap })}</p>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-muted-foreground">{tr("perPage")}</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger className="w-20 h-8" aria-label={tr("perPage")} data-testid={`${testId}-size`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => onPage(view.page - 1)} disabled={!view.hasPrev} data-testid={`${testId}-prev`}>
          <Prev className="h-4 w-4 me-1" />
          {tr("previous")}
        </Button>
        <span className="text-muted-foreground">{tr("pageOf", { page: view.page + 1, pages: view.pageCount })}</span>
        <Button variant="outline" size="sm" onClick={() => onPage(view.page + 1)} disabled={!view.hasNext} data-testid={`${testId}-next`}>
          {tr("next")}
          <Next className="h-4 w-4 ms-1" />
        </Button>
      </div>
    </div>
  );
}
