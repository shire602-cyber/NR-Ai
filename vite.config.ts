import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

const ANALYZE = process.env.ANALYZE === "1";
const logger = createLogger();
const warnOnce = logger.warnOnce;

logger.warnOnce = (message, options) => {
  if (message.includes("A PostCSS plugin did not pass the `from` option to `postcss.parse`")) {
    return;
  }
  warnOnce(message, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [
    react(),
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
    // Dedupe React so we never end up with two copies in different chunks.
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    // The spreadsheet vendor chunk is intentionally split from route bundles
    // and currently lands just under 1 MB after minification.
    chunkSizeWarningLimit: 1000,
    cssCodeSplit: true,
    minify: "esbuild",
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          // Heavy vendor libs deserve dedicated chunks so route bundles stay small.
          if (id.includes("jspdf") || id.includes("qrcode")) return "vendor-pdf";
          if (id.includes("exceljs")) return "vendor-spreadsheet";
          if (id.includes("pdfjs-dist") || id.includes("pdf.worker")) return "vendor-pdfjs";
          if (id.includes("html2canvas")) return "vendor-html2canvas";
          // recharts + d3-* are NOT manually grouped: bundling them together
          // produces a TDZ error ("Cannot access 'P' before initialization")
          // due to circular module init order after esbuild minification.
          // Let Vite's default chunking preserve the import-order-correct grouping.
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("react-day-picker") || id.includes("date-fns")) return "vendor-dates";
          if (id.includes("tesseract")) return "vendor-tesseract";
          if (id.includes("isomorphic-dompurify") || id.includes("dompurify"))
            return "vendor-dompurify";
          if (id.includes("@tanstack")) return "vendor-query";
          if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod"))
            return "vendor-forms";
          if (id.includes("react-icons")) return "vendor-icons";
          if (id.includes("lucide-react")) return "vendor-lucide";
          if (id.includes("socket.io-client")) return "vendor-socketio";
          if (id.includes("wouter")) return "vendor-router";
          if (id.includes("react-dom") || id.includes("/react/")) return "vendor-react";
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
