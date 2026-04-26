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
    // Split heavy third-party deps into their own chunks so the initial
    // shell stays small and pages that don't need PDF/Excel/charting never
    // download those libraries. Without this Rollup folds everything into
    // a single 1+MB vendor bundle.
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'wouter'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['jspdf', 'qrcode'],
          'vendor-xlsx': ['xlsx'],
          'vendor-motion': ['framer-motion'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
