import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const api=process.env.VITE_API_BASE_URL
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/room": {
        target:api, // 后端服务器地址
        changeOrigin: true, // 改变请求源
        // rewrite: (path) => path.replace(/^\/api\//, ""), // 重写路径
      },
    },
  },
});
