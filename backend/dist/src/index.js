import express from "express";
import cors from "cors";
const app = express();
// Enable CORS
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
// Simple routes that don't need any dependencies
app.get('/', (_req, res) => {
    res.json({ message: 'NR AI Backend API', version: '1.0.3', status: 'running' });
});
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Only load full routes if we get past the basic startup
const startServer = async () => {
    const port = parseInt(process.env.PORT || '5000', 10);
    console.log('[Environment] Running in', process.env.NODE_ENV || 'development', 'mode');
    console.log('[Port] Starting on port', port);
    // Start listening FIRST before loading heavy routes
    const server = app.listen(port, '0.0.0.0', async () => {
        console.log(`[Server] Listening on port ${port}`);
        // Now load the full routes after server is listening
        try {
            console.log('[Routes] Loading routes...');
            const { registerRoutes } = await import('./routes.js');
            await registerRoutes(app);
            console.log('[Routes] Routes loaded successfully');
            console.log('[Database]', process.env.DATABASE_URL ? 'Connected' : 'No connection string');
        }
        catch (error) {
            console.error('[Routes] Failed to load routes:', error);
        }
    });
    server.on('error', (error) => {
        console.error('[Server] Error:', error);
    });
};
startServer().catch((error) => {
    console.error('[Fatal] Startup failed:', error);
    process.exit(1);
});
