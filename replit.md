# AI Bookkeeping Platform for UAE Businesses

## Overview

This AI-powered bookkeeping platform is designed for UAE businesses, offering comprehensive financial management including invoice generation, chart of accounts, double-entry journal entries, and AI-assisted expense categorization. It supports bilingual functionality (English/Arabic with RTL support) and incorporates UAE-specific features like 5% VAT calculations and AED currency formatting. The platform aims to streamline financial operations, ensure FTA-compliance, and provide real-time financial clarity.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript (Vite)
**UI Component System**: Shadcn/UI with Radix UI primitives, custom theme, light/dark modes, bilingual-first (RTL support for Arabic).
**State Management**: TanStack Query (server state/caching), Zustand (client-side state, i18n), React Hook Form with Zod (form state).
**Routing**: Wouter.
**Styling**: Tailwind CSS with custom design tokens, Inter font for UI, JetBrains Mono for financial data, HSL color variables.
**Key Design Decisions**: Component-based architecture, protected routes, responsive layout with collapsible sidebar, financial data formatting utilities.

### Backend Architecture

**Framework**: Express.js with TypeScript.
**API Design**: RESTful API with resource-based endpoints for authentication, company management, accounts, invoices, journal entries, reports, and AI categorization.
**Authentication**: JWT-based authentication with bcrypt for password hashing.
**Business Logic**: Multi-company support, role-based access, double-entry bookkeeping validation, UAE-specific chart of accounts seeding, invoice generation with 5% VAT, AI categorization stub.
**Development Server**: Vite dev server in middleware mode.

### Data Storage

**Database**: PostgreSQL via Neon serverless driver.
**ORM**: Drizzle ORM (schema-first with TypeScript, drizzle-kit for migrations).
**Schema Design**:
- **Users**: Authentication (email/password).
- **Companies**: Multi-tenant, base currency (AED), locale.
- **Company Users**: Many-to-many relationship with roles.
- **Accounts**: Chart of accounts with bilingual names, codes, types.
- **Journal Entries & Lines**: Double-entry system with validation.
- **Invoices & Invoice Lines**: Customer info, TRN, line items, VAT, status tracking, automatic journal entry creation.
- **Receipts/Expenses**: Document attachments, categorization data, posting to journal entries with account selection.
**Key Architectural Decisions**: UUID primary keys, timestamps, bilingual field support (nameEn/nameAr), normalized schema, complete double-entry bookkeeping system.

## External Dependencies

**Core Infrastructure**:
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle ORM**: Database access and migrations.

**Authentication & Security**:
- **jsonwebtoken**: JWT token generation and verification.
- **bcryptjs**: Password hashing.

**Frontend Libraries**:
- **Radix UI**: Accessible component primitives.
- **TanStack Query**: Server state management and caching.
- **React Hook Form**: Form state management.
- **Zod**: Schema validation.
- **date-fns**: Date manipulation and formatting.
- **Recharts**: Data visualization.
- **Wouter**: Lightweight routing.
- **Zustand**: Client state management.
- **Lucide React**: Icons.
- **react-icons/si**: Specific company logos.

**Development Tools**:
- **Vite**: Build tool and dev server.
- **TypeScript**: Type safety.
- **Tailwind CSS**: Utility-first styling.
- **PostCSS**: CSS processing.

## Double-Entry Bookkeeping System

The platform implements a complete double-entry bookkeeping system that ensures all financial transactions are properly recorded and balanced.

### Automatic Journal Entries for Invoices

Invoices automatically create journal entries when their status changes:

**Draft → Sent** (Revenue Recognition):
```
Dr. Accounts Receivable (1200)
    Cr. Sales Revenue (4000)
    Cr. VAT Payable (2100)
```

**Sent → Paid** (Payment Received):
```
Dr. Bank (1100)
    Cr. Accounts Receivable (1200)
```

**Draft → Paid** (Direct Payment):
```
Dr. Bank (1100)
    Cr. Sales Revenue (4000)
    Cr. VAT Payable (2100)
```

### Manual Posting for Expenses

Expenses (formerly Receipts) can be posted to the journal through a user-friendly interface:

1. **Upload or Create Expense**: Users upload receipt images or manually enter expense details
2. **Review Details**: Merchant, date, amount, VAT, and category are extracted or entered
3. **Post to Journal**: Users select:
   - **Expense Account** (debit): Which expense category (Rent, Utilities, etc.)
   - **Payment Account** (credit): Which cash/bank account was used
4. **Journal Entry Created**:
```
Dr. Expense Account (e.g., Rent Expense 5100)
    Cr. Payment Account (e.g., Bank 1100)
```

### Security & Data Integrity

All journal entry creation includes:
- **Company Isolation**: Accounts must belong to the same company as the transaction
- **Amount Validation**: Positive amounts required
- **Account Type Validation**: Ensures correct account types used
- **Balance Validation**: Debits must equal credits
- **Atomic Operations**: Journal entries and lines created together

### Reports

All financial reports (Profit & Loss, Balance Sheet, VAT Summary) calculate directly from journal entries, ensuring:
- Consistent data across all reports
- Real-time accuracy
- FTA compliance
- Proper accounting treatment