# AI Bookkeeping Platform for UAE Businesses

## Overview

This is an AI-powered bookkeeping platform specifically designed for UAE businesses, providing comprehensive financial management capabilities including invoice generation, chart of accounts management, double-entry journal entries, and AI-assisted expense categorization. The platform supports bilingual functionality (English/Arabic with RTL support) and includes UAE-specific features like 5% VAT calculations and AED currency formatting.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript using Vite as the build tool

**UI Component System**: Shadcn/UI with Radix UI primitives
- Design approach follows a hybrid system inspired by Linear's minimalism, Notion's content organization, and Stripe's professional data presentation
- Custom theme with support for light/dark modes
- Bilingual-first design with RTL (right-to-left) support for Arabic

**State Management**:
- TanStack Query (React Query) for server state management and API caching
- Zustand for client-side state (i18n locale preferences)
- React Hook Form with Zod validation for form state

**Routing**: Wouter for lightweight client-side routing

**Styling**: 
- Tailwind CSS with custom design tokens
- Typography: Inter for UI text, JetBrains Mono for financial data
- Consistent spacing primitives (2, 4, 6, 8, 12, 16, 20)
- Custom color system with HSL variables for theme flexibility

**Key Design Decisions**:
- Component-based architecture with clear separation between pages, layouts, and reusable UI components
- Protected routes requiring authentication
- Responsive layout with collapsible sidebar navigation
- Financial data formatting utilities for currency, dates, and numbers with locale support

### Backend Architecture

**Framework**: Express.js with TypeScript

**API Design**: RESTful API with resource-based endpoints
- `/api/auth/*` - Authentication (register, login)
- `/api/companies/*` - Company management
- `/api/companies/:id/accounts` - Chart of accounts
- `/api/companies/:id/invoices` - Invoice management
- `/api/companies/:id/journal` - Journal entries
- `/api/companies/:id/reports/*` - Financial reports
- `/api/ai/categorize` - AI expense categorization

**Authentication**: JWT-based authentication
- Bearer token in Authorization header
- Tokens stored in localStorage on client
- Middleware for protecting routes
- bcrypt for password hashing

**Business Logic**:
- Multi-company support with role-based access (company_users junction table)
- Double-entry bookkeeping with validation ensuring debits equal credits
- UAE-specific chart of accounts seeding for new companies
- Invoice generation with line items and automatic VAT calculation (5%)
- AI categorization stub ready for OpenAI integration

**Development Server**: 
- Vite dev server in middleware mode for HMR during development
- Express serves built static files in production

### Data Storage

**Database**: PostgreSQL via Neon serverless driver

**ORM**: Drizzle ORM
- Schema-first approach with TypeScript types
- Schema definition in `shared/schema.ts` for sharing between frontend and backend
- Migration support via drizzle-kit

**Schema Design**:

**Users Table**: User accounts with email/password authentication

**Companies Table**: Multi-tenant companies with base currency (AED) and locale preferences

**Company Users Junction Table**: Many-to-many relationship with role-based access

**Accounts Table**: Chart of accounts with bilingual names (English/Arabic), account codes, and types (asset, liability, equity, income, expense)

**Journal Entries & Lines**: Double-entry bookkeeping system
- Entries contain metadata (date, memo, company)
- Lines contain account references and debit/credit amounts
- Validation ensures balanced entries

**Invoices & Invoice Lines**: 
- Invoice header with customer information and TRN (Tax Registration Number)
- Line items with quantity, unit price, and VAT rate
- Status tracking (draft, sent, paid, overdue)

**Receipts**: Document attachments and categorization data

**Key Architectural Decisions**:
- UUID primary keys for distributed systems compatibility
- Timestamps for audit trails
- Bilingual field support (nameEn/nameAr) for UAE market
- Normalized schema with junction tables for many-to-many relationships

### External Dependencies

**Core Infrastructure**:
- **Neon Database**: Serverless PostgreSQL hosting
- **Drizzle ORM**: Database access and migrations

**Authentication & Security**:
- **jsonwebtoken**: JWT token generation and verification
- **bcryptjs**: Password hashing

**Frontend Libraries**:
- **Radix UI**: Accessible component primitives (20+ components including dialogs, dropdowns, popovers, etc.)
- **TanStack Query**: Server state management and caching
- **React Hook Form**: Form state management
- **Zod**: Schema validation
- **date-fns**: Date manipulation and formatting
- **Recharts**: Data visualization for financial reports
- **Wouter**: Lightweight routing
- **Zustand**: Client state management

**Development Tools**:
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety across the stack
- **Tailwind CSS**: Utility-first styling
- **PostCSS**: CSS processing with Autoprefixer

**Future Integration Points**:
- OpenAI API for AI categorization (stub currently in place at `/api/ai/categorize`)
- Document storage service for receipt uploads
- Email service for invoice delivery

**Rationale**: The technology stack prioritizes developer experience, type safety, and performance. Drizzle was chosen over Prisma for its lightweight footprint and SQL-like syntax. TanStack Query provides excellent caching and optimistic updates for financial data. The Radix UI + Shadcn/UI combination offers accessibility and customization while maintaining a professional design system.