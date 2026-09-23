import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.UNHARNESSED_CONTROL_WEB_PORT ?? 5174),
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
