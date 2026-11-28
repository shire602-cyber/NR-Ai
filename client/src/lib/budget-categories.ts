// Budget line categories are app-defined names ("Salaries & Wages", "Technology"). The stored value
// stays the English name; screens and exports show the catalog label `forms.budget.cat.<name>` in
// the reader's language (Step 1 / S5). A category the catalog does not know (typed by a user or
// imported) is shown as stored.

type Catalog = Record<string, string | undefined>;

export function budgetCategoryLabel(catalog: Catalog, category: string | null | undefined): string {
  if (!category) return "";
  return catalog[`forms.budget.cat.${category}`] ?? category;
}
