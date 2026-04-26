import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          // Heavy vendor libs deserve dedicated chunks so route bundles stay small.
          if (id.includes("jspdf")) return "vendor-jspdf";
          if (id.includes("xlsx")) return "vendor-xlsx";
          if (id.includes("pdfjs-dist") || id.includes("pdf.worker")) return "vendor-pdfjs";
          if (id.includes("html2canvas")) return "vendor-html2canvas";
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("framer-motion")) return "vendor-framer";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("react-day-picker") || id.includes("date-fns")) return "vendor-dates";
          if (id.includes("tesseract")) return "vendor-tesseract";
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
