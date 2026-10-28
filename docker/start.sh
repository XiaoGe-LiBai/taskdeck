#!/bin/bash
# 单容器入口：先起 Flask API，就绪后再起 Next.js，任一进程退出即整体退出。
set -euo pipefail

API_PORT="${PANEL_PORT:-8100}"
WEB_PORT="${PORT:-3001}"
WORKERS="${WORKERS:-1}"
THREADS="${THREADS:-4}"

# 首次启动：没有 config.json 就用模板生成（不含任何真实凭据）。
# 生产环境请通过环境变量覆盖 PANEL_SECRET_KEY / PANEL_ADMIN_PASSWORD /
# YYB_* / QL_*，或挂载 config.local.json。
if [ ! -f /app/server/config.json ]; then
  cp /app/server/config.example.json /app/server/config.json
  echo "[start] 已从 config.example.json 生成 /app/server/config.json"
fi
mkdir -p /app/server/data

echo "[start] Flask  -> 0.0.0.0:${API_PORT} (workers=${WORKERS}, threads=${THREADS})"
cd /app/server
/app/venv/bin/gunicorn \
  -w "$WORKERS" \
  --threads "$THREADS" \
  -b "0.0.0.0:${API_PORT}" \
  --timeout 120 \
  --access-logfile - \
  --error-logfile - \
  'app:app' &
API_PID=$!

# 等后端探活通过再启动前端，避免首屏 502
for i in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1; then
    echo "[start] 后端就绪"
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[start] 后端进程已退出，启动失败" >&2
    exit 1
  fi
  if [ "$i" -eq 120 ]; then
    echo "[start] 后端 120 秒内未就绪，退出" >&2
    kill "$API_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

echo "[start] Next.js -> 0.0.0.0:${WEB_PORT}"
cd /app/web
PORT="$WEB_PORT" HOSTNAME=0.0.0.0 node server.js &
WEB_PID=$!

shutdown() {
  echo "[start] 收到退出信号，停止子进程"
  kill "$WEB_PID" "$API_PID" 2>/dev/null || true
  wait "$WEB_PID" "$API_PID" 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

# 任一进程先退出 -> 整体退出，交给容器重启策略
wait -n "$WEB_PID" "$API_PID" || true
echo "[start] 有子进程退出，容器结束" >&2
shutdown
