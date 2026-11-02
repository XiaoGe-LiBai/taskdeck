"""位置服务单测：城市码换算、无 key 降级、逆地理与检索的兜底分支。

    python3 test_location.py
"""
from __future__ import annotations

import unittest
from unittest import mock

import location

CITY = location.CITY_COORDS[440300]  # 深圳


class CityCodeTests(unittest.TestCase):
    def test_city_name_variants(self) -> None:
        self.assertEqual(location.city_code_of("深圳"), 440300)
        self.assertEqual(location.city_code_of("深圳市"), 440300)
        self.assertEqual(location.city_code_of("南山区"), 0, "区名不在表里就不猜")

    def test_admin_code_rolls_up_to_city(self) -> None:
        self.assertEqual(location.city_code_from_admin("440303"), 440300)
        self.assertEqual(location.city_code_from_admin(440303), 440300)
        self.assertEqual(location.city_code_from_admin(""), 0)

    def test_nearest_city_within_threshold(self) -> None:
        code, name = location.nearest_city(float(CITY[2]), float(CITY[1]))
        self.assertEqual((code, name), (440300, "深圳"))
        far_code, _ = location.nearest_city(0.0, 0.0)
        self.assertEqual(far_code, 0, "离所有已知城市都太远时不硬猜")


class SearchTests(unittest.TestCase):
    def test_preset_city_without_key(self) -> None:
        with mock.patch.object(location, "tianditu_key", return_value=""):
            items = location.search("广州")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["city_code"], 440100)
        self.assertEqual(items[0]["source"], "preset")

    def test_unknown_keyword_returns_empty(self) -> None:
        with mock.patch.object(location, "tianditu_key", return_value=""):
            self.assertEqual(location.search("不存在的地名xyz"), [])

    def test_tianditu_failure_falls_back_to_preset(self) -> None:
        with mock.patch.object(location, "tianditu_key", return_value="k"), \
             mock.patch.object(location, "_get_json", side_effect=RuntimeError("boom")):
            items = location.search("深圳")
        self.assertEqual(items[0]["source"], "preset")


class ResolveTests(unittest.TestCase):
    def test_fallback_chain_when_everything_fails(self) -> None:
        with mock.patch.object(location, "tianditu_key", return_value=""), \
             mock.patch.object(location.requests, "get", side_effect=RuntimeError("no net")):
            out = location.resolve(float(CITY[2]), float(CITY[1]))
        self.assertTrue(out["ok"])
        self.assertEqual(out["city_code"], 440300)
        self.assertEqual(out["source"], "estimate")

    def test_tianditu_success_uses_admin_code(self) -> None:
        payload = {
            "status": "0",
            "result": {
                "formatted_address": "广东省深圳市福田区某路",
                "addressComponent": {
                    "province": "广东省", "city": "深圳市", "county": "福田区",
                    "county_code": "440304",
                },
            },
        }
        with mock.patch.object(location, "tianditu_key", return_value="k"), \
             mock.patch.object(location, "_get_json", return_value=payload):
            out = location.resolve(22.54, 114.05)
        self.assertEqual(out["city_code"], 440300)
        self.assertEqual(out["city_name"], "深圳")
        self.assertEqual(out["source"], "tianditu")


if __name__ == "__main__":
    unittest.main()
