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
 *
 * Caching strategy is deliberate:
 *   - /assets/* — vite-hashed files, content-addressed → cache forever (1y, immutable)
 *   - / and *.html — entry document, must always be fresh so the user picks up
 *     new bundle hashes after a deploy. Without this Fastly was caching the
 *     post-build HTML for hours and pinning users to a stale bundle even
 *     after the pod restarted with a new image.
 *
 * The `Surrogate-Control` and `CDN-Cache-Control` headers are specifically
 * honored by Fastly (Railway's CDN) and override the upstream Cache-Control
 * for the edge cache only — the browser still sees no-store.
 */
const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
};

export function serveStatic(app: Express) {
  const distPath = path.resolve(projectRoot, 'dist', 'public');

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed assets — safe to cache aggressively because the filename changes
  // any time content does.
  app.use(
    '/assets',
    express.static(path.resolve(distPath, 'assets'), {
      immutable: true,
      maxAge: '1y',
    }),
  );

  // Everything else (favicon, manifest, robots, etc.) — short cache only.
  app.use(
    express.static(distPath, {
      etag: true,
      lastModified: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.setHeader(k, v);
        }
      },
    }),
  );

  // SPA fallback — index.html is the entry document; must NEVER be cached
  // by the CDN or it pins users to a stale bundle hash forever.
  app.use('*', (_req, res) => {
    for (const [k, v] of Object.entries(NO_STORE_HEADERS)) res.setHeader(k, v);
    res.sendFile(path.resolve(distPath, 'index.html'));
  });
}
