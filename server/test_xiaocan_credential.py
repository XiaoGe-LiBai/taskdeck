"""小蚕凭据复制的格式与容错。

    python3 test_xiaocan_credential.py
"""
from __future__ import annotations

import base64
import json
import unittest

import xiaocan_bridge as xc


def make_jwt(user_id: int) -> str:
    """构造一个只需 payload 可解的小蚕 token（本项目不校验签名）。"""
    payload = base64.urlsafe_b64encode(
        json.dumps({"UserId": user_id, "exp": 4102444800}).encode(),
    ).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload}.sig"


class CredentialLineTests(unittest.TestCase):
    def test_full_account(self) -> None:
        line = xc.credential_line({
            "nickname": "小蚕号", "remark": "备注名",
            "xc_user_id": "8002", "account_info": "900123", "access_token": "a.b.c",
        })
        self.assertEqual(line, "备注名#8002#900123#a.b.c")

    def test_user_id_falls_back_to_token(self) -> None:
        line = xc.credential_line({
            "nickname": "小蚕号", "xc_user_id": "", "account_info": "900123",
            "access_token": make_jwt(8002),
        })
        self.assertTrue(line.startswith("小蚕号#8002#900123#"), line)

    def test_label_falls_back_to_silk_tail(self) -> None:
        line = xc.credential_line({
            "account_info": "900123", "xc_user_id": "8002", "access_token": "a.b.c",
        })
        self.assertTrue(line.startswith("0123#8002#900123#"), line)

    def test_missing_token_rejected(self) -> None:
        with self.assertRaises(ValueError):
            xc.credential_line({"xc_user_id": "8002", "account_info": "900123"})

    def test_missing_silk_rejected(self) -> None:
        with self.assertRaises(ValueError):
            xc.credential_line({"xc_user_id": "8002", "access_token": "a.b.c"})

    def test_unknown_user_id_rejected(self) -> None:
        with self.assertRaises(ValueError):
            xc.credential_line({
                "xc_user_id": "", "account_info": "900123", "access_token": "not-a-jwt",
            })


if __name__ == "__main__":
    unittest.main()
