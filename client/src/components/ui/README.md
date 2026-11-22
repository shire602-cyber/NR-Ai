# Muhasib design system (WP-A, Fable spec section 2)

One system for every authenticated screen and the public site. Tokens live in
`client/src/index.css` (`:root` = light, `.dark` = dark) and are exposed to
Tailwind in `tailwind.config.ts`. Components use **role** tokens; raw palette
steps are for the rare case a role does not fit. **Only WP-A edits** `index.css`,
`tailwind.config.ts`, `components/ui/**` and `components/layout/**`; ask WP-A for
a primitive change instead of forking a local copy.

The API below is the contract. It only grows (additive props); names and
existing props stay stable.

## Tokens

| Layer    | Variables                                                                                                                                                                                       | Tailwind                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Brand    | `--brand-50` … `--brand-950` (Muhasib emerald)                                                                                                                                                  | `bg-brand-50`, `text-brand-700`                                                                                     |
| Neutral  | `--neutral-0`, `-25`, `-50` … `-950` (cool slate)                                                                                                                                               | `bg-neutral-100`, `border-neutral-200`                                                                              |
| Semantic | `--success`, `--warning`, `--danger`, `--info` (+ `-foreground`, `-subtle`, `-subtle-foreground`)                                                                                               | `bg-success-subtle text-success-subtle-foreground`, `text-danger`                                                   |
| Money    | `--positive`, `--negative`                                                                                                                                                                      | `text-positive`, `text-negative`                                                                                    |
| Roles    | `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--border-strong`, `--input`, `--ring`, `--surface-sunken`, `--sidebar-*` | `bg-card`, `text-muted-foreground`, `border-border-strong`, `bg-surface-sunken`                                     |
| Inverse  | `--surface-inverse`, `--surface-inverse-foreground`, `--surface-inverse-muted`, `--surface-inverse-border` (auth panel, featured pricing card, marketing dark bands)                            | `bg-surface-inverse text-surface-inverse-foreground`, `text-surface-inverse-muted`, `border-surface-inverse-border` |
| Charts   | `--chart-1` brand · `--chart-2` slate · `--chart-3` ochre · `--chart-4` plum · `--chart-5` teal · `--chart-neutral` · `--chart-grid` · `--chart-axis`                                           | `bg-chart-1`, `text-chart-axis` — in code use `chartTheme` (below)                                                  |
| Disabled | `--disabled-surface`, `--disabled-foreground` (solid buttons are neutral when disabled, never pale green)                                                                                       | applied by `Button`                                                                                                 |

Colours are `H S% L%` triplets, so alpha works everywhere: `bg-primary/10`.
`--accent` is brand text/fill (eyebrows, links, icons); it is **not** a hover
background — menus highlight with `bg-secondary`.

Colour rules (spec 2.3): emerald = action and brand only (primary button, active
nav marker, links, focus ring, money in). **No pastel filled tiles** — status is a
6 px dot or a pill. No blue buttons. No `bg-blue-*` / `bg-amber-*` / `bg-green-*`
/ `bg-red-*` / `text-blue-*` utilities in pages (grep gate). Overdue rows: no row
fill, a 2 px inline-start bar in `--danger` plus a pill.

### Type scale (spec 2.1)

| Class             | Size / line (mobile)        | Use                                           |
| ----------------- | --------------------------- | --------------------------------------------- |
| `text-display-xl` | 56 / 60 (36 / 40), -0.032em | Marketing hero H1 only                        |
| `text-display`    | 40 / 46 (30 / 36), -0.028em | Marketing H2, pricing H1, auth panel headline |
| `text-lead`       | 18 / 28                     | Marketing sub-headline, onboarding intro      |
| `text-h1`         | 24 / 32, 600                | App page title (PageHeader)                   |
| `text-h2`         | 18 / 26, 600                | Section title outside cards                   |
| `text-h3`         | 15 / 22, 600                | Card title                                    |
| `text-kpi`        | 28 / 32 (22 / 28), 600      | KPI figure (StatCard)                         |
| `text-body`       | 14 / 22                     | Body                                          |
| `text-small`      | 13 / 20                     | Table cells, help text                        |
| `text-caption`    | 12 / 16, 0.01em, 500        | Table headers, tile labels                    |

Sentence case everywhere. `.eyebrow` (12 px, 0.08em, uppercase; add
`text-accent`) is the only uppercase text and is normal case in Arabic. Headings
`text-wrap: balance`. Arabic body is 15 / 26. Minimum rendered size 12 px. Money
only through `Money`; dates only through `formatDate`; digits are tabular.

### Spacing, widths, radii, elevation, motion

- 4 px base; steps 4, 8, 12, 16, 20, 24, 32, 48, 64, 96.
- App page (`.page-container`, applied by the shell): gutter 32 / 16, max
  `max-w-content` 1280. Header → content 24 (`space-y-6`), sections 32, card grid
  gap 16, card padding 20 (forms 24).
- Widths: `max-w-narrow` 760 (forms, settings), `max-w-reading` 680,
  `max-w-marketing` 1120 (marketing container).
- Tables: row 44 (compact 36 for ledgers), cell padding-inline 16, header 36.
- Dialogs: 480 simple / 640 form / 880 two-pane; anything with line items is an
  `EditorShell` page, not a dialog.
- Radii: `--radius` 8 → `rounded-sm` 4 · `md` 6 · `lg` 8 · `xl` 12 · `2xl` 16.
- Elevation: `shadow-xs` controls, `shadow-card-soft` cards, `shadow-lg` popovers,
  `shadow-xl` dialogs. Only interactive cards lift (`Card interactive`).
- Motion: `duration-fast` 120 / `base` 180 / `slow` 240, `ease-out` enter,
  `ease-standard` exit; page content `.page-enter` (fade + 4 px, once per
  route); skeleton shimmer 1.2 s; no KPI count-up; `prefers-reduced-motion`
  turns everything off.
- `--mobile-nav-height`: height of the fixed bottom nav below 768 px (0 above);
  use it for `fixed` elements. Sticky footers inside the app's scroll area use
  `bottom-0` (the scroll area already pads for the bottom nav).

### Brand motif

`.bg-ledger-ruling` — 1 px hairlines on an 8 px pitch with one vertical margin
rule in brand-200, radially faded (spec 2.6). Add `.on-inverse` on inverse
surfaces (6% white). Used behind the landing hero mock, on the auth inverse
panel, in `EmptyState size="lg"`. No other decorative backgrounds.

## Primitive contract

Import from `@/components/ui/<file>` (layout pieces from `@/components/layout/<file>`).

### `StatCard` — `stat-card.tsx` (the only KPI tile)

```tsx
<StatCard
  label={t["x.revenue"]} // ReactNode, text-caption muted
  value={<Money amount={83388} />} // ReactNode, text-kpi
  delta={{ label: "+12.4%", direction: "up", tone: "positive", context: t["x.vsLastMonth"] }}
  hint={t["x.invoicesCount"]} // one line, text-small muted
  sparkline={[12, 18, 15, 22]} // number[]; <2 points = nothing
  sparklineTone="brand" // "brand" | "neutral"
  href="/invoices" // optional: whole tile is a link
  loading={isLoading}
  testId="kpi-revenue"
/>
```

No icon (the legacy `icon` prop is accepted and ignored), no coloured numbers,
borders or fills. In a row either every tile has a sparkline or none does. Delta
tone is by meaning (expenses up = `negative`). Legacy `visual` /
`visualOverlay` still render a custom visual. Also exported: `Sparkline`
(`values`, `tone`, `className`).

### `EmptyState` — `empty-state.tsx` (three sizes, nothing else)

```tsx
<EmptyState size="sm" title={t["x.noRunsYet"]} action={{ label: t["x.runPayroll"], href: "/payroll?new=1" }} />
<EmptyState size="md" icon={FileText} title={t["x.noInvoices"]} description={t["x.invoicesAppearHere"]}
  action={{ label: t["x.newInvoice"], onClick: create, testId: "button-new" }}
  secondaryAction={{ label: t["x.importExcel"], href: "/import" }} />
<EmptyState size="lg" icon={Landmark} title={t["banking.statementUpload.title"]} description={t["banking.feeds.unavailableBody"]}
  action={{ ... }} secondaryAction={{ ... }} previewColumns={4} /* or preview={<MyGhost/>} */ />
```

- `sm`: one muted 13 px sentence (`title` + optional `description`) + one text
  link (`action`). Start-aligned. For a card or tab inside a fuller page.
- `md` (default): 40 px neutral icon tile, 15 / 600 title, one sentence ≤ 60
  chars, primary + optional ghost link. Do not render the table header above it.
- `lg`: ledger-ruling backdrop, `text-h2` title, two sentences, primary +
  outline, then a ghost preview (3 skeleton rows at 40%; `previewColumns={0}` or
  `preview={null}` hides it).

`EmptyStateAction`: `{ label, onClick?, href?, icon?, variant?, testId? }`.
`compact` is deprecated (kept for old call sites). Empty pages show no KPI tiles
and no empty charts.

### `SetupNotice` — `setup-notice.tsx`

```tsx
<SetupNotice
  title={t["x.notAvailableYet"]}
  action={{ label: t["x.downloadInstead"], href: "/reports" }}
>
  {t["x.remindersPreparedNotEmailed"]}
</SetupNotice>
```

Props: `children` (one customer sentence), `title?`, `action?: { label, href? | onClick?, testId? }`,
`icon?` (default `Info`), `className?`, `testId?` (default `setup-notice`).
Replaces every operator message: never env var names, infrastructure vendors
(Resend, SMTP, VAPID, …), "this server/deployment/platform" or a model id.

### `Alert` — `alert.tsx` (tones)

```tsx
<Alert
  tone="warning"
  title={t["x.periodLocked"]}
  action={
    <Button size="sm" variant="outline">
      …
    </Button>
  }
>
  {t["x.oneSentence"]}
</Alert>
```

`tone: "info" | "success" | "warning" | "danger" | "neutral"` → `*-subtle`
background, 1 px tone border at 25%, tone icon, foreground text. The icon is
automatic (`icon={Other}` swaps, `icon={false}` hides; do not add an svg child).
`title?`, `action?`. `role` is `status` for info/success/neutral, `alert` for
warning/danger. Legacy `variant` + `AlertTitle` / `AlertDescription` still work;
new code uses `tone`. Replaces beige/peach blocks and solid red pills.

### `PageHeader` — `page-header.tsx`

```tsx
<PageHeader
  backHref="/invoices" backLabel={t["x.allInvoices"]}
  eyebrow="Sales"                         // known English section names are translated
  title={t["x.invoices"]}
  description={t["x.oneLine"]}            // ≤ 80 chars
  primaryAction={<Button onClick={create} data-testid="button-new">{t["x.new"]}</Button>}
  secondaryActions={<Button variant="outline">{t["x.export"]}</Button>}   // max 2
  overflow={<><DropdownMenuItem onSelect={…}>{t["x.import"]}</DropdownMenuItem></>}
  overflowLabel={t["x.moreActions"]} overflowTestId="header-more"
/>
```

Order at the inline end: `actions` (legacy) → secondaries → ⋯ → primary. One
primary per header. `icon` is deprecated and not rendered (no icon tiles, G5).
`testId` defaults to `text-page-title` on the `<h1>`.

### `ScrollTabs` — `scroll-tabs.tsx`

Drop-in for `TabsList` inside `<Tabs>`; children are `TabsTrigger`s.

```tsx
<Tabs value={tab} onValueChange={setTab}>
  <ScrollTabs
    aria-label={t["x.sections"]}
    variant="pill"
    /* | "line" */ fullWidth={isMobile}
    maxVisible={5}
    value={tab}
    onValueChange={setTab}
    moreLabel={t["x.more"]}
  >
    <TabsTrigger value="open" data-testid="tab-open">
      …
    </TabsTrigger>
  </ScrollTabs>
</Tabs>
```

Scrolls sideways with a 24 px fade on the hidden edge, scroll-snap, active tab
kept in view; never clips a label. With `maxVisible`, extra triggers go into a
"More" menu (pass `value` / `onValueChange`). `TabsList` itself now has the
same fade + active-into-view. Hooks `useEdgeFade(ref, size?)` and
`useActiveIntoView(ref)` (`use-scroll-fade.ts`) serve other horizontal strips (chip rows).

### `DatePicker` — `date-picker.tsx`

```tsx
<DatePicker
  id="due"
  value={due}
  onChange={setDue}
  min={issueDate}
  max="2026-12-31"
  placeholder={t["x.pickDueDate"]}
  invalid={!!errors.due}
  aria-describedby="due-error"
  data-testid="input-due-date"
/>
```

Value in/out is a `YYYY-MM-DD` string (same as a native date input), shown via
`formatDate` ("17 Nov 2026" / "17 نوفمبر 2026"). Replaces every
`<input type="date">` (G1). For react-hook-form use `<Controller>` with
`value={field.value} onChange={field.onChange}`.

### `FileDrop` — `file-drop.tsx`

```tsx
<FileDrop
  accept=".csv,.xlsx"
  onFiles={([f]) => setFile(f)}
  value={file?.name}
  onClear={() => setFile(null)}
  label={t["x.dropStatement"]}
  hint={t["x.csvXlsx10mb"]}
  id="statement-file"
  inputTestId="input-file-upload"
/>
```

Replaces the native "Choose File · No file chosen" (G2). Dashed hairline row +
"Choose file" button + drag-and-drop. The real `<input type="file">` stays in
the DOM (visually hidden) carrying `inputTestId`, so `setInputFiles` and
`<Label htmlFor={id}>` keep working. `multiple`, `disabled`, `name`, `testId`.

### `RankedBars` — `ranked-bars.tsx` (no donuts for money)

```tsx
<RankedBars
  items={rows.map((r) => ({ id: r.id, label: r.name, value: r.amount, href: `/x/${r.id}` }))}
  limit={5}
  currency="AED"
  otherLabel={t["x.other"]}
  emptyLabel={t["x.noExpensesYet"]}
  aria-label={t["x.expenseBreakdown"]}
/>
```

Label, 6 px bar in `--chart-1` at 100/70/50/35/25%, amount end-aligned
(`Money` unless `display` is given); top `limit` + "Other" (neutral). Empty →
`EmptyState size="sm"`.

### `chartTheme` — `chart-theme.ts` (tooltip component in `chart-tooltip.tsx`, re-exported)

```tsx
import { chartTheme, ChartTooltipContent, formatAxisCompact } from "@/components/ui/chart-theme";
<AreaChart data={d}>
  <CartesianGrid {...chartTheme.grid} />
  <XAxis dataKey="month" {...chartTheme.xAxis} />
  <YAxis {...chartTheme.yAxis} tickFormatter={formatAxisCompact} />
  <Tooltip {...chartTheme.tooltip} content={<ChartTooltipContent currency="AED" seriesLabel={k => t[`x.${k}`]} />} />
  <Area dataKey="income" {...chartTheme.area("brand")} isAnimationActive={chartTheme.animate()} />
  <Line dataKey="expenses" {...chartTheme.comparisonLine} />
</AreaChart>
<BarChart data={d} {...chartTheme.barChart}><Bar dataKey="in" {...chartTheme.bar("brand")} /><Bar dataKey="out" {...chartTheme.bar("neutral")} /></BarChart>
```

Exports: `chartTheme` (`colors`, `series`, `grid`, `xAxis`, `yAxis`, `tooltip`,
`line(tone)`, `area(tone)`, `comparisonLine`, `bar(tone)`, `barChart`,
`animate()`), `chartColors`, `chartSeries`, `chartTooltipStyle`,
`formatAxisCompact` (75000 → "75k"), `ChartTooltipContent` (`currency?`,
`seriesLabel?`, `labelFormatter?`, `valueFormatter?`). Tones: `brand`,
`neutral`, `slate`, `ochre`, `plum`, `teal`, `negative`. Money in = brand,
money out = neutral; red only for a negative net. Legend only with ≥ 3 series.
Fewer than 2 points → `EmptyState size="sm"`, not an empty axis.
`pages/dashboard/chart-colors.ts` re-exports these for old imports.

### `EditorShell` — `editor-shell.tsx`

```tsx
<EditorShell
  backHref="/invoices" eyebrow="Sales" title={t["x.newInvoice"]}
  status={<StatusBadge status="draft" />} headerActions={<Button variant="ghost">…</Button>}
  preview={<InvoicePreview … />} previewLabel={t["x.livePreview"]}
  footerSummary={<>{t["x.total"]} <Money amount={total} /></>}
  footer={<><Button variant="ghost">{t["x.cancel"]}</Button><Button variant="outline">{t["x.saveDraft"]}</Button><Button>{t["x.saveAndSend"]}</Button></>}
>
  <SectionCard title={t["x.customer"]}>…</SectionCard>
  <SectionCard title={t["x.lines"]} flush>…</SectionCard>
</EditorShell>
```

Full-page form (rendered inside the app's `.page-container`), sticky live
preview at the inline end from 1024 px (collapsible "Preview" below), sticky
footer above the mobile bottom nav. Without `preview` the form column is
`max-w-narrow` (760). `testId` defaults to `editor-shell`.

### `RowActions` — `row-actions.tsx` (one inline + menu)

```tsx
<RowActions maxInline={1} menuTestId={`row-menu-${id}`}
  menu={<><DropdownMenuItem onSelect={…}>{t["x.duplicate"]}</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onSelect={…}>{t["x.delete"]}</DropdownMenuItem></>}>
  <RowActionButton label={t["x.edit"]} icon={Pencil} onClick={…} data-testid={`button-edit-${id}`} />
  <RowActionButton label={t["x.download"]} icon={Download} onClick={…} data-testid={`button-dl-${id}`} />
</RowActions>
```

`maxInline={1}` keeps the first `RowActionButton` visible and moves the rest
into the top of the ⋯ menu (their `data-testid` moves with them). Without it
every child stays inline (legacy). `collapseOnMobile` moves even the inline one
into the menu below 768 px. Destructive items live in the menu.

### `SettingsLayout` — `components/layout/SettingsLayout.tsx`

```tsx
<SettingsLayout hide={hasFirm ? [] : ["firm"]}>
  <PageHeader eyebrow="Settings" title={t["x.security"]} … />
  …SectionCards…
</SettingsLayout>
```

Left sub-nav (200 px, sticky) + content column `max-w-narrow` (760); below
1024 px the sub-nav is a horizontal scrolling link strip. Sections
(`SETTINGS_NAV`, existing routes): Company `/settings/company`, Team `/team`,
Security `/settings/security`, Documents `/invoice-templates`, Notifications
`/notification-preferences`, Integrations `/integrations-hub`, Billing
`/subscription`, Data `/import` (+ `/backup-restore`, `/document-vault`),
Developer `/developer-settings`, My accounting firm `/firm-relationship`.
Props: `hide?: string[]`, `items?: SettingsNavItem[]`. `SETTINGS_ROUTES` lists
every route inside the area (both in `components/layout/settings-nav.ts`, with `isSettingsNavActive`).

## Other components

Primitives (shadcn/Radix, restyled): `button` (disabled solid = neutral),
`input`, `textarea`, `select`, `checkbox`, `switch`, `label`, `form`, `card`,
`badge`, `status-badge` (tone pill + 6 px dot), `table`, `tabs`, `dialog`,
`alert-dialog`, `sheet`, `popover`, `dropdown-menu`, `command`, `tooltip`,
`toast`/`toaster`, `skeleton`, `loading-skeletons`, `sidebar`, `progress`,
`avatar`, `calendar`.

| Component           | File               | Use it for                                                                     |
| ------------------- | ------------------ | ------------------------------------------------------------------------------ |
| `SectionCard`       | `section-card.tsx` | A titled surface for one topic; `flush` for edge-to-edge tables.               |
| `Money`/`MoneyCell` | `money.tsx`        | Every amount. `MoneyCell` end-aligns in tables; `tone="auto"` tints negatives. |
| `DataTableCard`     | `data-table.tsx`   | Frame for list tables: toolbar, loading/empty/error/ready states, footer.      |
| `ErrorState`        | `error-state.tsx`  | Data failed to load: calm message + Retry.                                     |
| `ThemeToggle`       | `theme-toggle.tsx` | Light / dark / system switch.                                                  |

### Rules

- Tables: `<TableHead>`/`<TableCell>` start-aligned; amounts use `MoneyCell` or
  `data-numeric` (end-aligned, tabular). Header row is sticky.
- Forms: `Label` above control, help text `text-small text-muted-foreground`,
  errors via `FormMessage`, required marker `*` after the label. Dates
  `DatePicker`, selects `Select`, files `FileDrop` — never native controls.
- RTL: logical utilities only (`ms-`, `pe-`, `start-`, `text-start`); arrows
  that imply direction get `rtl:rotate-180`; numbers stay LTR via `.money`.
- Header: one primary button, at most two secondaries, the rest in ⋯.
- Tabs: at most 5 visible (`ScrollTabs maxVisible`), one level deep.
- Copy goes in `client/src/locales/{en,ar}/*.json` (real Arabic).
