// ============ 应用入口 ============
const { createApp } = Vue;
const { createRouter, createWebHashHistory } = VueRouter;

function registerComponents(app) {
  for (const [name, comp] of Object.entries(window.UI)) {
    // CamelCase -> kebab-case（如 TabBar -> app-tab-bar, NavBar -> app-nav-bar）
    const kebab = name.replace(/^App/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    app.component("app-" + kebab, comp);
  }
}

const routes = [
  { path: "/login", component: Views.LoginView, meta: { public: true } },
  { path: "/register", component: Views.RegisterView, meta: { public: true } },
  { path: "/reset", component: Views.ResetView, meta: { public: true } },
  { path: "/home", component: Views.HomeView },
  { path: "/accounts", component: Views.AccountsView },
  { path: "/profile", component: Views.ProfileView },
  { path: "/points", component: Views.PointsView },
  { path: "/billing", component: Views.BillingView },
  { path: "/invite", component: Views.InviteView },
  { path: "/card-purchase", component: Views.CardPurchaseView },
  { path: "/lottery", component: Views.LotteryView },
  { path: "/check-in", component: Views.CheckInView },
  { path: "/bind", component: Views.BindView },
  {
    path: "/admin", component: Admin.Layout, meta: { admin: true },
    children: [
      { path: "", component: Admin.Dashboard },
      { path: "platforms", component: Admin.Platforms },
      { path: "coupons", component: Admin.Coupons },
      { path: "cards", component: Admin.Cards },
      { path: "products", component: Admin.Products },
      { path: "accounts", component: Admin.Accounts },
      { path: "account-data", component: Admin.AccountData },
      { path: "users", component: Admin.Users },
      { path: "announcements", component: Admin.Announcements },
      { path: "xiaocan-tasks", component: Admin.XiaocanTasks },
      { path: "task-logs", component: Admin.TaskLogs },
      { path: "ql", component: Admin.QLPanels },
      { path: "settings", component: Admin.Settings },
    ],
  },
  { path: "/", redirect: "/home" },
  { path: "/:pathMatch(.*)*", redirect: "/home" },
];

const router = createRouter({ history: createWebHashHistory(), routes });

// Keep navigation in one place so every page uses Vue Router instead of
// relying on implicit browser globals inside runtime-compiled templates.
window.AppRouter = router;
window.navigateTo = function (path) {
  const target = path.startsWith("/") ? path : "/" + path;
  return router.push(target).catch(() => undefined);
};

// Reliable back navigation for pages opened directly or restored from a
// browser tab where the history state's `back` field is unavailable.
window.navigateBack = function (fallback = "/home") {
  const before = router.currentRoute.value.fullPath;
  try {
    router.back();
    window.setTimeout(() => {
      if (router.currentRoute.value.fullPath === before) window.navigateTo(fallback);
    }, 180);
  } catch (_) {
    window.navigateTo(fallback);
  }
};

router.beforeEach((to) => {
  const auth = getAuth();
  const loggedIn = auth.loggedIn;
  if (to.meta.public) {
    if (loggedIn && (to.path === "/login" || to.path === "/register")) return "/home";
    return true;
  }
  if (!loggedIn) return "/login";
  if (to.meta.admin && !auth.isAdmin) return "/home";
  return true;
});

const app = createApp({ template: "<router-view/>" });
app.use(router);
registerComponents(app);
app.mount("#app");

window.addEventListener("unhandledrejection", (e) => {
  if (e.reason && e.reason.msg) Toast.show(e.reason.msg);
});
