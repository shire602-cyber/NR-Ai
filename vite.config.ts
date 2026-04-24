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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Charts — recharts + its d3 dependencies
          if (id.includes('/recharts/') || id.includes('/d3-') || id.includes('/d3/') || id.includes('/victory')) return 'vendor-charts';
          // Radix UI primitives (shadcn/ui base)
          if (id.includes('/@radix-ui/')) return 'vendor-radix';
          // Animation
          if (id.includes('/framer-motion/')) return 'vendor-animations';
          // Data fetching
          if (id.includes('/@tanstack/')) return 'vendor-query';
          // PDF generation/rendering
          if (id.includes('/jspdf/') || id.includes('/html2canvas/') || id.includes('/@pdfme/') || id.includes('/pdfjs-dist/')) return 'vendor-pdf';
          // AI SDKs — large, only loaded by AI feature pages
          if (id.includes('/@anthropic-ai/') || id.includes('/openai/')) return 'vendor-ai';
          // react-icons — can be large, typically used only on specific pages
          if (id.includes('/react-icons/')) return 'vendor-icons';
          // OCR — large lib only needed on /receipts
          if (id.includes('/tesseract')) return 'vendor-ocr';
          // Spreadsheet — only needed for export
          if (id.includes('/xlsx/') || id.includes('/xlsxjs/')) return 'vendor-xlsx';
          // React core + small React-dependent packages that must initialize with React
          // (CJS interop packages in a separate catch-all chunk can get undefined React
          // due to ESM initialization order; colocating them with React avoids the issue)
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/scheduler/') ||
            id.includes('/lucide-react/') ||
            id.includes('/wouter/') ||
            id.includes('/zustand/') ||
            id.includes('/react-hook-form/') ||
            id.includes('/@hookform/') ||
            id.includes('/react-day-picker/') ||
            id.includes('/react-resizable-panels/') ||
            id.includes('/embla-carousel/') ||
            id.includes('/next-themes/') ||
            id.includes('/input-otp/') ||
            id.includes('/vaul/') ||
            id.includes('/cmdk/')
          ) return 'vendor-react';
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
