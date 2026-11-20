# Accounting Software Navigation Research

Detailed analysis of navigation structures across 6 major accounting platforms, plus UX best practices for B2B SaaS sidebar design.

---

## 1. QuickBooks Online

**Top-Level Items: 10** (consolidated view, as of 2025-2026 redesign)

| # | Item | Sub-Items |
|---|------|-----------|
| 1 | **My Menu** | Custom/pinned shortcuts to frequently used features (user-configurable) |
| 2 | **Transactions** | Import/upload transactions, Categorize transactions, Reconcile accounts, Chart of Accounts, Tags |
| 3 | **Sales & Get Paid** | Create/manage invoices, Customer list, Income tracking, Sales orders |
| 4 | **Expenses** | Pay bills, Vendor management, Mileage tracking, Expense categorization |
| 5 | **Customers & Leads** | Customer management, Marketing tools (Mailchimp integration), Customer insights |
| 6 | **Time** | Time entry, Timesheets, Employee tracking |
| 7 | **Projects** | Project setup, Profitability tracking, Labor costs, Project reports |
| 8 | **Taxes** | Tax settings, Payroll tax management, 1099 contractor filings, Tax compliance |
| 9 | **Reports** | Financial statements, Cash flow reports, Budgets, Cash flow planner, Custom reports |
| 10 | **Accounting** | Chart of Accounts, Account reconciliation, Journal entries |

**UX Patterns:**
- Hover flyout menus reveal sub-items on mouseover
- Collapsible/expandable sections
- Icons on every top-level item
- Two customization pencil icons: one for menu items, one for bookmarks
- Auto-hide sidebar (toggleable pin)
- Global search with custom filters
- **+New button** at top for quick transaction creation (organized by category)
- Bookmark system for frequently accessed pages
- Recently merged "Business View" and "Accountant View" into single consolidated nav

---

## 2. QuickBooks Desktop

**Top-Level Menu Items: 11** (traditional desktop menu bar)

| # | Menu Item | Key Sub-Items |
|---|-----------|---------------|
| 1 | **File** | New Company, Open Company, Open or Restore Company, Open Previous Company, Save Company, Create Copy (Portable Company File), Back Up Company, Utilities (Verify Data, Import Excel Files) |
| 2 | **Edit** | Undo, Cut/Copy/Paste, Preferences, Find, Search |
| 3 | **View** | Open Window List, Navigator, Favorites, Customize Icon Bar, Left/Top icon bar toggle |
| 4 | **Lists** | Chart of Accounts, Item List, Customer & Vendor Profile Lists, Templates, Memorized Transaction List, Add/Edit Multiple List Entries |
| 5 | **Company** | Home Page, Company Snapshot, Make General Journal Entries, Enter Vehicle Mileage, Prepare Letters with Envelopes, Planning & Budgeting |
| 6 | **Customers** | Customer Center, Create Estimates, Create Invoices, Create Sales Receipts, Enter Statement Charges, Receive Payments, Create Credit Memos/Refunds |
| 7 | **Vendors** | Vendor Center, Enter Bills, Pay Bills, Create Purchase Orders, Manage Sales Tax, Print 1099s/1096s |
| 8 | **Employees** | Employee Center, Payroll Center, Enter Time (single/weekly), Pay Employees, Payroll Tax Forms & W-2s |
| 9 | **Banking** | Write Checks, Make Deposits, Transfer Funds, Reconcile, Enter Credit Card Charges, Online Banking, Bank Feeds |
| 10 | **Reports** | Report Center, Memorized Reports, Company & Financial, Customers & Receivables, Vendors & Payables, Banking, Budgets & Forecasts |
| 11 | **Help** | QuickBooks Help, QuickBooks Desktop Help, Learning Center, Support, About QuickBooks |

**Additional Navigation Layer — Home Page Icons:**
Organized visually by workflow category: Sales, Customers, Vendors, Employees, Banking. Each section contains clickable icons for common actions (e.g., Create Invoices, Receive Payments, Enter Bills, Pay Bills, Write Checks, Reconcile).

**UX Patterns:**
- Traditional desktop menu bar with dropdown sub-menus
- Customizable Icon Bar (left or top position)
- Home Page as visual dashboard with workflow-based icon groups
- Navigator window for quick access
- Memorized transactions and reports for repeat tasks

---

## 3. Digits

**Top-Level Items: ~6** (modern AI-driven, minimal sidebar)

| # | Item | Sub-Items / Details |
|---|------|---------------------|
| 1 | **Inbox** | Uncategorized transactions, unmatched items, team collaboration messages, action items — serves as a unified to-do list |
| 2 | **Accounting** | Category Manager (intelligent chart of accounts for income, expenses, assets, liabilities) |
| 3 | **Bill Pay** | Pending approval, awaiting payment, scheduled bills, paid bills. Drag-and-drop upload with OCR auto-population, approval flows, ACH/check payment |
| 4 | **Reconciliations** | Account reconciliation histories, unfinished reconciliation tracking, status overview |
| 5 | **Financials** (tab) | Balance Sheet, Profit & Loss, Cash Flow, A/R Aging, A/P Aging — interactive, presentation-ready |
| 6 | **Documents** (tab) | Automatic bank statement fetching (Plaid), secure document storage |

**Additional Sections:**
- **Dashboard** — Drag-and-drop customizable widgets: revenue, burn rate, runway, cash flow, KPIs
- **Invoicing** — Generate, customize, send, track (viewed/overdue/paid), automated follow-ups
- **Collaborations** — Invite accountants, branded client portal, team chatter

**UX Patterns:**
- AI-first philosophy: Bookkeeping Agent auto-categorizes at ~96.5% accuracy
- Dual modes: "Operator Mode" (business leaders) vs. "Accountant Mode" (detailed accounting)
- Drag-and-drop throughout (dashboard widgets, bill uploads)
- Minimal sidebar — intentionally fewer items than legacy software
- Inbox-driven workflow (action items surface to you, not buried in menus)
- Horizontal tabs complement the sidebar for secondary navigation

---

## 4. Xero

**Top-Level Items: 4-5** (one of the most minimal structures)

| # | Item | Sub-Items |
|---|------|-----------|
| 1 | **Business** | Invoices, Quotes, Bills, Purchase Orders, Expense Claims, Products and Services |
| 2 | **Accounting** | Bank Accounts, Reports, Chart of Accounts, Find and Recode, Manual Journals, Fixed Assets, Advanced Accounting Tools & Settings, Favorites (customizable shortcuts) |
| 3 | **Contacts** | Customers, Suppliers, Contact Groups |
| 4 | **Organization Menu** (top-left) | Business Switcher (multi-org), Files, Settings |
| 5 | **Do More with Xero** | App Marketplace, Xero Payroll, Xero Projects |

**UX Patterns:**
- Extremely minimal top-level (4 main items) — one of the leanest in the industry
- Dual-menu philosophy: "Business" for everyday tasks vs. "Accounting" for compliance/advisory
- Keyboard shortcuts (e.g., `i` for invoices, `b` for bills)
- Customizable Favorites section under Accounting
- Organization switcher for multi-business accounts
- Right-hand panel for search, notifications, help, and JAX (GenAI assistant)
- 2025 redesign simplified the structure further

---

## 5. FreshBooks

**Top-Level Items: 8-11** (varies by plan)

| # | Item | Sub-Items |
|---|------|-----------|
| 1 | **Dashboard** | Business health snapshot, outstanding invoices, recent payments, unreviewed expenses |
| 2 | **Clients** | Client management and information |
| 3 | **Invoices** | Invoice creation and management |
| 4 | **Estimates** | Estimate creation and tracking |
| 5 | **Proposals** | Business proposal management |
| 6 | **Expenses** | Expense tracking and management |
| 7 | **Projects** | Project collaboration and organization |
| 8 | **Time Tracking** | Time entry and hour tracking |
| 9 | **Accounting** | Chart of Accounts, Reports, Bank reconciliation |
| 10 | **Reports** | Financial reports, Expense reports, Invoice Details |
| 11 | **Settings** (bottom) | Account config, Business details, Branding, User management |

**UX Patterns:**
- Fixed left sidebar, mostly single-level items (flat hierarchy)
- Business switcher at top of sidebar
- Settings anchored at bottom
- "Create New" dropdown button at top for quick actions
- Minimalist, clean — avoids nesting where possible
- Dashboard-first approach

---

## 6. Wave (Free)

**Top-Level Items: 7** (expandable/collapsible)

| # | Item | Sub-Items |
|---|------|-----------|
| 1 | **Dashboard** | Cash flow insights, P&L overview, Payables/Receivables, Net income, Expense breakdown (24-month), Account balances, Quick action buttons |
| 2 | **Sales** | Invoices, Estimates, Recurring Invoices, Customer Statements, Credit Card Payments, Customers, Products, Services |
| 3 | **Purchases** | Bills, Receipts, Vendors, Products, Services |
| 4 | **Accounting** | Transactions, Reconciliation, Chart of Accounts, Hire a Bookkeeper (action link) |
| 5 | **Banking** | Connected Bank Accounts, Payouts, Bank Syncing |
| 6 | **Payroll** | Employee management, Timesheets, Payroll processing, Payroll Reports |
| 7 | **Reports** | Trial Balance, Balance Sheet, P&L, Income by Customer, Account Transactions, Expense by Vendor, General Ledger, Aged Receivables, Aged Payables, Sales Tax Report, Gain/Loss on Forex |

**UX Patterns:**
- Fully expandable/collapsible dropdown structure
- Single level of nesting only (never 3-deep)
- 3-8 sub-items per section (Reports has 11)
- Dashboard-first with cash flow metrics prominently displayed
- Blue "Create a New" dropdown at top
- Launchpad section for customizable shortcuts

---

## Comparative Overview

| Platform | Top-Level Items | Sub-Item Style | Deepest Nesting | Key UX Innovation |
|----------|:-:|----------------|:-:|-------------------|
| QuickBooks Online | 10 | Hover flyouts | 2 | Customizable My Menu + bookmarks |
| QuickBooks Desktop | 11 | Dropdown menus | 3 | Visual Home Page workflow icons |
| Digits | ~6 | Sidebar + tabs | 2 | AI Inbox as primary workflow driver |
| Xero | 4-5 | Dropdown menus | 2 | Keyboard shortcuts + minimal top-level |
| FreshBooks | 8-11 | Flat sidebar | 1 | Flat hierarchy, almost no nesting |
| Wave | 7 | Collapsible sections | 2 | Expandable dropdowns, clean grouping |

---

## UX Best Practices: B2B SaaS Navigation

### How Many Items is Too Many?

**The ideal range is 5-7 top-level navigation items.** This is supported by multiple UX research sources:

- **Hick's Law**: Decision time increases logarithmically with the number of choices. A menu with 12 items is not just twice as hard as 6 — it's exponentially harder to process.
- **Miller's Law (clarified)**: The famous "7 ± 2" rule is about short-term memory, not menu design. However, the practical implication holds — users scan and process 5-7 items efficiently.
- **Nielsen Norman Group**: Recommends keeping primary navigation scannable. If you need more than 7 items, it's an information architecture problem, not a design problem.

### When You Have Too Many Items

If navigation exceeds 7 top-level items, consider:

1. **Grouping** — Combine related items under a parent category (e.g., Wave groups Invoices, Estimates, Customers under "Sales")
2. **Progressive disclosure** — Show basics first, reveal advanced options on demand (keep to <3 disclosure levels)
3. **Role-based views** — Show different nav based on user role (Digits does this with Operator vs. Accountant mode)
4. **Search/command palette** — Let power users bypass nav entirely
5. **Favorites/bookmarks** — Let users pin their most-used items (QBO, Xero both do this)

### Sidebar Dimensional Guidelines

- Expanded width: 240-300px
- Collapsed width: 48-64px (icon-only with hover tooltips)
- Item height: 40-48px (sufficient for mouse and touch targets)
- Internal padding: 16px on each side
- Icon size: 20-24px, left-aligned
- Collapse/expand transition: 200-300ms smooth easing

### Progressive Disclosure Best Practices

- Keep disclosure levels below 3 layers
- Default to showing the most common 80% of features
- Use collapsible sections, not hidden menus
- Clear labels — avoid branded/ambiguous menu names (Baymard Institute finding)
- Group related items: 4 logical groups are easier than 9 individual items

### What the Best Platforms Get Right

1. **Xero** proves you can run full accounting software with just 4 top-level items
2. **Digits** shows that AI can reduce navigation needs (Inbox surfaces what matters)
3. **Wave** demonstrates clean expandable sections that scale without overwhelming
4. **QBO** shows the value of customization (My Menu, bookmarks) when item count is high
5. **FreshBooks** shows that flat hierarchy works well for simpler use cases

### Key Sources

- Nielsen Norman Group — [Menu-Design Checklist: 17 UX Guidelines](https://www.nngroup.com/articles/menu-design/)
- Nielsen Norman Group — [Left-Side Vertical Navigation on Desktop](https://www.nngroup.com/articles/vertical-nav/)
- Nielsen Norman Group — [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- Nielsen Norman Group — [Minimize Cognitive Load to Maximize Usability](https://www.nngroup.com/articles/minimize-cognitive-load/)
- Baymard Institute — [SaaS UX Benchmark: 5 Pitfalls to Avoid](https://baymard.com/blog/saas-benchmark)
- Laws of UX — [Miller's Law](https://lawsofux.com/millers-law/)
- UX Myths — [Myth #23: Choices should always be limited to 7+/-2](https://uxmyths.com/post/931925744/myth-23-choices-should-always-be-limited-to-seven)
