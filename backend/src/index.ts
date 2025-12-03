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

(async () => {
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
  
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (isDevelopment) {
      console.error('[Error]', err);
    }

    res.status(status).json({ message: isProduction ? 'Internal Server Error' : message });
    if (!isProduction) {
      throw err;
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`API server running on port ${port}`);
  });
})();
