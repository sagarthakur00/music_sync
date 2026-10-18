import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER = process.env.SERVER_URL || "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    port: 5173,
    proxy: {
      "/api": SERVER,
      "/uploads": SERVER,
      "/ws": { target: SERVER.replace(/^http/, "ws"), ws: true },
    },
  },
});
