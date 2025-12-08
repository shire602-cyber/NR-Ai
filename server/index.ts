// Load environment variables - must be first before any process.env usage
import 'dotenv/config';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import http from 'http';

import express, { type Request, Response, NextFunction } from "express";
import session from 'express-session';
import MemoryStore from 'memorystore';
import passport from 'passport';
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// Add a simple test route before everything else
app.get('/test', (_req, res) => {
  res.json({ status: 'ok', message: 'Server is responding!' });
});

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  limit: '50mb', // Increased limit for base64-encoded receipt images
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Session configuration
const MemoryStoreSession = MemoryStore(session);
app.use(session({
  store: new MemoryStoreSession({
    checkPeriod: 86400000, // Prune expired entries every 24h
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
  },
}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// Import passport configuration
import './auth';

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Ensure required directories exist
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // Use process.cwd() as fallback to get the actual working directory
  // This prevents issues with worktrees and symlinks
  let projectRoot: string;
  try {
    // Try to resolve from __dirname first (more reliable)
    const resolvedRoot = path.resolve(__dirname, '..');
    
    // Check if path is in a temp directory or worktree
    const normalizedPath = path.normalize(resolvedRoot).toLowerCase();
    const isTempPath = normalizedPath.includes('temp') || normalizedPath.includes('bugbot');
    const isWorktreePath = normalizedPath.includes('.cursor') && normalizedPath.includes('worktrees');
    
    // Verify it's a valid absolute path and not a malformed temp path or worktree
    if (path.isAbsolute(resolvedRoot) && !isTempPath && !isWorktreePath) {
      projectRoot = resolvedRoot;
    } else {
      // Fallback to process.cwd() if __dirname gives us a temp path or worktree
      projectRoot = process.cwd();
    }
  } catch (error) {
    // Fallback to process.cwd() on any error
    projectRoot = process.cwd();
  }
  
  // Normalize and validate the path one more time
  const normalizedProjectRoot = path.normalize(projectRoot).toLowerCase();
  const isTempPath = normalizedProjectRoot.includes('temp') || normalizedProjectRoot.includes('bugbot');
  const isWorktreePath = normalizedProjectRoot.includes('.cursor') && normalizedProjectRoot.includes('worktrees');
  
  // Additional validation: ensure we're not in a temp directory or worktree
  if (isTempPath || isWorktreePath) {
    console.warn(`[Server] Warning: Detected temp/worktree directory path, using process.cwd() instead`);
    projectRoot = process.cwd();
  }
  
  // Create uploads directory if it doesn't exist
  const uploadsDir = path.resolve(projectRoot, 'uploads');
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log(`[Server] Created uploads directory: ${uploadsDir}`);
    }
  } catch (error) {
    console.warn(`[Server] Could not create uploads directory: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  // Create dist/public directory if it doesn't exist (for production builds)
  const distPublicDir = path.resolve(projectRoot, 'dist', 'public');
  try {
    if (!fs.existsSync(distPublicDir)) {
      fs.mkdirSync(distPublicDir, { recursive: true });
      console.log(`[Server] Created dist/public directory: ${distPublicDir}`);
    }
  } catch (error) {
    console.warn(`[Server] Could not create dist/public directory: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Validate environment variables with dotenv-safe if available
  // dotenv/config is already loaded at the top of the file
  // This is optional - if dotenv-safe is not installed, we continue without validation
  try {
    // @ts-ignore - dotenv-safe is optional, handled at runtime
    const dotenvSafeModule = await import('dotenv-safe');
    const dotenvSafe = dotenvSafeModule.default || dotenvSafeModule;
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const envExamplePath = path.resolve(__dirname, '..', '.env.example');
    
    if (fs.existsSync(envExamplePath)) {
      dotenvSafe.config({
        allowEmptyValues: true,
        example: envExamplePath,
      });
    }
  } catch (error) {
    // dotenv-safe is optional - .env is already loaded by dotenv/config
    // Silently continue if dotenv-safe is not available
    // This allows the server to run even if dotenv-safe is not installed
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  console.log(`[Environment] Running in ${process.env.NODE_ENV || 'development'} mode`);
  console.log(`[Database] ${process.env.DATABASE_URL ? 'Connected' : 'No connection string'}`);
  console.log(`[AI] ${process.env.OPENAI_API_KEY ? 'Configured (OpenAI)' : 'Not configured'}`);
  
  try {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Only log detailed errors in development
    if (isDevelopment) {
      console.error('[Error]', err);
    }

    res.status(status).json({ message: isProduction ? 'Internal Server Error' : message });
    if (!isProduction) {
      throw err;
    }
  });

    // Handle server errors BEFORE listening
    const port = parseInt(process.env.PORT || '5000', 10);
    
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`[Server] Port ${port} is already in use. Please stop the other process or use a different port.`);
      } else {
        console.error('[Server] Error:', error);
      }
      process.exit(1);
    });

    // Verify server is actually listening - set up BEFORE calling listen
    server.on('listening', () => {
      const address = server.address();
      if (address) {
        if (typeof address === 'object') {
          console.log(`[Server] ✓ Server bound to ${address.address}:${address.port}`);
        } else {
          console.log(`[Server] ✓ Server bound to port ${address}`);
        }
      }
    });
    
    // Start listening FIRST, then setup Vite
    // This ensures the server is bound before Vite tries to use it
    server.listen(port, "127.0.0.1", () => {
      log(`serving on port ${port}`);
      const address = server.address();
      console.log(`[Server] ✓ Server is running at http://localhost:${port}`);
      console.log(`[Server] ✓ Open http://localhost:${port} in your browser`);
      if (address) {
        if (typeof address === 'object') {
          console.log(`[Server] ✓ Server bound to ${address.address}:${address.port}`);
        } else {
          console.log(`[Server] ✓ Server bound to port ${address}`);
        }
      }
      
      // Setup Vite AFTER server is listening (non-blocking)
      // This ensures the server responds to API routes immediately
  if (app.get("env") === "development") {
        // Setup Vite asynchronously - don't await, let server respond immediately
        setupVite(app, server).then(() => {
          console.log('[Vite] Development server configured');
        }).catch((viteError) => {
          console.error('[Vite] Failed to setup Vite:', viteError);
          console.error('[Vite] Error details:', viteError instanceof Error ? viteError.message : String(viteError));
          // Continue even if Vite fails - serve static files
          try {
            serveStatic(app);
            console.log('[Server] Serving static files instead');
          } catch (staticError) {
            console.error('[Server] Failed to serve static files:', staticError);
          }
        });
  } else {
    serveStatic(app);
  }

      // Test that the server is actually responding
      setTimeout(() => {
        const testReq = http.get(`http://127.0.0.1:${port}/test`, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            console.log(`[Server] ✓ Test endpoint responded: ${data}`);
          });
        });
        testReq.on('error', (err) => {
          console.error(`[Server] ✗ Test endpoint failed:`, err.message);
        });
        testReq.setTimeout(2000, () => {
          console.error(`[Server] ✗ Test endpoint timeout`);
          testReq.destroy();
        });
      }, 500);
    });
  } catch (error) {
    console.error('[Fatal] Failed to initialize server:', error);
    if (error instanceof Error) {
      console.error('[Fatal] Error details:', error.message);
      console.error('[Fatal] Stack:', error.stack);
    }
    process.exit(1);
  }
})().catch((error) => {
  console.error('[Fatal] Failed to start server:', error);
  if (error instanceof Error) {
    console.error('[Fatal] Error details:', error.message);
    console.error('[Fatal] Stack:', error.stack);
  }
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
  console.error('[Promise]', promise);
  // Don't exit - let the server continue running
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]', error);
  // Don't exit - let the server continue running
});
