import axios from "axios";

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: "/", // 基础 URL
  timeout: 10000, // 请求超时时间
  headers: {
    "Content-Type": "application/json",
  },
});

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 在发送请求之前做些什么，比如添加认证令牌
    const token = localStorage.getItem("authToken");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    // 处理请求错误
    return Promise.reject(error);
  },
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 对响应数据做点什么
    if (response.data.code === 200) {
      return response.data.data;
    }
    return response.data;
  },
  (error) => {
    // 处理响应错误
    if (error.response) {
      // 服务器返回错误状态码
      switch (error.response.status) {
        case 401:
          // 未授权，跳转到登录页
          // window.location.href = '/login';
          break;
        case 403:
          // 禁止访问
          console.error("Access forbidden");
          break;
        case 404:
          // 资源不存在
          console.error("Resource not found");
          break;
        case 500:
          // 服务器错误
          console.error("Server error");
          break;
        default:
          console.error("Request failed");
      }
    } else if (error.request) {
      // 请求已发送但没有收到响应
      console.error("No response received");
    } else {
      // 请求配置出错
      console.error("Request error:", error.message);
    }
    return Promise.reject(error);
  },
);

export default apiClient;
