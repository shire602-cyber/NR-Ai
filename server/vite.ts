import express, { type Express } from 'express';
import fs from 'fs';
import path from 'path';
import { type Server } from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * Set up Vite dev server (development only).
 * Uses dynamic imports so vite/nanoid are NOT loaded in production.
 */
export async function setupVite(app: Express, server: Server) {
  // Dynamic imports — these packages are devDependencies
  const { createServer: createViteServer, createLogger } = await import('vite');
  const { nanoid } = await import('nanoid');

  const viteLogger = createLogger();

  const vite = await createViteServer({
    configFile: path.resolve(projectRoot, 'vite.config.ts'),
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
      },
    },
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: 'custom',
  });

  app.use(vite.middlewares);
  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(projectRoot, 'client', 'index.html');

      let template = await fs.promises.readFile(clientTemplate, 'utf-8');
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ 'Content-Type': 'text/html' }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

/**
 * Serve static production build (production only).
 * No dev dependencies required.
 */
export function serveStatic(app: Express) {
  const distPath = path.resolve(projectRoot, 'dist', 'public');

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // SPA fallback
  app.use('*', (_req, res) => {
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}
