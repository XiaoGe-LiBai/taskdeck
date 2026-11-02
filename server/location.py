"""位置服务：地址搜索、逆地理、IP 归属地。

对齐开源版的行为，但只用 `requests`（本项目后端是同步 Flask，不引入 httpx/asyncio）：
- 地址搜索 / 逆地理优先走天地图 Web API，key 由管理员在「系统设置」里填，
  普通用户**不接触 key**，所有请求都从后端代理；
- 没有 key、或天地图异常时降级：逆地理走 BigDataCloud，搜索走内置城市表；
- 平台真正吃的是 `city_code`（行政区划码）+ 经纬度，所以任何一条通道都要尽量把
  city_code 补齐，补不上就返回 0，由前端提示用户手动确认。

小蚕的定位不落库：一次定位只随请求传递（附近店铺 / 抢单 / 监控 / 资产工作台）。
"""
from __future__ import annotations

import json
import urllib.request

import requests

import core

TIANDITU_GEOCODER_URL = "http://api.tianditu.gov.cn/geocoder"
TIANDITU_SEARCH_URL = "http://api.tianditu.gov.cn/v2/search"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# 常用城市行政区划码（GB/T 2260），用于把城市名/区县码补成小蚕要的 city_code
CITY_CODE_MAP: dict[str, int] = {
    "北京": 110100, "北京市": 110100, "天津": 120100, "天津市": 120100,
    "上海": 310100, "上海市": 310100, "重庆": 500100, "重庆市": 500100,
    "武汉": 420100, "武汉市": 420100, "广州": 440100, "广州市": 440100,
    "深圳": 440300, "深圳市": 440300, "成都": 510100, "成都市": 510100,
    "杭州": 330100, "杭州市": 330100, "南京": 320100, "南京市": 320100,
    "西安": 610100, "西安市": 610100, "长沙": 430100, "长沙市": 430100,
    "郑州": 410100, "郑州市": 410100, "东莞": 441900, "东莞市": 441900,
    "佛山": 440600, "佛山市": 440600, "苏州": 320500, "苏州市": 320500,
    "合肥": 340100, "合肥市": 340100, "青岛": 370200, "青岛市": 370200,
    "昆明": 530100, "昆明市": 530100, "沈阳": 210100, "沈阳市": 210100,
    "大连": 210200, "大连市": 210200, "宁波": 330200, "宁波市": 330200,
    "福州": 350100, "福州市": 350100, "厦门": 350200, "厦门市": 350200,
    "哈尔滨": 230100, "哈尔滨市": 230100, "长春": 220100, "长春市": 220100,
    "南昌": 360100, "南昌市": 360100, "贵阳": 520100, "贵阳市": 520100,
    "南宁": 450100, "南宁市": 450100, "海口": 460100, "海口市": 460100,
    "乌鲁木齐": 650100, "乌鲁木齐市": 650100, "兰州": 620100, "兰州市": 620100,
    "呼和浩特": 150100, "呼和浩特市": 150100, "银川": 640100, "银川市": 640100,
    "西宁": 630100, "西宁市": 630100, "拉萨": 540100, "拉萨市": 540100,
}

# 城市中心点，用于「只选了城市、没有精确坐标」时兜底
CITY_COORDS: dict[int, tuple[str, str, str]] = {
    110100: ("北京", "116.407395", "39.904211"),
    120100: ("天津", "117.190182", "39.125596"),
    310100: ("上海", "121.473701", "31.230416"),
    500100: ("重庆", "106.551556", "29.563009"),
    420100: ("武汉", "114.305393", "30.593099"),
    440100: ("广州", "113.264385", "23.129112"),
    440300: ("深圳", "114.057868", "22.543099"),
    510100: ("成都", "104.066541", "30.572269"),
    330100: ("杭州", "120.155070", "30.274085"),
    320100: ("南京", "118.796877", "32.060255"),
    610100: ("西安", "108.939770", "34.341574"),
    430100: ("长沙", "112.938814", "28.228209"),
    410100: ("郑州", "113.665412", "34.757975"),
    441900: ("东莞", "113.751765", "23.020673"),
    440600: ("佛山", "113.122717", "23.028762"),
    320500: ("苏州", "120.585315", "31.298886"),
    340100: ("合肥", "117.283042", "31.861190"),
    370200: ("青岛", "120.382612", "36.067108"),
    530100: ("昆明", "102.833722", "24.881539"),
    210100: ("沈阳", "123.429096", "41.796767"),
    210200: ("大连", "121.618622", "38.914590"),
}


def tianditu_key() -> str:
    """管理员在系统设置里填的天地图 key；空字符串表示只走免费降级通道。"""
    return (core.get_setting("tianditu_key", "") or "").strip()


def city_code_of(name: str) -> int:
    clean = (name or "").strip()
    if not clean:
        return 0
    if clean in CITY_CODE_MAP:
        return CITY_CODE_MAP[clean]
    # 去掉行政区后缀再试一次：「深圳市南山区」→「深圳」
    for suffix in ("特别行政区", "自治州", "地区", "市", "区", "县", "省"):
        if clean.endswith(suffix) and len(clean) > len(suffix):
            trimmed = clean[: -len(suffix)]
            if trimmed in CITY_CODE_MAP:
                return CITY_CODE_MAP[trimmed]
            clean = trimmed
    return CITY_CODE_MAP.get(clean, 0)


def city_code_from_admin(admin_code: object) -> int:
    """6 位行政区划码 → 城市级 6 位（440303 → 440300）。"""
    raw = str(admin_code or "").strip()
    if len(raw) >= 4 and raw[:4].isdigit():
        return int(raw[:4] + "00")
    return 0


def nearest_city(lat: float, lon: float) -> tuple[int, str]:
    """没有 key 时的粗略兜底：取最近的已知城市（几十公里内才可信）。"""
    best_code, best_name, best_dist = 0, "", 1e18
    for code, (name, lng, la) in CITY_COORDS.items():
        dist = (float(lng) - lon) ** 2 + (float(la) - lat) ** 2
        if dist < best_dist:
            best_code, best_name, best_dist = code, name, dist
    # 0.5 度 ≈ 50km，超出就当没匹配上
    return (best_code, best_name) if best_dist <= 0.25 else (0, "")


def _get_json(url: str, params: dict, timeout: float = 5.0):
    resp = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def resolve(lat: float, lon: float) -> dict:
    """逆地理：经纬度 → 城市、地址。天地图优先，失败降级 BigDataCloud。"""
    key = tianditu_key()
    if key:
        try:
            data = _get_json(
                TIANDITU_GEOCODER_URL,
                {"postStr": json.dumps({"lon": lon, "lat": lat, "ver": 1}), "type": "geocode", "tk": key},
            )
            if str(data.get("status")) == "0":
                comp = (data.get("result") or {}).get("addressComponent") or {}
                province = str(comp.get("province") or "")
                city = str(comp.get("city") or "") or province
                city_name = city.replace("市", "").strip()
                district = str(comp.get("county") or "")
                code = city_code_from_admin(comp.get("county_code") or comp.get("city_code")) or city_code_of(city_name)
                address = str((data.get("result") or {}).get("formatted_address") or "")
                return {
                    "ok": True,
                    "city_code": code,
                    "city_name": city_name or "未知",
                    "province": province,
                    "district": district,
                    "address_name": address or (f"{city_name} · {district}" if district else city_name),
                    "latitude": f"{lat:.6f}",
                    "longitude": f"{lon:.6f}",
                    "source": "tianditu",
                }
        except Exception:
            pass

    # 降级：BigDataCloud 免费逆地理（只给到城市/区，够补 city_code）
    try:
        data = _get_json(
            "https://api.bigdatacloud.net/data/reverse-geocode-client",
            {"latitude": lat, "longitude": lon, "localityLanguage": "zh"},
            timeout=4.0,
        )
        raw_city = str(data.get("city") or data.get("locality") or "").strip()
        city_name = raw_city.replace("市", "")
        locality = str(data.get("locality") or "")
        code = city_code_of(city_name)
        return {
            "ok": True,
            "city_code": code,
            "city_name": city_name or "未知",
            "province": str(data.get("principalSubdivision") or ""),
            "district": locality,
            "address_name": f"{city_name} · {locality}" if locality and city_name else (city_name or "定位点"),
            "latitude": f"{lat:.6f}",
            "longitude": f"{lon:.6f}",
            "source": "fallback",
        }
    except Exception:
        pass

    code, name = nearest_city(lat, lon)
    return {
        "ok": bool(code),
        "city_code": code,
        "city_name": name or "未知",
        "province": "",
        "district": "",
        "address_name": f"{name}附近" if name else "未识别的坐标",
        "latitude": f"{lat:.6f}",
        "longitude": f"{lon:.6f}",
        "source": "estimate",
    }


def _candidate(poi: dict, fallback_city: str = "") -> dict | None:
    lonlat = str(poi.get("lonlat") or "").split(",")
    if len(lonlat) != 2:
        return None
    lon, lat = lonlat[0].strip(), lonlat[1].strip()
    try:
        float(lon), float(lat)
    except ValueError:
        return None
    name = str(poi.get("name") or "").strip()
    address = str(poi.get("address") or "").strip()
    city_name = str(poi.get("cityName") or fallback_city or "").replace("市", "")
    code = city_code_of(city_name)
    return {
        "city_code": code,
        "city_name": city_name or "未知",
        "district_name": str(poi.get("countyName") or ""),
        "poi": name,
        "short_name": name or address,
        "full_address": address or name,
        "latitude": lat,
        "longitude": lon,
        "source": "tianditu",
    }


def search(keyword: str, limit: int = 10) -> list[dict]:
    """地址/商圈/地标检索，返回候选列表；没有 key 时只用内置城市表。"""
    clean = (keyword or "").strip()
    if not clean:
        return []

    key = tianditu_key()
    if key:
        try:
            post = {
                "keyWord": clean,
                "level": 12,
                "mapBound": "73.0,18.0,135.0,54.0",
                "queryType": 1,
                "start": 0,
                "count": max(1, min(limit, 20)),
            }
            data = _get_json(
                TIANDITU_SEARCH_URL,
                {"postStr": json.dumps(post), "type": "query", "tk": key},
                timeout=7.0,
            )
            items: list[dict] = []
            area = data.get("area") or {}
            if str(area.get("lonlat") or "").count(",") == 1:
                lon, lat = [part.strip() for part in str(area["lonlat"]).split(",")]
                area_name = str(area.get("name") or clean)
                items.append({
                    "city_code": city_code_from_admin(area.get("adminCode")) or city_code_of(area_name),
                    "city_name": area_name.replace("市", ""),
                    "district_name": area_name if ("区" in area_name or "县" in area_name) else "",
                    "poi": area_name,
                    "short_name": area_name,
                    "full_address": f"{area_name}（行政区）",
                    "latitude": lat,
                    "longitude": lon,
                    "source": "tianditu",
                })
            for poi in (data.get("pois") or [])[:limit]:
                cand = _candidate(poi, clean)
                if cand:
                    items.append(cand)
            if items:
                return items
        except Exception:
            pass

    # 降级：内置城市表（输入城市名就返回该城市中心点）
    code = city_code_of(clean)
    if code and code in CITY_COORDS:
        name, lon, lat = CITY_COORDS[code]
        return [{
            "city_code": code,
            "city_name": name,
            "district_name": "",
            "poi": clean,
            "short_name": f"{name} · {clean}",
            "full_address": f"{name}市 {clean}",
            "latitude": lat,
            "longitude": lon,
            "source": "preset",
        }]
    return []


def ip_location() -> dict:
    """IP 归属地兜底定位：给城市 + 城市中心坐标，拿不到就返回 ok=False。"""
    try:
        req = urllib.request.Request(
            "https://whois.pconline.com.cn/ipJson.jsp?json=true",
            headers={"User-Agent": UA},
        )
        raw = urllib.request.urlopen(req, timeout=4).read().decode("gbk", errors="ignore")
        data = json.loads(raw)
        city = str(data.get("city") or "").replace("市", "")
        code = int(data["cityCode"]) if str(data.get("cityCode") or "").isdigit() else city_code_of(city)
        if not code and city:
            code = city_code_of(city)
        if code in CITY_COORDS:
            name, lon, lat = CITY_COORDS[code]
            return {
                "ok": True,
                "city_code": code,
                "city_name": name,
                "address_name": str(data.get("addr") or f"{name}网络定位"),
                "latitude": lat,
                "longitude": lon,
                "source": "ip",
            }
    except Exception:
        pass
    return {"ok": False, "city_code": 0, "city_name": "", "address_name": "", "source": "ip"}
