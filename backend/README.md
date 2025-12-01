# NR AI Bookkeeping - Backend API

Express.js + TypeScript backend for the AI Bookkeeping Platform.

## Tech Stack

- Node.js
- Express.js
- TypeScript
- Drizzle ORM
- PostgreSQL (Neon)
- OpenAI/OpenRouter for AI features

## Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL database (recommend Neon)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Update `.env` with your configuration:
```
DATABASE_URL=postgresql://user:password@host:5432/database
SESSION_SECRET=your-secure-session-secret
OPENAI_API_KEY=your-openai-key
FRONTEND_URL=https://your-frontend.vercel.app
```

4. Push database schema:
```bash
npm run db:push
```

## Development

```bash
npm run dev
```

The API will run on http://localhost:3000

## Production Build

```bash
npm run build
npm start
```

## Deploy to Railway

### Option 1: Railway CLI
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Option 2: Connect GitHub Repository

1. Push this folder to a GitHub repository
2. Go to [railway.app](https://railway.app) and sign in
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Add environment variables:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `OPENAI_API_KEY`
   - `FRONTEND_URL`
6. Railway will auto-detect Node.js and deploy

### Deploy to Render

1. Push this folder to a GitHub repository
2. Go to [render.com](https://render.com) and sign in
3. Click "New" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - Build Command: `npm run build`
   - Start Command: `npm start`
6. Add environment variables
7. Click "Create Web Service"

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Secret for session encryption |
| `OPENAI_API_KEY` | OpenAI API key for AI features |
| `FRONTEND_URL` | Deployed frontend URL for CORS |
| `PORT` | Server port (default: 3000) |
| `GOOGLE_SHEETS_PRIVATE_KEY` | Google Sheets integration (optional) |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Google Sheets service account (optional) |

## API Endpoints

The API provides RESTful endpoints for:
- `/api/auth/*` - Authentication
- `/api/companies/*` - Company management
- `/api/invoices/*` - Invoice management
- `/api/journal/*` - Journal entries
- `/api/accounts/*` - Chart of accounts
- `/api/ai/*` - AI features (categorization, OCR)
- `/api/admin/*` - Admin functionality
- `/health` - Health check endpoint

## Project Structure

```
backend/
├── src/
│   ├── db.ts              # Database connection
│   ├── index.ts           # Server entry point
│   ├── routes.ts          # API routes
│   ├── storage.ts         # Data access layer
│   └── integrations/      # Third-party integrations
├── shared/                # Shared types
│   └── schema.ts          # Database schema
└── drizzle.config.ts      # Drizzle ORM config
```

## Health Check

The API includes a health check endpoint at `/health` that returns:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Use this for Railway/Render health checks.
