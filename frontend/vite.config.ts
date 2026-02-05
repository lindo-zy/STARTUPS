import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/room": {
        // target: "http://47.108.74.28", // 后端服务器地址
        target: "http://127.0.0.1:8080", // 后端服务器地址
        changeOrigin: true, // 改变请求源
        // rewrite: (path) => path.replace(/^\/api\//, ""), // 重写路径
      },
    },
  },
});
