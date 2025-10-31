# Design Guidelines: AI Bookkeeping Platform for UAE Businesses

## Design Approach

**Selected Approach**: Design System Hybrid
Drawing inspiration from Linear's minimalist precision, Notion's content organization, and Stripe Dashboard's professional data presentation. This creates a clean, efficient interface optimized for financial workflows while maintaining UAE market professionalism.

**Core Principles**:
- Information clarity over visual flair
- Consistent patterns for efficient workflows
- Bilingual-first (English/Arabic with RTL support)
- Professional credibility with modern refinement

---

## Typography System

**Font Family**: 
- Primary: Inter (via Google Fonts CDN) - exceptional readability for financial data
- Monospace: JetBrains Mono - for account codes, numbers, currency values

**Hierarchy**:
- **Display (Hero/Landing)**: text-4xl to text-6xl, font-bold (56-72px)
- **H1 (Page Titles)**: text-3xl, font-semibold (36px)
- **H2 (Section Headers)**: text-2xl, font-semibold (24px)
- **H3 (Card/Component Headers)**: text-lg, font-medium (18px)
- **Body**: text-base, font-normal (16px)
- **Small (Labels/Meta)**: text-sm, font-medium (14px)
- **Tiny (Captions)**: text-xs, font-normal (12px)
- **Financial Data**: text-base to text-lg, font-mono, font-medium

**Numerical Formatting**: 
- Always right-align currency values
- Use tabular numbers (font-variant-numeric: tabular-nums)
- Consistent decimal places (2 for AED)

---

## Layout System

**Spacing Primitives**: Use Tailwind units of **2, 4, 6, 8, 12, 16, 20** exclusively
- Component padding: p-4, p-6, p-8
- Section spacing: gap-6, gap-8, space-y-8
- Card margins: m-4, m-6
- Tight groupings: gap-2, gap-4

**Container Strategy**:
- **Dashboard Layout**: Full-width with sidebar (w-64 sidebar, remaining flex-1 main)
- **Content Max-Width**: max-w-7xl for main content areas
- **Form Containers**: max-w-2xl for focused input flows
- **Data Tables**: Full-width with horizontal scroll on mobile

**Grid Patterns**:
- **Dashboard Cards**: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- **Stat Metrics**: grid-cols-2 md:grid-cols-4
- **Invoice/Journal Lists**: Single column with full-width rows

---

## Component Library

### Navigation & Shell

**Sidebar Navigation** (Persistent):
- Fixed left sidebar (w-64) with company switcher at top
- Navigation groups: Dashboard, Companies, Accounts, Invoices, Journal, Reports, AI Tools
- Icons from Heroicons (outline style) - 20px size
- Text: text-sm, font-medium
- Spacing: py-2 per item, px-4 horizontal
- Active state: distinct treatment with subtle indicator

**Top Bar**:
- Fixed height (h-16)
- Contains: breadcrumb navigation, language toggle (EN/AR), user menu
- Right-aligned utility items: gap-4 spacing

**Mobile Navigation**:
- Hamburger menu (lg:hidden)
- Slide-out drawer overlay for mobile screens

### Data Display Components

**Table Design** (Financial Data):
- Stripe pattern for row alternation
- Header: text-xs, font-semibold, uppercase, tracking-wide
- Cell padding: px-6, py-4
- Right-align numerical columns
- Sticky header on scroll
- Row hover state for interactivity
- Monospace font for account codes and amounts

**Card Containers**:
- Consistent border treatment (border, rounded-lg)
- Padding: p-6 for standard cards, p-8 for featured
- Shadow: subtle elevation (shadow-sm)
- Header section with title (text-lg, font-semibold) and action buttons
- Body with organized content sections

**Stat/Metric Cards**:
- Compact design: p-4 to p-6
- Large number display: text-3xl, font-bold, font-mono
- Label: text-sm, font-medium
- Optional trend indicator (↑/↓) with percentage
- Grid layout for dashboard overview

**Invoice/Document Cards**:
- List item style with border-b separator
- Left: Invoice number + customer name
- Center: Date + status badge
- Right: Amount (prominent, monospace)
- Height: py-4, hover state for clickability

### Form Components

**Input Fields**:
- Height: h-10 for standard inputs
- Padding: px-4, py-2
- Border: consistent treatment with rounded corners (rounded-md)
- Label spacing: mb-2 below label
- Field spacing: space-y-4 between fields
- Monospace for numeric inputs (amounts, codes)

**Form Layouts**:
- **Single Column** (max-w-2xl): Login, registration, settings
- **Two Column** (grid-cols-2 gap-6): Invoice creation, company setup
- **Dynamic Multi-line** (Invoice/Journal Lines): 
  - Add/remove row functionality
  - Grid layout per row: description (flex-1), quantity (w-24), price (w-32), total (w-32)
  - Running total display: text-xl, font-semibold, monospace

**Buttons**:
- Primary: px-6, py-2.5, rounded-md, font-medium
- Secondary: Similar size, distinct treatment
- Icon Buttons: w-10, h-10, rounded-md
- Destructive actions: Clearly differentiated
- Group spacing: gap-3

**Status Badges**:
- Compact: px-3, py-1, rounded-full, text-xs, font-semibold
- States: Draft, Sent, Paid, Void, Active, Inactive
- Inline with content, minimal visual weight

### Charts & Visualizations

**Chart.js Implementation**:
- **Pie/Doughnut**: Expense breakdown by category
- **Line Chart**: Revenue/expense trends over time
- **Bar Chart**: Monthly VAT comparison
- Container: Aspect ratio 16:9 or 2:1, padding p-6
- Legend: Positioned bottom or right, text-sm
- Responsive canvas sizing

**Empty States**:
- Centered vertically and horizontally
- Icon (from Heroicons, 48px): Document, ChartBar, etc.
- Heading: text-lg, font-semibold
- Description: text-sm
- Call-to-action button
- Spacing: space-y-4

### Specialized Components

**Chart of Accounts Tree**:
- Hierarchical indent pattern (pl-4 per level)
- Account code: font-mono, font-medium
- Account name: font-normal
- Type badge: text-xs, inline
- Expandable/collapsible sections
- Search/filter bar at top

**Journal Entry Builder**:
- Two-panel split: Debit column | Credit column
- Running balance indicator: Prominent, updates live
- Balance validation: Visual feedback when debits ≠ credits
- Account selector: Searchable dropdown with code + name

**AI Categorization Widget**:
- Compact card: p-4, rounded-lg
- Input: Transaction description
- Output: Suggested account with confidence meter (progress bar)
- Confidence: Percentage display (text-sm, font-mono)
- Accept/reject actions: Inline buttons

**Invoice Preview/Generator**:
- Print-ready layout within app
- Header: Company info + customer info (two-column)
- Line items table: Clean, professional
- Totals section: Right-aligned, hierarchical (Subtotal → VAT → Total)
- Footer: Terms, TRN number
- Export button: Prominent, top-right

---

## Page-Specific Layouts

### Landing/Marketing Page

**Hero Section** (if applicable for public landing):
- Height: 60vh to 80vh
- Grid: lg:grid-cols-2 (text left, image/graphic right)
- Headline: text-5xl to text-6xl, font-bold
- Subhead: text-xl, font-normal
- CTA buttons: Large (px-8, py-3.5), gap-4
- No background image for hero - use illustration or dashboard preview image on right

**Features Section**:
- Grid: lg:grid-cols-3, gap-8
- Icon: 32px, positioned top
- Title: text-xl, font-semibold
- Description: text-base
- Padding: py-20

**Trust Section** (UAE-specific):
- VAT compliance badge
- Security certifications
- Customer testimonials: 2-column grid
- Company logos: 4-column grid of UAE businesses

### Dashboard (Main App)

**Overview Layout**:
- Top: Stat cards row (4 metrics: Revenue, Expenses, Profit, Outstanding)
- Middle: Two-column grid (Recent invoices | Expense breakdown chart)
- Bottom: Recent transactions table

**Spacing**: py-8 for main content, gap-8 between sections

### Invoice/Journal List Pages

**Filter Bar**:
- Horizontal layout: Search, date range, status filter, export button
- Height: h-12 inputs
- Spacing: gap-4

**List View**:
- Table or card list (responsive)
- Pagination: Bottom center
- Bulk actions: Checkbox selection with action bar

---

## RTL (Right-to-Left) Support

**Arabic Mode Considerations**:
- Mirror horizontal layouts (sidebar switches to right)
- Text alignment: Natural (right-align for Arabic)
- Icon positions: Mirror (chevrons flip)
- Number alignment: Keep right-aligned for financial data
- Form labels: Positioned appropriately for reading direction

**Implementation**: Use `dir="rtl"` on root element when locale is 'ar'

---

## Responsive Breakpoints

- **Mobile**: < 768px (single column, stacked navigation)
- **Tablet**: 768px - 1024px (2-column grids, sidebar overlay)
- **Desktop**: > 1024px (full layout with persistent sidebar)

**Mobile Optimizations**:
- Tables: Horizontal scroll or card transformation
- Sidebar: Hamburger menu with drawer
- Stat cards: 2-column grid on mobile
- Forms: Full-width single column

---

## Animation & Interactions

**Minimal, Purposeful Motion**:
- Page transitions: None or subtle fade (150ms)
- Dropdown/modal: Scale and fade (200ms)
- Loading states: Skeleton screens (no spinners) for tables
- Hover states: Subtle elevation or opacity change
- **No scroll-based animations**
- **No parallax effects**

---

## Accessibility Standards

- **Color Contrast**: WCAG AA minimum for all text
- **Focus States**: Visible outline (ring-2) on all interactive elements
- **Form Labels**: Explicit association, always visible
- **Error States**: Clear messaging, positioned below field
- **Keyboard Navigation**: Full support, logical tab order
- **ARIA Labels**: Comprehensive for screen readers, especially for financial data tables

---

## Images

**Dashboard Preview Image**: 
- Location: Landing page hero (right side) or Features section
- Description: Modern accounting dashboard screenshot showing clean interface with financial charts and data tables
- Size: Large, prominent, demonstrating the product

**Feature Illustrations** (optional):
- Location: Features section
- Description: Simple line illustrations representing AI categorization, invoicing, reports
- Style: Minimal, professional

**No hero background image** - maintain clean, focused design appropriate for financial software.