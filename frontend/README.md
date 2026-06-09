# NR AI Bookkeeping - Frontend

React + TypeScript frontend for the AI Bookkeeping Platform.

## Tech Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui components
- TanStack Query
- Wouter (routing)
- Zustand (state management)

## Prerequisites

- Node.js 18+
- npm or yarn

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Update `.env` with your backend API URL:
```
VITE_API_URL=https://your-backend-url.railway.app
```

## Development

```bash
npm run dev
```

The app will run on http://localhost:5173

## Production Build

```bash
npm run build
```

Output will be in the `dist/` folder.

## Deploy to Vercel

### Option 1: Vercel CLI
```bash
npm install -g vercel
vercel
```

### Option 2: Connect GitHub Repository

1. Push this folder to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign in
3. Click "Add New Project"
4. Import your GitHub repository
5. Vercel will auto-detect Vite and configure:
   - Build Command: `npm run build`
   - Output Directory: `dist`
6. Add environment variable:
   - `VITE_API_URL` = Your deployed backend URL
7. Click "Deploy"

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API URL (e.g., `https://api.example.com`) |

## Project Structure

```
frontend/
├── src/
│   ├── components/     # UI components
│   ├── hooks/          # Custom React hooks
│   ├── lib/            # Utilities and helpers
│   ├── pages/          # Page components
│   ├── App.tsx         # Main app component
│   └── main.tsx        # Entry point
├── public/             # Static assets
├── shared/             # Shared types with backend
└── index.html          # HTML template
```
