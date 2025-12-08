import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import { nanoid } from "nanoid";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to get project root safely, avoiding temp/worktree path issues
function getProjectRoot(): string {
  try {
    const resolvedRoot = path.resolve(__dirname, '..');
    
    // Check if path is in a temp directory or worktree
    const normalizedPath = path.normalize(resolvedRoot).toLowerCase();
    const isTempPath = normalizedPath.includes('temp') || normalizedPath.includes('bugbot');
    const isWorktreePath = normalizedPath.includes('.cursor') && normalizedPath.includes('worktrees');
    
    // Validate path is not a temp directory or worktree
    if (path.isAbsolute(resolvedRoot) && !isTempPath && !isWorktreePath) {
      return path.normalize(resolvedRoot);
    }
  } catch (error) {
    // Fall through to process.cwd()
  }
  // Always use process.cwd() as fallback to get the actual working directory
  // This prevents issues with worktrees and symlinks
  return process.cwd();
}

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  // Dynamically import vite config to handle top-level await
  let viteConfig;
  try {
    viteConfig = (await import("../vite.config.js")).default;
  } catch (error) {
    // If import fails, use inline config
    console.log('[Vite] Using inline config (vite.config import failed)');
    viteConfig = {};
  }

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Don't exit on Vite errors - let the server continue running
        // The error will be shown but the server should still serve the app
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const projectRoot = getProjectRoot();
      const clientTemplate = path.resolve(
        projectRoot,
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  // Resolve from project root (where package.json is located)
  // This matches vite.config.ts: outDir: path.resolve(__dirname, "dist/public")
  // Use safe project root resolution to avoid temp/worktree path issues
  const projectRoot = getProjectRoot();
  const distPath = path.resolve(projectRoot, "dist", "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
