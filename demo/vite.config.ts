import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname),
  server: {
    port: 5173,
    host: true,
  },
  resolve: {
    alias: {
      howler: resolve(import.meta.dirname, "../node_modules/howler/dist/howler.js"),
    },
  },
});
