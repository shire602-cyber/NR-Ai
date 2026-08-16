import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

const ANALYZE = process.env.ANALYZE === "1";

export default defineConfig({
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
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
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
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("jspdf") || id.includes("qrcode")) return "vendor-pdf";
          if (id.includes("pdfjs-dist/build/pdf.worker")) return "vendor-pdf-worker";
          if (id.includes("pdfjs-dist") || id.includes("pdf.worker")) return "vendor-pdfjs";
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
