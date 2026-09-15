import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  base: "/eastlake-speech-debate-attendance/",
  publicDir: path.resolve(projectRoot, "public"),
  root: path.resolve(projectRoot, "github-pages"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  build: {
    emptyOutDir: true,
    outDir: path.resolve(projectRoot, "docs"),
  },
});
