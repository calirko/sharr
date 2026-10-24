import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { proxy: { "/api": "http://localhost:3000" } },
  // The room chunk is mostly livekit-client
  build: { chunkSizeWarningLimit: 1000 },
});
