#!/bin/bash
# 单容器双进程；所有可变状态写入数据目录，支持 --user 使用宿主 UID/GID。
set -euo pipefail
umask 0077

API_PORT="${PANEL_PORT:-8100}"
WEB_PORT="${PORT:-3001}"
THREADS="${THREADS:-4}"
export HOME="${HOME:-/tmp}"
export PANEL_DATA_DIR="${PANEL_DATA_DIR:-/app/server/data}"
export PANEL_API_URL="http://127.0.0.1:${API_PORT}"

# 扫码会话为进程内状态，不能靠增加 worker 扩容。
if [ "${WORKERS:-1}" != "1" ]; then
  echo "[start] 当前仅支持 WORKERS=1；并发请配置 THREADS。" >&2
  exit 1
fi
mkdir -p "$PANEL_DATA_DIR"
if [ ! -w "$PANEL_DATA_DIR" ]; then
  echo "[start] 数据目录不可写。请匹配挂载目录与容器 UID/GID；不要使用 chmod 777。" >&2
  exit 1
fi

API_PID=""
WEB_PID=""
shutdown() {
  trap - TERM INT
  for pid in "$WEB_PID" "$API_PID"; do
    [ -z "$pid" ] || kill -TERM "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap 'shutdown; exit 0' TERM INT

cd /app/server
# 不复制默认配置：空库进入安装向导；旧配置可选挂载；自动密钥写入数据卷。
/app/venv/bin/gunicorn -w 1 --threads "$THREADS" -b "0.0.0.0:${API_PORT}" \
  --timeout 120 --access-logfile - --error-logfile - 'app:app' &
API_PID=$!

ready=false
for ((i=0; i<120; i++)); do
  if curl --max-time 2 -fsS "http://127.0.0.1:${API_PORT}/healthz" >/dev/null 2>&1; then
    ready=true
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[start] 后端启动失败，请检查部署配置和数据目录。" >&2
    shutdown
    exit 1
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "[start] 后端启动超时。" >&2
  shutdown
  exit 1
fi

cd /app/web
PORT="$WEB_PORT" HOSTNAME=0.0.0.0 node server.js &
WEB_PID=$!

# 异常退出不能伪装成功；让容器重启策略和监控识别失败。
set +e
wait -n "$WEB_PID" "$API_PID"
status=$?
set -e
shutdown
[ "$status" -ne 0 ] || status=1
exit "$status"
