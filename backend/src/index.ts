import express from "express";
import cors from "cors";

const app = express();

// Enable CORS
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`[Request] ${req.method} ${req.path}`);
  next();
});

// Simple routes that don't need any dependencies
app.get('/', (_req, res) => {
  console.log('[Response] Sending root response');
  res.json({ message: 'NR AI Backend API', version: '1.0.4', status: 'running' });
});

app.get('/health', (_req, res) => {
  console.log('[Response] Sending health response');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Heartbeat to verify process stays alive
setInterval(() => {
  console.log('[Heartbeat] Process alive at', new Date().toISOString());
}, 30000);

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('[Fatal] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled rejection:', reason);
});

// Only load full routes if we get past the basic startup
const startServer = async () => {
  const port = parseInt(process.env.PORT || '5000', 10);
  
  console.log('[Environment] Running in', process.env.NODE_ENV || 'development', 'mode');
  console.log('[Port] Starting on port', port);
  
  // Start listening FIRST before loading heavy routes
  const server = app.listen(port, '0.0.0.0', async () => {
    console.log(`[Server] Listening on port ${port}`);
    console.log('[Server] Ready to accept connections');
    
    // Now load the full routes after server is listening
    try {
      console.log('[Routes] Loading routes...');
      const { registerRoutes } = await import('./routes.js');
      await registerRoutes(app);
      console.log('[Routes] Routes loaded successfully');
      console.log('[Database]', process.env.DATABASE_URL ? 'Connected' : 'No connection string');
    } catch (error) {
      console.error('[Routes] Failed to load routes:', error);
    }
  });

  server.on('error', (error) => {
    console.error('[Server] Error:', error);
  });
  
  server.on('listening', () => {
    console.log('[Server] Event: listening');
  });
};

startServer().catch((error) => {
  console.error('[Fatal] Startup failed:', error);
  process.exit(1);
});
