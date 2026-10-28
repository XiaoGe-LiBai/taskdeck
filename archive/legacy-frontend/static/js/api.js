// ============ API 客户端 ============
window.Api = (function () {
  const BASE = "/api";
  function getToken() {
    return localStorage.getItem("access_token") || "";
  }
  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const tok = getToken();
    if (tok) headers["Authorization"] = "Bearer " + tok;
    const opt = { method, headers };
    if (body !== undefined) opt.body = JSON.stringify(body);
    let resp;
    try {
      resp = await fetch(BASE + path, opt);
    } catch (e) {
      throw { code: 0, msg: "网络连接失败" };
    }
    let data = {};
    try { data = await resp.json(); } catch (e) { data = { code: resp.status, msg: "响应解析失败" }; }
    if (resp.status === 401 || data.code === 401) {
      // 登录失效
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      if (location.hash !== "#/login" && location.pathname !== "/login") {
        Toast && Toast.show("登录已失效，请重新登录");
        setTimeout(() => { location.hash = "#/login"; }, 600);
      }
      throw data;
    }
    if (data.code && data.code !== 200) {
      throw data;
    }
    return data.data;
  }
  return {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    put: (p, b) => request("PUT", p, b),
    del: (p) => request("DELETE", p),
    token: getToken,
  };
})();
