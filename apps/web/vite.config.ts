import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  // Keep the browser's Host, the server checks it against Origin. The string shorthand rewrites it.
  server: { proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } } },
  build: {
    // The room chunk is mostly livekit-client
    chunkSizeWarningLimit: 1000,
    // No console output in prod builds
    rolldownOptions: { output: { minify: { compress: { dropConsole: true } } } },
  },
});
