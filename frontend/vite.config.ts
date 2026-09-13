import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 后端地址:本地开发默认 127.0.0.1:8080(.env 里的 VITE_API_BASE_URL 可覆盖)
const api = process.env.VITE_API_BASE_URL
  ? `http://${process.env.VITE_API_BASE_URL}`
  : "http://127.0.0.1:8080";

// 同源代理:把 /room 接口和 /<6位房间号>/<玩家名> 的 WebSocket 转发给后端。
// 生产部署时由 nginx 承担同样的转发(见 frontend/nginx.conf),
// 此时前端以空 VITE_API_BASE_URL 构建,直接请求页面自身域名。
const proxy = {
  "/room": { target: api, changeOrigin: true },
  "^/\\d{6}/": { target: api, ws: true, changeOrigin: true },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy,
  },
  preview: {
    proxy,
  },
});
