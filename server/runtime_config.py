"""把自动生成的运行密钥保存在数据卷，损坏时拒绝启动，避免静默轮换。"""
from __future__ import annotations

import fcntl
import json
import os
import secrets
import tempfile


def persistent_keys(data_dir: str, legacy_config: dict) -> dict:
    os.makedirs(data_dir, mode=0o700, exist_ok=True)
    path = os.path.join(data_dir, "runtime-secrets.json")
    lock_fd = os.open(os.path.join(data_dir, ".runtime-secrets.lock"), os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(lock_fd, "r+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as source:
                    saved = json.load(source)
                if not isinstance(saved, dict) or any(
                    not isinstance(saved.get(key), str) or not saved[key]
                    for key in ("secret_key", "runner_key")
                ):
                    raise ValueError("invalid persisted keys")
            except (ValueError, OSError) as exc:
                raise RuntimeError("数据目录中的 runtime-secrets.json 无法读取或已损坏，请从备份恢复，不能自动重新生成") from exc
            return saved

        # 旧 config.json 中的密钥迁入数据卷；环境变量由调用方最后覆盖，不写入文件。
        saved = {
            "secret_key": legacy_config.get("secret_key") or secrets.token_hex(32),
            "runner_key": legacy_config.get("runner_key") or secrets.token_hex(32),
        }
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=data_dir,
                                         prefix=".runtime-secrets-", delete=False) as target:
            json.dump(saved, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(target.name, path)
        return saved
