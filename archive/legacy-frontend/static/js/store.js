// ============ 状态管理（基于 Vue reactive，无需 Pinia） ============
(function () {
  const { reactive } = Vue;

  const state = reactive({ user: JSON.parse(localStorage.getItem("user") || "null") });

  const authStore = {
    get user() { return state.user; },
    get loggedIn() { return !!localStorage.getItem("access_token"); },
    get isAdmin() { return !!(state.user && state.user.role === "admin"); },
    get balance() { return state.user ? state.user.points_balance : 0; },
    setToken(tok) { localStorage.setItem("access_token", tok); },
    setUser(u) { state.user = u; localStorage.setItem("user", JSON.stringify(u)); },
    async login(email, password) {
      const d = await Api.post("/auth/login", { email, password });
      this.setToken(d.access_token);
      this.setUser(d.user);
      return d.user;
    },
    async register(payload) {
      const d = await Api.post("/auth/register", payload);
      this.setToken(d.access_token);
      this.setUser(d.user);
      return d.user;
    },
    async loadProfile() {
      const u = await Api.get("/auth/profile");
      this.setUser(u);
      return u;
    },
    async logout() {
      try { await Api.post("/auth/logout", {}); } catch (e) {}
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
      state.user = null;
    },
    updateBalance(b) {
      if (state.user) { state.user.points_balance = b; localStorage.setItem("user", JSON.stringify(state.user)); }
    },
  };

  window.getAuth = function () { return authStore; };
})();
