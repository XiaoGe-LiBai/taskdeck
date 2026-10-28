#!/usr/bin/env bash
# 启动后端 API（Flask）
set -e
cd "$(dirname "$0")"

MODE="${1:-dev}"

# 端口口径唯一来源：config.json 的 port（默认 8100，与前端 PANEL_API_URL 一致）。
# 需要临时换端口时用环境变量 PORT 覆盖，例如：PORT=8200 ./run.sh
if [ -z "${PORT:-}" ]; then
  PORT="$(python3 -c "import json;print(json.load(open('config.json')).get('port',8100))" 2>/dev/null || echo 8100)"
fi

if [ "$MODE" = "prod" ]; then
  # 注意：小蚕扫码会话(xiaocan_bridge._QR_SESSIONS)、YYB 登录会话(yyb_client._SESSIONS)、
  # 青龙网页 token(ql_client._WEB_TOKENS) 都是进程内缓存，多 worker 之间不共享。
  # worker>1 时扫码轮询可能落到另一个 worker 直接"会话不存在"。
  # 因此生产默认单 worker；若确需多 worker，需先把这些缓存迁到 SQLite/Redis。
  WORKERS="${WORKERS:-1}"
  if [ "$WORKERS" != "1" ]; then
    echo "[run.sh] 警告：WORKERS=$WORKERS > 1，扫码绑定/YYB 会话在 worker 间不共享，可能出现会话丢失。" >&2
  fi
  echo "[run.sh] prod 模式：gunicorn -w $WORKERS -b 0.0.0.0:${PORT}"
  exec gunicorn -w "$WORKERS" -b "0.0.0.0:${PORT}" --timeout 120 'app:app'
else
  # dev 模式：把上面解析出的端口显式交给 app.py，省得两处各读一次配置、口径还不一样
  echo "[run.sh] dev 模式：python3 app.py（端口 ${PORT}）"
  PANEL_PORT="$PORT" exec python3 app.py
fi
