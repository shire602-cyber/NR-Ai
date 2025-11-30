# AI Bookkeeping Platform for UAE Businesses

## Overview

This AI-powered bookkeeping platform provides comprehensive financial management for UAE businesses, including invoice generation, chart of accounts, double-entry journal entries, and AI-assisted expense categorization. It supports bilingual functionality (English/Arabic with RTL support) and incorporates UAE-specific features like 5% VAT calculations and AED currency formatting. The platform aims to streamline financial operations, ensure FTA-compliance, and provide real-time financial clarity, ultimately acting as a smart financial advisor and automation hub for small to medium-sized businesses in the UAE.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend

**Framework**: React with TypeScript (Vite).
**UI/UX**: Shadcn/UI with Radix UI, custom theme, light/dark modes, bilingual-first (RTL support for Arabic), responsive design with collapsible sidebar. Uses Inter font for UI and JetBrains Mono for financial data.
**State Management**: TanStack Query (server state), Zustand (client-side state, i18n), React Hook Form with Zod (form validation).
**Routing**: Wouter.
**Styling**: Tailwind CSS with custom design tokens.

### Backend

**Framework**: Express.js with TypeScript.
**API Design**: RESTful API for authentication, company management, accounts, invoices, journal entries, reports, and AI categorization.
**Authentication**: JWT-based authentication with bcrypt for password hashing.
**Business Logic**: Multi-company support, role-based access, double-entry bookkeeping validation, UAE-specific chart of accounts, invoice generation with 5% VAT, and AI categorization.

### Data Storage

**Database**: PostgreSQL via Neon serverless driver.
**ORM**: Drizzle ORM (schema-first with TypeScript, drizzle-kit for migrations).
**Schema Design**: Includes tables for Users, Companies, Company Users, Accounts, Journal Entries & Lines, Invoices & Invoice Lines, and Receipts/Expenses. Employs UUID primary keys, timestamps, bilingual fields (nameEn/nameAr), and a normalized schema for complete double-entry bookkeeping.

### Core Features

**Double-Entry Bookkeeping**: Automated journal entries for invoices (revenue recognition and payment recording) and manual posting for expenses. Ensures company isolation, amount validation, account type validation, and balance validation.
**AI Financial Automation**:
    - **Smart Transaction Categorization**: Batch processes transactions using UAE-specific categories, learns from user feedback.
    - **Anomaly & Duplicate Detection**: Scans for irregularities, duplicates, unusual amounts, and suspicious patterns.
    - **AI-Assisted Bank Reconciliation**: Smart matching between bank transactions and journal entries, supports bulk import.
    - **Predictive Cash Flow Forecasting**: Generates 3/6/12 month forecasts based on historical data.
    - **ML-Style Learning**: Records user corrections to improve AI accuracy.
**UX Innovations**:
    - **Smart Assistant**: Natural language interface for financial queries (English/Arabic).
    - **Autocomplete & Smart Suggestions**: Type-ahead suggestions and AI-powered category suggestions.
    - **AI CFO & Financial Advisor**: Dashboard with financial health summary, analytics, and AI-generated insights.
    - **Advanced Analytics & Forecasts**: Dashboard for cash flow forecasting, budget vs. actual comparisons, and KPIs.
    - **CRM & E-commerce Integrations Hub**: Manages connections to Stripe, Shopify, and Salesforce for transaction sync.
**WhatsApp Integration**: Webhook-based receipt ingestion from WhatsApp Business Cloud API, with an inbox dashboard for AI-powered text extraction and expense creation.

**Client Portal Features** (Phase 1):
    - **Document Vault**: Secure storage for licenses, contracts, and tax certificates with expiry tracking and reminder alerts (30/60/90 days before expiry).
    - **Tax Return Archive**: Historical record of all VAT, Corporate Tax, and Excise Tax returns filed with the FTA, including reference numbers and payment status.
    - **Compliance Calendar**: Visual calendar view of upcoming tax deadlines and compliance tasks.
    - **Task & Reminder Center**: Centralized task management for compliance activities with due dates, priorities, and completion tracking.
    - **UAE Tax News Feed**: Automated daily updates from FTA and trusted financial news sources about VAT, Corporate Tax, and regulatory changes.
    - **Secure Messaging**: Client-accountant communication hub with message threading and attachment support.

## Security Architecture

### Dual User Architecture
The platform supports three user types with distinct access levels:
- **admin**: NR Accounting Services staff with full administrative access
- **customer**: Self-service SaaS users with full bookkeeping features
- **client**: NR-managed clients with portal-only access to document vault, messaging, and compliance features

### Authorization Implementation
**Authentication**:
- JWT-based authentication with secure password hashing (bcrypt)
- authMiddleware fetches user from database on each request (never trusts JWT claims for sensitive data)
- Registration endpoint forces userType='customer' and isAdmin=false to prevent privilege escalation

**Route Protection Pattern**:
- requireCustomerMiddleware: Blocks client users from customer-only bookkeeping routes
- requireClientMiddleware: Blocks customer users from client portal routes  
- requireAdminMiddleware: Blocks non-admin users from admin routes
- hasCompanyAccess(userId, companyId): Validates user belongs to the company before data access

**Secured Routes** (Core Bookkeeping):
- Account routes: All CRUD operations require both userType validation AND company access checks
- Invoice routes: All CRUD, posting, and status updates require both validations
- Journal entry routes: All CRUD, posting, and reversal require both validations
- Receipt routes: All CRUD and posting require both validations
- Report routes: P&L, Balance Sheet, VAT Summary/Returns require company access checks
- Export routes: Google Sheets exports require company access checks

**AI Automation Routes** (Secured):
- POST /api/ai/categorize: Single transaction categorization
- POST /api/ai/batch-categorize: Batch transaction categorization
- POST /api/ai/detect-anomalies: Anomaly detection
- POST /api/ai/reconcile: Bank reconciliation
- POST /api/ai/forecast-cashflow: Cash flow forecasting

**Bank Transaction Routes** (Secured):
- GET/POST /api/companies/:companyId/bank-transactions
- POST /api/companies/:companyId/bank-transactions/import
- POST /api/bank-transactions/:id/reconcile

## External Dependencies

**Core Infrastructure**:
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle ORM**: Database access and migrations.
- **OpenAI GPT-4o**: For AI financial automation and natural language processing.

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
- **Lucide React & react-icons/si**: Icons.

**Development Tools**:
- **Vite**: Build tool and dev server.
- **TypeScript**: Type safety.
- **Tailwind CSS**: Utility-first styling.
- **PostCSS**: CSS processing.

**Third-Party Integrations**:
- **Google Sheets**: For exporting data.
- **WhatsApp Business Cloud API**: For receipt ingestion and communication.
- **Stripe**: For payment processing and transaction sync.
- **Shopify**: For order and customer data sync.
- **Salesforce**: For CRM data integration.