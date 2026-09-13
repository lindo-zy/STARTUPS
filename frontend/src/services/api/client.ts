import axios from "axios";

// VITE_API_BASE_URL 为空时走同源相对路径(配合 nginx 反代,手机端同源访问),
// 本地开发在 .env 里配置如 127.0.0.1:8080
const apiBase = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: apiBase ? `http://${apiBase}` : "", // 基础 URL
  timeout: 10000, // 请求超时时间
  headers: {
    "Content-Type": "application/json",
  },
});

// 注意:本项目的身份令牌通过 query 参数传递(见 room.ts 的 authParams),
// 后端不读取 Authorization 头。

// 响应拦截器:后端统一信封 {code, message, data},成功时直接解包出 data,
// 失败时抛出带可读 message 的 Error,页面直接 toast 展示。
apiClient.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === "object" && "code" in body) {
      if (body.code === 200) {
        return body.data;
      }
      return Promise.reject(new Error(body.message || "请求失败"));
    }
    return body;
  },
  (error) => {
    const body = error.response?.data;
    const message =
      body?.message || (typeof body?.detail === "string" ? body.detail : null) || error.message || "网络异常,请稍后重试";
    return Promise.reject(Object.assign(new Error(message), { response: error.response }));
  },
);

export default apiClient;
