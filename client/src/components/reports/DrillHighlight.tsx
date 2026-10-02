import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { parseHighlight } from "@/lib/report-drill";
import { messages as pageMessages } from "./DrillHighlight.i18n";

const POLL_MS = 300;
const GIVE_UP_MS = 8000;
const FLASH_MS = 5000;
const FLASH_CLASSES = [
  "ring-2",
  "ring-accent",
  "ring-offset-2",
  "bg-accent/10",
  "transition-shadow",
];

/**
 * The row element for a record. Anything that carries the id marks the record; the row is the nearest table row or list
 * item around it, else the cell that shows the record's number (so a button inside a grid row marks the number, not the
 * button).
 */
function findRecordElement(id: string, label: string | null): HTMLElement | null {
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>("[data-testid], [data-id], [id]")
  )) {
    const hay = `${el.getAttribute("data-testid") ?? ""} ${el.getAttribute("data-id") ?? ""} ${el.id}`;
    if (!hay.includes(id)) continue;
    const row = el.closest<HTMLElement>("tr, li, [role='row'], [data-slot='card']");
    if (row) return row;
    if (label) {
      // Rows laid out as a grid have no row box: mark the cell that shows the record's number.
      const cell = Array.from(
        document.querySelectorAll<HTMLElement>("td, div, span, a, p, h2, h3")
      ).find(
        (c) =>
          c.offsetHeight > 0 &&
          c.children.length <= 1 &&
          c.textContent?.replace(/\s+/g, " ").trim() === label
      );
      if (cell) return cell;
    }
    return el;
  }
  return null;
}

/**
 * Report drill links open a module's list page with `?highlight=<record id>&label=<number>` (no list page takes an id
 * of its own). Once the list has rendered, scroll to that record and mark it; if it is not on the page (another page of
 * results, or a list that does not show it), say which record to look for.
 */
export function DrillHighlight() {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const search = useSearch();
  const [location] = useLocation();

  useEffect(() => {
    const { id, label } = parseHighlight(search);
    if (!id && !label) return;

    let flashed: HTMLElement | null = null;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const finish = () => {
      // The query has done its job: keep the address clean so a reload does not replay it.
      const clean = new URLSearchParams(window.location.search);
      clean.delete("highlight");
      clean.delete("label");
      const q = clean.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${q ? `?${q}` : ""}`
      );
    };

    const poll = setInterval(() => {
      const el = id ? findRecordElement(id, label) : null;
      if (el) {
        clearInterval(poll);
        flashed = el;
        el.classList.add(...FLASH_CLASSES);
        el.scrollIntoView?.({ block: "center", behavior: "smooth" });
        flashTimer = setTimeout(() => {
          el.classList.remove(...FLASH_CLASSES);
          finish();
        }, FLASH_MS);
      } else if (Date.now() - started > GIVE_UP_MS) {
        clearInterval(poll);
        toast({
          title: tr("lookFor"),
          description: label ? tr("lookForNamed", { label }) : tr("lookForUnnamed"),
        });
        finish();
      }
    }, POLL_MS);

    return () => {
      clearInterval(poll);
      if (flashTimer) clearTimeout(flashTimer);
      flashed?.classList.remove(...FLASH_CLASSES);
    };
    // Re-run when the page or its query changes, not when the toast function does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, location]);

  return null;
}
