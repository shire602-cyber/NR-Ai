# Muhasib design system (D2)

One system for every authenticated screen and the public site. Tokens live in
`client/src/index.css` (`:root` = light, `.dark` = dark) and are exposed to
Tailwind in `tailwind.config.ts`. Components use **role** tokens; raw palette
steps are for the rare case a role does not fit.

## Tokens

| Layer    | Variables                                                                                                                                                                                                      | Tailwind                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Brand    | `--brand-50` … `--brand-950` (Muhasib emerald)                                                                                                                                                                 | `bg-brand-50`, `text-brand-700`                                                 |
| Neutral  | `--neutral-0`, `-25`, `-50` … `-950` (cool slate)                                                                                                                                                              | `bg-neutral-100`, `border-neutral-200`                                          |
| Semantic | `--success`, `--warning`, `--danger`, `--info` (+ `-foreground`, `-subtle`, `-subtle-foreground`)                                                                                                              | `bg-success-subtle text-success-subtle-foreground`, `text-danger`               |
| Money    | `--positive`, `--negative`                                                                                                                                                                                     | `text-positive`, `text-negative`                                                |
| Roles    | `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--border-strong`, `--input`, `--ring`, `--surface-sunken`, `--sidebar-*`, `--chart-1…5` | `bg-card`, `text-muted-foreground`, `border-border-strong`, `bg-surface-sunken` |

Colours are `H S% L%` triplets, so alpha works everywhere: `bg-primary/10`.
`--accent` is brand text/fill (eyebrows, links, icons); it is **not** a hover
background — menus highlight with `bg-secondary`.

Other tokens:

- **Type**: `--font-sans` (Geist Sans), `--font-arabic` (Noto Sans Arabic, loaded
  on first RTL render), `--font-display` (= Geist, set semibold/tight),
  `--font-mono` (Geist Mono — code, IDs; not money). Scale: `text-display`
  36 · `text-h1` 28 · `text-h2` 20 · `text-h3` 16 · `text-h4` 14 · `text-body`
  14 · `text-small` 13 · `text-caption` 12. All digits are tabular app-wide.
- **Spacing**: Tailwind's 4px scale. Page gutter 16px mobile / 32px desktop
  (`.page-container`), card padding 20/24px, section gap 24/32px.
- **Radii**: `--radius` 8px → `rounded-sm` 4 · `md` 6 · `lg` 8 · `xl` 12 · `2xl` 16.
  Inputs/buttons `md`, cards `xl`, popovers `lg`, dialogs `xl`, pills `full`.
- **Elevation**: `shadow-xs` (controls), `shadow-card-soft` (cards, hairline
  border carries the edge), `shadow-lg` (popovers), `shadow-xl` (dialogs).
  Dark mode relies on borders, not shadows.
- **Motion**: `duration-fast` 120ms, `duration-base` 180ms, `duration-slow`
  240ms, `ease-standard`, `ease-out`. `prefers-reduced-motion` disables CSS
  motion globally.
- **Theme**: light by default; dark is opt-in from the top-bar `ThemeToggle`
  (`client/src/lib/theme.ts`, key `muhasib-theme`, applied before paint by
  `client/public/theme-init.js`).

Utility classes (`index.css`, components layer): `.money` (tabular, nowrap, LTR
digits inside Arabic), `.eyebrow` (section label; normal case in Arabic),
`.page-container`, `.divide-hairline`, `.kbd`.

## Components

Primitives (shadcn/Radix, restyled): `button`, `input`, `textarea`, `select`,
`checkbox`, `switch`, `label`, `form`, `card`, `badge` (+ `StatusBadge` for
document statuses), `status-badge` (tone-based), `table`, `tabs`, `dialog`,
`alert-dialog`, `sheet`, `popover`, `dropdown-menu`, `command`, `tooltip`,
`toast`/`toaster`, `skeleton`, `loading-skeletons`, `sidebar`, `alert`,
`toggle`, `progress`, `accordion`, `avatar`, `calendar`, `breadcrumb`.

Shared patterns:

| Component           | File               | Use it for                                                                                |
| ------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `PageHeader`        | `page-header.tsx`  | Top of every screen: back link, eyebrow, title, description, actions (one primary).       |
| `SectionCard`       | `section-card.tsx` | A titled surface for one topic; `flush` for edge-to-edge tables; optional footer.         |
| `StatCard`          | `stat-card.tsx`    | KPI tile: label, figure, delta pill (direction + good/bad tone), hint, sparkline, `href`. |
| `Money`/`MoneyCell` | `money.tsx`        | Every amount. `MoneyCell` end-aligns in tables; `tone="auto"` tints negatives.            |
| `DataTableCard`     | `data-table.tsx`   | Frame for list tables: toolbar, loading/empty/error/ready states, footer.                 |
| `EmptyState`        | `empty-state.tsx`  | No data yet: icon, title, one-line reason, 0–2 actions.                                   |
| `ErrorState`        | `error-state.tsx`  | Data failed to load: calm message + Retry.                                                |
| `ThemeToggle`       | `theme-toggle.tsx` | Light / dark / system switch (top bar).                                                   |

### Rules

- Tables: `<TableHead>`/`<TableCell>` start-aligned; amounts use `MoneyCell` or
  `data-numeric` (end-aligned, tabular). Header row is sticky.
- Forms: `Label` above control, help text `text-small text-muted-foreground`,
  errors via `FormMessage` (`aria-invalid` turns the border red), required
  marker `*` after the label.
- RTL: logical utilities only (`ms-`, `pe-`, `start-`, `text-start`); arrows
  that imply direction get `rtl:rotate-180` (or `rtl:-scale-x-100` for
  diagonals); numbers stay LTR via `.money`.
- One primary button per view; secondaries are `outline` or `ghost`.
- Copy goes in `client/src/locales/{en,ar}/*.json`.
