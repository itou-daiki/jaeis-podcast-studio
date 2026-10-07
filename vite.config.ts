import { defineConfig } from "vite";

export default defineConfig({
  base: "/jaeis-podcast-studio/",
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg"] },
  worker: { format: "es" },
});
