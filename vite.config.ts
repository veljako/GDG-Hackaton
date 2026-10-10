import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.GEVENTS_API_PORT ?? process.env.GDEV_API_PORT ?? 5181}`,
        changeOrigin: false,
      },
    },
  },
  preview: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.GEVENTS_API_PORT ?? process.env.GDEV_API_PORT ?? 5181}`,
        changeOrigin: false,
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    environment: "node",
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/")) {
            if (/\/(?:@material\/web|@lit|lit|lit-html|lit-element)\//.test(id))
              return "material";
            if (/\/(?:motion|framer-motion|motion-dom|motion-utils)\//.test(id))
              return "motion";
            if (
              /\/(?:react|react-dom|react-router|react-router-dom|scheduler)\//.test(
                id,
              )
            )
              return "react";
          }
        },
      },
    },
  },
});
