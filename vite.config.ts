import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";
import type { Plugin } from "vite";
import { FIRM_FIRST_SCREEN_NAMESPACES } from "./shared/firm-boot";

const ANALYZE = process.env.ANALYZE === "1";

/**
 * Second build of the same sources, for NR staff opening the firm workspace (`/firm/*`).
 * `FIRM_BUILD=1 vite build` bundles `client/firm.html` -> `src/firm-main.tsx`, which imports the
 * signed-in app and the two firm landing screens statically, so everything the first screen needs
 * sits in one entry chunk plus the vendor chunks instead of ~45 shared chunks (each one a round
 * trip on a phone over HTTP/1.1; docs/release/PR68-VERIFIED.md, defect 14). It writes next to the
 * main build (`dist/public/firm.html`, assets under `firm-assets/`) and never touches it, so
 * public, portal and no-login pages keep their own bundle untouched. The server picks the document
 * (server/vite.ts); a browser that loads the main bundle behaves exactly as before.
 */
const FIRM_BUILD = process.env.FIRM_BUILD === "1";

export default defineConfig({
  plugins: [
    react(),
    FIRM_BUILD ? firmPreloads() : marketingPreloads(),
    ANALYZE &&
      visualizer({
        filename: path.resolve(__dirname, "dist/bundle-stats.html"),
        gzipSize: true,
        brotliSize: true,
        template: "treemap",
        open: false,
      }),
  ].filter(Boolean) as any,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(__dirname, "client"),
  // The firm build must not re-copy client/public (it is already in the main build's folder).
  publicDir: FIRM_BUILD ? false : undefined,
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    // The firm build adds to the main build's folder; the main build starts it from scratch.
    emptyOutDir: !FIRM_BUILD,
    ...(FIRM_BUILD ? { assetsDir: "firm-assets" } : {}),
    sourcemap: false,
    // Heavy document workflows are split into isolated lazy chunks. Keep Vite's
    // warning budget tight so build logs catch new accidental eager imports.
    chunkSizeWarningLimit: 500,
    cssCodeSplit: true,
    cssMinify: "esbuild",
    minify: "esbuild",
    target: "es2020",
    // A5: don't spend a first-time visitor's bandwidth preloading heavy
    // document-workflow vendors. They are only reachable from lazy routes
    // (invoice PDF, VAT filing, receipt OCR) and still load on demand the
    // moment such a route is entered — this drops the hint, not the code.
    modulePreload: {
      resolveDependencies: (_filename, deps) =>
        deps.filter(
          (d) =>
            !/vendor-pdfjs|vendor-pdf-worker|vendor-pdf|vendor-tesseract|vendor-html2canvas/.test(d)
        ),
    },
    rollupOptions: {
      ...(FIRM_BUILD ? { input: path.resolve(__dirname, "client", "firm.html") } : {}),
      output: {
        // D1b: rolldown code-splitting groups. A group also captures the dependencies of
        // the modules it matches, so React used to be pulled into whichever vendor group saw
        // it first (react into vendor-dates, react-dom into vendor-query), which forced
        // date-fns and React Query onto every page. React gets its own higher-priority
        // group; every other vendor keeps the previous naming.
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              // Wouter also uses this shim, so public navigation should not pull in Radix.
              test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
              priority: 2,
            },
            { name: vendorChunkName, priority: 1 },
            { name: firmCatalogChunkName, priority: 1 },
            // Firm build: everything the entry imports statically (the app, the two landing
            // screens and what they share with lazy pages) is one chunk, not ~35 shared ones.
            ...(FIRM_BUILD
              ? [{ name: "firm-shell", tags: ["$initial" as const], priority: 0 }]
              : []),
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});

/** Vendor chunk for a module id (null: let rolldown decide). */
function vendorChunkName(id: string): string | null {
  // D1: transform helpers (private fields, typeof, ...) are shared by many
  // vendors. Left alone they land in the first manual chunk that uses them
  // (the PDF vendors), which made every page download ~290 KB of PDF code.
  if (/@oxc-project[+/]runtime|@babel\/runtime|vite\/preload-helper/.test(id))
    return "vendor-helpers";
  if (!id.includes("node_modules")) return null;
  if (id.includes("jspdf") || id.includes("qrcode")) return "vendor-pdf";
  if (id.includes("pdfjs-dist/build/pdf.worker")) return "vendor-pdf-worker";
  if (id.includes("pdfjs-dist") || id.includes("pdf.worker")) return "vendor-pdfjs";
  if (id.includes("framer-motion")) return "vendor-motion";
  if (id.includes("@radix-ui")) return "vendor-radix";
  if (id.includes("react-day-picker") || id.includes("date-fns")) return "vendor-dates";
  if (id.includes("tesseract")) return "vendor-tesseract";
  if (id.includes("isomorphic-dompurify") || id.includes("dompurify")) return "vendor-dompurify";
  if (id.includes("@tanstack")) return "vendor-query";
  if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod"))
    return "vendor-forms";
  if (id.includes("react-icons")) return "vendor-icons";
  if (id.includes("lucide-react")) return "vendor-lucide";
  if (id.includes("socket.io-client")) return "vendor-socketio";
  if (id.includes("wouter")) return "vendor-router";
  if (id.includes("react-dom") || id.includes("/react/")) return "vendor-react";
  return null;
}

/**
 * The three catalogs only the firm screens read (`firm`, `firmOps`, `clientsFirm`) ship as one
 * chunk per locale: the firm first screen needs all three, and one request replaces three on a
 * phone. No other route loads them, so nothing else downloads the combined chunk.
 */
function firmCatalogChunkName(id: string): string | null {
  const m = /client[\\/]src[\\/]locales[\\/](en|ar)[\\/](firm|firmOps|clientsFirm)\.json/.exec(id);
  return m ? `catalog-firm-${m[1]}` : null;
}

/**
 * Firm build only: emits `firm-preloads.json`, the first-screen catalog chunks per language. The
 * server adds `<link rel="modulepreload">` for the ones of the visitor's language (language
 * cookie) so they download with the entry chunk instead of after it has run.
 */
function firmPreloads(): Plugin {
  return {
    name: "firm-preloads",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === "chunk");
      const facade = (suffix: string) =>
        chunks.find((c) => c.moduleIds.some((id) => id.replace(/\\/g, "/").endsWith(suffix)))
          ?.fileName;
      const catalogs: Record<string, string[]> = {};
      for (const locale of ["en", "ar"]) {
        const files = new Set<string>();
        for (const ns of FIRM_FIRST_SCREEN_NAMESPACES) {
          const file = facade(`client/src/locales/${locale}/${ns}.json`);
          if (file) files.add(file);
        }
        catalogs[locale] = [...files].sort();
      }
      this.emitFile({
        type: "asset",
        fileName: "firm-preloads.json",
        source: JSON.stringify({ catalogs }),
      });
    },
  };
}

/** Start the public page's imports with the HTML, without preloading app or tool routes. */
function marketingPreloads(): Plugin {
  return {
    name: "marketing-preloads",
    apply: "build",
    generateBundle(_options, bundle) {
      const entries = ["PhaseRoot"].map((name) =>
        Object.values(bundle).find((file) => file.type === "chunk" && file.name === name)
      );
      const scripts = new Set<string>();
      const styles = new Set<string>();
      function walk(fileName: string) {
        const file = bundle[fileName];
        if (!file || file.type !== "chunk" || file.isEntry || scripts.has(fileName)) return;
        scripts.add(fileName);
        for (const css of file.viteMetadata?.importedCss ?? []) styles.add(css);
        for (const dependency of file.imports) walk(dependency);
      }
      for (const file of entries) {
        if (file?.type === "chunk") walk(file.fileName);
      }
      this.emitFile({
        type: "asset",
        fileName: "marketing-preloads.json",
        source: JSON.stringify({ scripts: [...scripts], styles: [...styles] }),
      });
    },
  };
}
