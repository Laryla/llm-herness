import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // 浏览器始终访问同源 /api；开发时由 Vite 转发给本地 Harness Server。
    proxy: {
      "/api": {
        target: process.env.HARNESS_SERVER_URL ?? "http://127.0.0.1:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
