import express from "express";
import cors from "cors";
import { registerRoutes } from "./routes.js";
const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
function log(message) {
    const time = new Date().toLocaleTimeString("en-US");
    console.log(`${time} [express] ${message}`);
}
app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse = undefined;
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
    console.log(`[AI] ${process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || process.env.OPENAI_API_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`[CORS] Allowing origin: ${FRONTEND_URL}`);
    const server = await registerRoutes(app);
    app.use((err, _req, res, _next) => {
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
