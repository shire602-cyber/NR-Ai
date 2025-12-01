# Deployment Guide - NR AI Bookkeeping Platform

This guide covers deploying the AI Bookkeeping Platform to production.

## Architecture Overview

The platform is split into two deployable parts:

1. **Frontend** (`frontend/`) - React app deployed to Vercel
2. **Backend** (`backend/`) - Express API deployed to Railway or Render

## Prerequisites

- GitHub account
- Vercel account (free tier available)
- Railway or Render account (free tier available)
- Neon PostgreSQL database (free tier available)

## Step 1: Set Up Database (Neon)

1. Go to [neon.tech](https://neon.tech) and create an account
2. Create a new project
3. Copy the connection string (it looks like: `postgresql://user:pass@host/db`)
4. Save this as your `DATABASE_URL`

## Step 2: Deploy Backend

### Using Railway (Recommended)

1. Push the `backend/` folder to a new GitHub repository:
   ```bash
   cd backend
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/nr-ai-backend.git
   git push -u origin main
   ```

2. Go to [railway.app](https://railway.app) and sign in with GitHub

3. Click "New Project" → "Deploy from GitHub repo"

4. Select your `nr-ai-backend` repository

5. Add environment variables in Railway dashboard:
   - `DATABASE_URL` = Your Neon connection string
   - `SESSION_SECRET` = Generate a secure random string (use `openssl rand -hex 32`)
   - `OPENAI_API_KEY` = Your OpenAI API key (for AI features)
   - `FRONTEND_URL` = Leave empty for now (add after Vercel deploy)

6. Railway will auto-deploy. Copy your deployment URL (e.g., `https://nr-ai-backend.up.railway.app`)

### Using Render

1. Push the `backend/` folder to GitHub (same as above)

2. Go to [render.com](https://render.com) and sign in

3. Click "New" → "Web Service"

4. Connect your GitHub repository

5. Configure:
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`

6. Add environment variables (same as Railway)

7. Click "Create Web Service"

## Step 3: Deploy Frontend

1. Push the `frontend/` folder to a new GitHub repository:
   ```bash
   cd frontend
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/nr-ai-frontend.git
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com) and sign in with GitHub

3. Click "Add New Project"

4. Import your `nr-ai-frontend` repository

5. Vercel auto-detects Vite. Verify settings:
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

6. Add environment variable:
   - `VITE_API_URL` = Your Railway/Render backend URL (e.g., `https://nr-ai-backend.up.railway.app`)

7. Click "Deploy"

8. Copy your Vercel URL (e.g., `https://nr-ai-frontend.vercel.app`)

## Step 4: Update Backend CORS

1. Go back to Railway/Render dashboard

2. Update the `FRONTEND_URL` environment variable with your Vercel URL

3. The backend will auto-redeploy

## Step 5: Push Database Schema

Run this command from the `backend/` folder:

```bash
DATABASE_URL="your-neon-connection-string" npm run db:push
```

Or use Railway CLI:
```bash
railway run npm run db:push
```

## Step 6: Test the Deployment

1. Visit your Vercel URL
2. Create an account
3. Test the application features

## Troubleshooting

### CORS Errors
- Ensure `FRONTEND_URL` on backend matches your Vercel URL exactly
- Check that the URL doesn't have a trailing slash

### Database Connection Issues
- Verify `DATABASE_URL` is correct in Railway/Render
- Ensure Neon database is active (not paused)

### API Calls Failing
- Check browser console for error details
- Verify `VITE_API_URL` is correct in Vercel
- Ensure backend is running (check Railway/Render logs)

## Custom Domain (Optional)

### Vercel (Frontend)
1. Go to Project Settings → Domains
2. Add your custom domain
3. Update DNS records as instructed

### Railway (Backend)
1. Go to Project Settings → Networking
2. Add custom domain
3. Update DNS records as instructed

## Environment Variables Summary

### Backend (Railway/Render)
| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Random 32+ character string |
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI features |
| `FRONTEND_URL` | Yes | Your Vercel frontend URL |
| `PORT` | No | Server port (default: 3000) |

### Frontend (Vercel)
| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Your Railway/Render backend URL |

## Production Checklist

- [ ] Database created and schema pushed
- [ ] Backend deployed with all environment variables
- [ ] Frontend deployed with API URL configured
- [ ] CORS configured (FRONTEND_URL set on backend)
- [ ] Test user registration and login
- [ ] Test core features (invoices, journal entries)
- [ ] Monitor logs for any errors
