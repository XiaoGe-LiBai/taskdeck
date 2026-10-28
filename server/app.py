"""应用入口：注册 API 蓝图，只对外提供 /api/*。

UI 的唯一入口是 Next.js（../web），本服务是纯后端：
- 不托管静态资源、不渲染模板、不做 SPA 回退（老版 Vue SPA 已退役，
  资源留在 ../archive/复刻版-legacy-frontend 仅供查考）；
- /api/* 之外的路径不归本服务管（由 Next 或前置网关负责），
  未匹配的 /api/* 仍按原站契约返回 {"code":404,"msg":"page not found"}。

启动：
    python3 app.py                            # 开发/单机（端口取 config.json）
    gunicorn -w 1 -b 0.0.0.0:8100 'app:app'   # 与原站一致的 gunicorn 部署，见 run.sh
"""
from __future__ import annotations

import os
import socket

# 强制 urllib3 / requests 优先使用 IPv4，防止双栈网络下因微信开放平台等 IPv6 黑洞导致 60s 握手超时
try:
    import urllib3.util.connection as urllib3_conn
    urllib3_conn.allowed_gai_family = lambda: socket.AF_INET
except Exception:
    pass

from flask import Flask

import core
from api_admin import bp as admin_bp
from api_auth import bp as auth_bp
from api_projects import bp as projects_bp
from api_ql import bp as ql_bp
from api_user import bp as user_bp
from api_runner import bp as runner_bp
from api_yyb import bp as yyb_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False
    app.json.ensure_ascii = False

    core.init_db()
    core.start_log_cleanup_daemon()
    import seed

    import yyb_client
    import qinglong_client
    import ql_client

    seed.ensure_seed()
    yyb_client.ensure_seed()
    qinglong_client.ensure_seed()
    ql_client.ensure_seed()

    # 每天定时把小蚕账号的真实 SVIP 等级从平台刷一遍（后台可关 / 可改时刻）
    import xiaocan_bridge
    xiaocan_bridge.start_level_refresh_daemon()

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(projects_bp, url_prefix="/api")
    app.register_blueprint(user_bp, url_prefix="/api")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(ql_bp, url_prefix="/api/admin/ql")
    app.register_blueprint(runner_bp, url_prefix="/api/runner")
    app.register_blueprint(yyb_bp, url_prefix="/api/yyb")

    # 兜底：未匹配的 /api/* 与原站一致返回 page not found
    @app.route("/api/<path:_any>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def api_fallback(_any):
        return core.not_found()

    # 探活：nginx/容器健康检查用，不碰数据库
    @app.get("/healthz")
    def healthz():
        return {"code": 200, "data": {"status": "ok"}, "msg": "success"}

    @app.teardown_appcontext
    def _close(_exc=None):
        core.close_db()

    return app


app = create_app()


if __name__ == "__main__":
    host = core.CONFIG.get("host", "0.0.0.0")
    port = int(core.CONFIG.get("port", 8100))
    print(f"[panel] API http://{host}:{port}  数据库: {core.DB_PATH}")
    print(f"[panel] UI 由 Next.js 提供（../web），前端应指向 PANEL_API_URL=http://127.0.0.1:{port}")
    if core.admin_password_is_default():
        print("[panel] ⚠️  管理员口令仍是出厂默认值，上线前请执行：python3 tools/set_admin_password.py")
    app.run(host=host, port=port, debug=bool(os.environ.get("PANEL_DEBUG")), threaded=True)
