import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to get project root safely, avoiding temp/worktree path issues
// Note: vite.config.ts is already at the project root, so __dirname is the project root
// Unlike server/vite.ts which is nested one level deep and needs to go up one level
function getProjectRoot(): string {
  try {
    // Since vite.config.ts is at the project root, __dirname is already the project root
    const resolvedRoot = path.resolve(__dirname);
    
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

const projectRoot = getProjectRoot();

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "client", "src"),
      "@shared": path.resolve(projectRoot, "shared"),
      "@assets": path.resolve(projectRoot, "attached_assets"),
    },
  },
  root: path.resolve(projectRoot, "client"),
  build: {
    outDir: path.resolve(projectRoot, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
