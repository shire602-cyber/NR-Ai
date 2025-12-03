import express, { type Request, Response, NextFunction } from "express";
// @ts-ignore - cors types issue
import cors from "cors";
import { registerRoutes } from "./routes.js";

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Simple CORS - allow all origins in production for now (can restrict later)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}

app.use(express.json({
  limit: '50mb',
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

function log(message: string) {
  const time = new Date().toLocaleTimeString("en-US");
  console.log(`${time} [express] ${message}`);
}

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

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

(async () => {
  try {
    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    console.log(`[Environment] Running in ${process.env.NODE_ENV || 'development'} mode`);
    console.log(`[Database] ${process.env.DATABASE_URL ? 'Connected' : 'No connection string'}`);
    
    // Check AI configuration
    const aiProvider = process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY 
      ? 'Replit AI (OpenRouter)' 
      : process.env.OPENROUTER_API_KEY 
        ? 'OpenRouter' 
        : process.env.OPENAI_API_KEY 
          ? 'OpenAI' 
          : 'Not configured';
    console.log(`[AI] ${aiProvider}`);
    console.log(`[CORS] Allowing all origins`);
    
    // Root route - simple ping that doesn't need database
    app.get('/', (_req, res) => {
      res.json({ message: 'NR AI Backend API', version: '1.0.3' });
    });
    
    // Health check BEFORE routes so it always responds
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    
    console.log('[Server] Registering routes...');
    await registerRoutes(app);
    console.log('[Server] Routes registered');

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";

      if (isDevelopment) {
        console.error('[Error]', err);
      }

      res.status(status).json({ message: isProduction ? 'Internal Server Error' : message });
    });

    const port = parseInt(process.env.PORT || '5000', 10);
    console.log(`[Server] Starting to listen on port ${port}...`);
    
    // Use app.listen directly instead of httpServer
    const server = app.listen(port, "0.0.0.0", () => {
      log(`API server running on port ${port}`);
      console.log('[Server] Server is ready to accept connections');
    });
    
    server.on('error', (error) => {
      console.error('[Server] Server error:', error);
    });
  } catch (error) {
    console.error('[FATAL] Server startup failed:', error);
    process.exit(1);
  }
})();
