import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "renderer"),
      "@shared": path.resolve(__dirname, "../../packages/shared"),
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
    include: ["hls.js"],
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    // hls.js is large but only loaded with the (route-lazy) player; the 600 kB
    // player chunk is expected, so lift the warning. Split heavy vendors into
    // their own cached chunks so app-code edits don't re-bundle them.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          hls: ["hls.js"],
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          motion: ["framer-motion"],
        },
      },
    },
  },
});
