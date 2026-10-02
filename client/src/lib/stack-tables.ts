// Tables marked `stack-table` render as stacked cards below 768 px (see index.css): every row becomes a card and
// each cell shows its column heading as a label. The labels are copied from the header cells into `data-label`
// attributes here, so the page components only add the class. Runs once; a MutationObserver keeps rows that
// React renders later (data loading, filters) labelled.

function labelTable(table: HTMLTableElement): void {
  const headings = Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
  if (headings.length === 0) return;
  for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
    Array.from(row.children).forEach((cell, index) => {
      const label = headings[index] ?? "";
      if (cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
    });
  }
}

function labelAll(): void {
  document.querySelectorAll<HTMLTableElement>(".stack-table table").forEach(labelTable);
}

export function initStackTables(): void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      labelAll();
    });
  };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
}
