# ---- 构建阶段 ----
FROM node:22-alpine AS build
WORKDIR /app

# 默认走阿里云镜像源,避免访问 registry.npmjs.org 超时;需要时用 --build-arg NPM_REGISTRY=<源地址> 覆盖
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN echo "registry=${NPM_REGISTRY}" > /root/.npmrc

RUN npm install -g pnpm@9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# 构建期可注入后端地址(同源部署留空即可):
#   docker build --build-arg VITE_API_BASE_URL=api.example.com:8080 -t startups-web .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# .env 里的本地开发地址不带入镜像,同源模式下走 nginx 反代
RUN rm -f .env && pnpm run build

# ---- 运行阶段 ----
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]