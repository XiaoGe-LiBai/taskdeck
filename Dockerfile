# syntax=docker/dockerfile:1
#
# 小蚕任务托管平台 · 单镜像（Next.js 前端 + Flask 后端）
#
#   docker build -t xiaocan-panel .
#   docker run -d -p 3001:3001 -v xiaocan-data:/app/server/data xiaocan-panel
#
# 前后端在同一个容器内：Flask 监听 127.0.0.1:8100（仅容器内），
# Next.js 监听 0.0.0.0:3001（对外）。外部只需暴露 3001。

# ---------------------------------------------------------------- 前端构建
FROM node:24-bookworm-slim AS web-builder

WORKDIR /app/web

ENV NEXT_TELEMETRY_DISABLED=1

# 先装依赖，利用层缓存
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./

# standalone 输出：产出 .next/standalone（内含 server.js 与最小 node_modules）
ENV NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=true \
    PANEL_API_URL=http://127.0.0.1:8100
RUN npm run build

# ---------------------------------------------------------------- 运行时
FROM node:24-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai \
    PANEL_API_URL=http://127.0.0.1:8100 \
    PANEL_PORT=8100 \
    PORT=3001

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      tini curl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 后端代码 + Python 依赖（独立 venv，不污染系统 Python）
COPY server/ /app/server/
RUN python3 -m venv /app/venv \
 && /app/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /app/venv/bin/pip install --no-cache-dir -r /app/server/requirements.txt

# 前端 standalone 产物
COPY --from=web-builder /app/web/.next/standalone/ /app/web/
COPY --from=web-builder /app/web/.next/static/ /app/web/.next/static/
COPY --from=web-builder /app/web/public/ /app/web/public/

# 外部脚本仓库（server/bindings.py 的 DEFAULT_REPO_MAP 指向 /app/repos/*）
COPY repos/ /app/repos/

COPY docker/start.sh /usr/local/bin/start.sh

# 非 root 运行；data 目录留给 volume
RUN chmod +x /usr/local/bin/start.sh \
 && mkdir -p /app/server/data \
 && useradd -m -u 10001 appuser \
 && chown -R appuser:appuser /app/server /app/web /app/repos

USER appuser

EXPOSE 3001 8100

VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8100/healthz >/dev/null \
   && curl -fsS http://127.0.0.1:3001/ >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/start.sh"]
