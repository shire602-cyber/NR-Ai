# AI Bookkeeping Platform for UAE Businesses

## Overview

This is an AI-powered bookkeeping platform specifically designed for UAE businesses, providing comprehensive financial management capabilities including invoice generation, chart of accounts management, double-entry journal entries, and AI-assisted expense categorization. The platform supports bilingual functionality (English/Arabic with RTL support) and includes UAE-specific features like 5% VAT calculations and AED currency formatting.

## Recent Changes

**November 4, 2025 - UI/UX Improvements for Top-Tier SaaS Landing Page**
- Updated hero headline to "AI Bookkeeping Built for UAE Businesses"
- Updated hero subheading to "Save time, stay FTA-compliant, and get real-time financial clarity – powered by AI."
- Implemented mobile hamburger menu navigation using Shadcn Sheet component
  - Visible only on mobile (< 768px), slides from right (LTR) or left (RTL)
  - Contains all navigation links and action buttons
  - Auto-closes when navigation link is clicked
- Enhanced SEO meta tags in `client/index.html`:
  - Updated title: "AI Bookkeeping Built for UAE Businesses | FTA-Compliant Financial Management"
  - Improved meta description with new messaging
  - Added Open Graph tags for social sharing (og:title, og:description, og:site_name)
  - Added Twitter Card tags (twitter:card, twitter:title, twitter:description)
  - Added keywords, author, and canonical URL
- Accessibility improvements:
  - Added semantic HTML: `<main role="main">` wrapper
  - Added bilingual aria-labels to all major sections
  - Added `role="img"` and descriptive `aria-label` to integration logos (Stripe, PayPal, Excel)
  - Added `aria-hidden="true"` to decorative icons
  - Fixed hero CTA buttons to meet 44px minimum touch target size (accessibility standard)
  - Added screen reader support with `sr-only` text for hamburger menu
- Mobile responsiveness verified across multiple viewport sizes (375x667, 768x1024, 1920x1080)
- All existing features preserved: health check, bilingual support, ROI calculator, email popup, trust badges

**November 4, 2025 - Health Check System Implementation**
- Added `/health` endpoint to backend (`server/routes.ts`) that returns `{ ok: boolean, timestamp: string }`
- Created React hook `useHealthCheck` (`client/src/hooks/useHealthCheck.ts`) that polls health endpoint every 30 seconds
- Updated Landing page hero card to display real-time API health status badge
- Health status badge shows:
  - **Online**: Green pill with "API: online" (EN) / "API: متصل" (AR) when backend is responsive
  - **Offline**: Red pill with "API: offline" (EN) / "API: غير متصل" (AR) when backend is unreachable
  - **Loading**: "API: checking..." during initial check
- Badge uses proper TypeScript types and includes 5-second timeout for requests
- Bilingual support with automatic locale switching
- Added data-testid="badge-api-status" for testing

**November 4, 2025 - Dark SaaS Landing Page Redesign**
- Completely redesigned landing page (`client/src/pages/Landing.tsx`) with dark SaaS aesthetic inspired by HTML/CSS template
- Restructured page layout following template structure: Hero → Trust Strip → Integration Logos → Features → How It Works → Pricing → Testimonials → FAQ → Final CTA
- Updated messaging to focus on "AI bookkeeping that actually understands UAE VAT"
- **Hero Section**: Clear headline, subheading for UAE SMEs, dual CTAs (Start free trial, Watch how it works), 3 benefit pills with exact text ("FTA-Compliant," "Bank-Grade Security," "Powered by AI"), animated dashboard preview card showing month-end automation
- **Trust Strip**: 4 UAE business segments with Lucide icons (Dubai SMEs, Co-working hubs, Tax consultants, Clinics & practices)
- **Integration Logos**: Dedicated section showing Stripe, PayPal, and Excel logos with hover effects for credibility
- **Features**: 4 feature cards with icons and bullet lists (AI categorisation, UAE VAT & corporate tax, P&L/Trial Balance, Accountant collaboration)
- **How It Works**: 4-step process (Create company, Import data, Let AI work, Download reports) with ROI calculator integrated as highlighted component
- **ROI Calculator**: Interactive slider with real-time calculations showing monthly savings and weekly hours saved
- **Pricing**: 3 plans (Starter Free, Growth AED 299 - Most Popular, Firm AED 799) with footer text "All prices in AED · Cancel anytime · No setup fees" using middle dots
- **Testimonials**: 3 customer quotes from UAE business owners (CEO Marketing Agency Dubai, Founder E-commerce Sharjah, Tax Consultant Abu Dhabi)
- **FAQ**: 4 questions (UAE only?, Existing accountant?, Data storage?, Bank connection?)
- **Footer**: "Made with ❤️ in Dubai" using Heart icon from Lucide React (red fill)
- All existing features preserved: Bilingual EN/AR with RTL, ROI calculator, email popup (50% scroll OR 15s - whichever first), data-testid attributes
- Replaced all emojis with Lucide React icons per design guidelines
- Added data-testid attributes to all navbar links and integration logos
- Fully responsive design (mobile/tablet/desktop) with consistent dark SaaS aesthetic

**Landing Page Technical Details**:
- Design: Dark SaaS aesthetic with gradients, hover-elevate effects, Cards for content grouping
- Icons: All UI elements use Lucide React icons (no emojis) + react-icons/si for company logos (Stripe, PayPal)
- ROI Formula: monthlyHours = (transactions × 2min) / 60, weeklyHours = monthlyHours / 4, monthlySavings = monthlyHours × AED 50/hour
- Email popup: Dual trigger - opens at 50% scroll OR after 15 seconds (whichever happens first), collects emails for lifetime deal waitlist
- Integration logos: Stripe (SiStripe), PayPal (SiPaypal), Excel (Sheet from Lucide) with data-testid attributes
- Bilingual: Full English/Arabic support with RTL layout switching via Globe button
- Testing: Comprehensive data-testid attributes on all interactive elements
- Performance: No heavy images/videos, fast-loading, optimized for Core Web Vitals

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