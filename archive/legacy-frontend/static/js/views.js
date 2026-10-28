// ============ 用户端视图 ============
(function () {
const { ref, reactive, computed, onMounted, onUnmounted, watch } = Vue;
const pts = (v) => ((Number(v) || 0) / 100).toFixed(2);
const Views = {};

// ---------- 登录 ----------
Views.LoginView = {
  setup() {
    const auth = getAuth();
    const form = reactive({ email: "", password: "", remember: true });
    const loading = ref(false); const unavailable = ref(false);
    function reloadPage() { window.location.reload(); }
    async function submit() {
      if (!form.email || !form.password) return Toast.show("请输入邮箱和密码");
      loading.value = true;
      try {
        const u = await auth.login(form.email, form.password);
        Toast.show("登录成功");
        setTimeout(() => window.navigateTo(u.role === "admin" ? "admin" : "home"), 500);
      } catch (e) { if (e && (e.code === 404 || e.status === 404)) unavailable.value = true; else Toast.show(e.msg || "登录失败"); }
      finally { loading.value = false; }
    }
    return { form, loading, submit, unavailable, reloadPage };
  },
  template: `<div v-if="unavailable" class="app-shell" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px 24px;min-height:100vh;background:#fff;color:#555"><div style="font-size:54px;line-height:1;margin-bottom:24px">📄</div><div style="font-size:24px;font-weight:600;color:#333;margin-bottom:14px">该网页无法正常运作</div><div style="font-size:14px;margin-bottom:14px">8.149.132.0 目前无法处理此请求。</div><div style="font-size:13px;margin-bottom:28px">HTTP ERROR 404</div><button class="btn btn-primary" @click="reloadPage">重新加载</button></div><div v-else class="app-shell auth-shell" style="display:flex;flex-direction:column;justify-content:center;padding:40px 24px;min-height:100vh;background:linear-gradient(160deg,#fff3e6 0%,#f5f6f8 45%)">
    <div style="text-align:center;margin-bottom:28px">
      <img src="/assets/panel-logo.png?v=1" style="width:64px;height:64px;margin:0 auto 12px;border-radius:50%;object-fit:cover;box-shadow:var(--shadow)"/>
      <div class="muted mt8">是的，我又中了</div>
    </div>
    <div style="font-size:18px;font-weight:600;margin-bottom:4px">登录账号</div>
    <div class="muted mb12">使用注册邮箱继续</div>
    <div class="field"><div class="field-label">邮箱</div><input class="field-input" v-model="form.email" placeholder="请输入邮箱" type="email"/></div>
    <div class="field"><div class="field-label">*密码</div><input class="field-input" v-model="form.password" placeholder="请输入密码" type="password"/></div>
    <label class="switch" style="margin:6px 2px 14px"><input type="checkbox" v-model="form.remember"/><span class="track"></span><span class="muted" style="margin-left:8px">记住密码</span></label>
    <div><button class="btn btn-primary btn-block btn-lg" :disabled="loading" @click="submit">{{loading?'登录中...':'登录'}}</button></div>
    <div class="row-between mt12" style="font-size:13px;color:var(--text-2)">
      <a href="#/register">注册账号</a><a href="#/reset" style="color:var(--text-3)">忘记密码</a>
    </div>
  </div>`,
};

// ---------- 注册 ----------
Views.RegisterView = {
  setup() {
    const auth = getAuth();
    const form = reactive({ email: "", code: "", nickname: "", password: "", confirmPassword: "", invite_code: "" });
    const loading = ref(false); const codeSending = ref(false); const codeTimer = ref(0);
    let ti = null;
    async function sendCode() {
      if (!form.email) return Toast.show("请输入邮箱");
      codeSending.value = true;
      try { await Api.post("/auth/register/code", { email: form.email }); Toast.show("验证码已发送"); codeTimer.value = 60;
        ti = setInterval(() => { codeTimer.value--; if (codeTimer.value <= 0) clearInterval(ti); }, 1000); }
      catch (e) { Toast.show(e.msg || "发送失败"); }
      finally { codeSending.value = false; }
    }
    async function submit() {
      if (!form.email || !form.password) return Toast.show("请填写邮箱和密码");
      if (form.password.length < 8) return Toast.show("密码至少 8 位");
      if (form.password !== form.confirmPassword) return Toast.show("两次输入的密码不一致");
      loading.value = true;
      try { await auth.register(form); Toast.show("注册成功，已自动登录"); setTimeout(() => window.navigateTo("home"), 600); }
      catch (e) { Toast.show(e.msg || "注册失败"); }
      finally { loading.value = false; }
    }
    onUnmounted(() => { if (ti) clearInterval(ti); });
    return { form, loading, codeSending, codeTimer, sendCode, submit };
  },
  template: `<div class="app-shell auth-shell" style="padding:24px;min-height:100vh">
    <app-nav-bar title="注册账号"/>
    <div style="text-align:center;margin:20px 0 24px"><img src="/assets/panel-logo.png?v=1" style="width:54px;height:54px;border-radius:50%;object-fit:cover"/></div>
    <div class="field"><div class="field-label">邮箱</div><input class="field-input" v-model="form.email" placeholder="请输入邮箱" type="email"/></div>
    <div class="field-row mb12"><div class="field" style="flex:1"><div class="field-label">验证码</div><input class="field-input" v-model="form.code" placeholder="6 位验证码"/></div>
      <button class="btn btn-plain btn-sm" :disabled="codeSending||codeTimer>0" @click="sendCode">{{codeTimer>0?codeTimer+'s':'发送验证码'}}</button></div>
    <div class="field"><div class="field-label">昵称</div><input class="field-input" v-model="form.nickname" placeholder="怎么称呼你"/></div>
    <div class="field"><div class="field-label">*密码</div><input class="field-input" v-model="form.password" placeholder="至少 8 位" type="password"/></div>
    <div class="field"><div class="field-label">*确认密码</div><input class="field-input" v-model="form.confirmPassword" placeholder="请再次输入密码" type="password"/></div>
    <div class="field"><div class="field-label">邀请码</div><input class="field-input" v-model="form.invite_code" placeholder="6 位邀请码（选填）"/></div>
    <div class="mt12"><button class="btn btn-primary btn-block btn-lg" :disabled="loading" @click="submit">{{loading?'创建中...':'创建账号'}}</button></div>
    <div class="center mt12"><a href="#/login" style="font-size:13px;color:var(--text-2)">已有账号，去登录</a></div>
  </div>`,
};

// ---------- 重置密码 ----------
Views.ResetView = {
  setup() {
    const email = ref(""); const loading = ref(false);
    async function submit() {
      if (!email.value) return Toast.show("请输入邮箱");
      loading.value = true;
      try { await Api.post("/auth/reset-password", { email: email.value }); Dialog.alert("已发送", "重置链接已发送到邮箱（演示版）。"); }
      catch (e) { Toast.show(e.msg || "发送失败"); }
      finally { loading.value = false; }
    }
    return { email, loading, submit };
  },
  template: `<div class="app-shell auth-shell" style="padding:24px;min-height:100vh">
    <app-nav-bar title="重置密码"/>
    <div class="muted mt12" style="padding:0 4px">我们会向你的邮箱发送重置链接</div>
    <div class="field mt12"><div class="field-label">*邮箱</div><input class="field-input" v-model="email" placeholder="清输入邮箱"/></div>
    <div class="mt12"><button class="btn btn-primary btn-block btn-lg" :disabled="loading" @click="submit">{{loading?'发送中...':'发送邮件'}}</button></div>
    <div class="center mt12"><a href="#/login" style="font-size:13px;color:var(--text-2)">返回登录</a></div>
  </div>`,
};

// ---------- 首页 ----------
Views.HomeView = {
  setup() {
    const auth = getAuth();
    const billing = reactive({ points_balance: 0, accounts: [] });
    const checkin = reactive({ total_days: 0, checked_in_today: false });
    const ann = ref(null); const showAnn = ref(false); const noShow = ref(false);
    function announcementDismissKey(a) {
      const email = (auth.user?.email || "guest").toLowerCase();
      // Include updated_time so editing an existing announcement invalidates a
      // previous "today do not notify" dismissal even if a client cached its
      // older version value.
      const revision = a.updated_time || a.published_time || a.version || "0";
      return "ann_dismissed_" + email + "_v" + a.version + "_r" + revision;
    }
    async function load() {
      // Clear any previous route instance before fetching so returning from
      // admin pages cannot leave stale announcement content on screen.
      ann.value = null; showAnn.value = false;
      try {
        await auth.loadProfile();
        const b = await Api.get("/billing/status");
        Object.assign(billing, b);
        const ck = await Api.get("/points/check-in");
        Object.assign(checkin, ck);
      } catch (e) {}
      // 公告（按版本号判断，改了公告会重新弹出）
      try {
        const a = await Api.get("/announcements/latest?_=" + Date.now());
        const dismissedAt = a ? Number(localStorage.getItem(announcementDismissKey(a)) || 0) : 0;
        const withinSevenDays = dismissedAt > 0 && (Date.now() - dismissedAt) < 7 * 24 * 60 * 60 * 1000;
        if (a && !withinSevenDays) {
          ann.value = a; noShow.value = false; showAnn.value = true;
        }
      } catch (e) {}
    }
    function dismissAnn() {
      if (noShow.value && ann.value) localStorage.setItem(announcementDismissKey(ann.value), String(Date.now()));
      showAnn.value = false;
    }
    const quick = [
      { icon: "💳", text: "卡密购买", to: "card-purchase" },
      { icon: "💳", text: "卡密兑换", to: "points" },
      { icon: "🔗", text: "绑定账号", to: "bind" },
      { icon: "🎁", text: "我要上车", to: "billing" },
    ];
    function go(t) { window.navigateTo(t); }
    onMounted(load);
    return { auth, billing, checkin, ann, showAnn, noShow, quick, go, dismissAnn, pts };
  },
  template: `<div class="app-shell">
    <div class="navbar"><div class="brand"><img src="/assets/panel-logo.png?v=1" class="logo"/>我中了</div></div>
    <div class="page">
      <h1 style="font-size:19px;font-weight:700;margin:4px 2px 2px">你好，{{auth.user?.nickname || '用户'}}</h1>
      <div class="muted mb12" v-if="!billing.accounts.length">暂无有效权益</div>
      <div class="card" style="background:linear-gradient(135deg,#ff7a00,#ff9933);color:#fff;border:none">
        <div class="row-between"><div class="muted" style="color:rgba(255,255,255,.85)">已绑定账号</div><div style="font-weight:700">{{billing.accounts.length}}个</div></div>
        <div class="row-between mt12 home-balance-row">
          <div class="home-balance"><div class="muted" style="color:rgba(255,255,255,.85)">积分余额</div><div style="font-size:24px;font-weight:800">{{pts(billing.points_balance)}}</div></div>
          <a href="#/accounts" style="color:#fff;font-size:13px">管理账号 ›</a>
        </div>
      </div>
      <div class="card">
        <div class="section-title">快捷操作</div>
        <div class="quick-grid">
          <div class="quick-item" v-for="q in quick" :key="q.text" @click="go(q.to)"><div class="qi-icon">{{q.icon}}</div><div class="qi-text">{{q.text}}</div></div>
        </div>
      </div>
      <div class="card" style="padding:14px 16px;cursor:pointer" @click="go('check-in')">
        <div class="row-between">
          <div class="row gap12"><div style="font-size:22px">📅</div><div><div style="font-weight:600">每日签到</div><div class="muted">累计 {{checkin.total_days}} 天 · {{checkin.checked_in_today?'今日已签':'今日待签'}}</div></div></div>
          <div class="arrow">›</div>
        </div>
      </div>
    </div>
    <app-tab-bar active="home"/>
    <!-- 公告弹窗 -->
    <div v-if="showAnn" class="overlay" @click.self="dismissAnn"><div class="dialog" style="max-width:340px;max-height:80vh;display:flex;flex-direction:column">
      <div class="row-between" style="padding:14px 16px 8px"><div style="font-weight:600;font-size:16px">{{ann?.title}}</div><div @click="dismissAnn" style="cursor:pointer;color:var(--text-3)">✕</div></div>
      <div class="muted" style="padding:0 16px">{{ann?.published_time?.slice(0,16).replace('T',' ')}}</div>
      <div style="padding:8px 16px;overflow:auto;flex:1" v-html="ann?.content"></div>
      <label class="row gap8" style="padding:8px 16px"><input type="checkbox" v-model="noShow"/><span class="muted">近7日不再提示</span></label>
      <div style="padding:0 16px 14px"><button class="btn btn-primary btn-block" @click="dismissAnn">我知道了</button></div>
    </div></div>
  </div>`,
};

// ---------- 账号管理 ----------
Views.AccountsView = {
  setup() {
    const auth = getAuth();
    const signup = reactive({ show: false, account: null, tea_name: "", order_numbers: "", submitting: false });
    const accs = ref([]); const loading = ref(true); const kw = ref("");
    let countdownTimer = null;
    function fmtCountdown(exp) {
      if (!exp) return "—";
      const ms = new Date(exp).getTime() - Date.now();
      if (ms <= 0) return "已到期";
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
      return h + "小时" + m + "分钟" + s + "秒";
    }
    function startTimers() {
      if (countdownTimer) clearInterval(countdownTimer);
      const refresh = () => accs.value.forEach(a => { a._countdown = fmtCountdown(a.token_expire); });
      refresh();
      countdownTimer = setInterval(refresh, 1000);
    }
    const taskOrder = ["限量大牌券-代理版", "保底大牌券", "会员专属返利券", "每日签到", "元宝一键领取", "元宝抽奖", "影音周卡", "红包雨", "免单券", "双节抽礼"];
    function normalizeFeatures(account) {
      const source = account && account.features && typeof account.features === "object" ? account.features : {};
      account.features = Object.fromEntries(taskOrder.map(name => [name, source[name] === true || source[name] === 1 || source[name] === "1"]));
      return account;
    }
    async function load() {
      loading.value = true;
      try { await auth.loadProfile(); accs.value = (await Api.get("/xiaocan/accounts")).map(normalizeFeatures); startTimers(); }
      catch (e) {} finally { loading.value = false; }
    }
    async function toggleFeat(acc, name) {
      // 找coupon_type id (需要管理员配置的id; 这里通过名称无法直接拿id，用单独接口)
      try { const r = await Api.put("/xiaocan/accounts/" + acc.id + "/features/" + encodeURIComponent(name), {});
        acc.features = Object.assign(acc.features || {}, {[name]: !!r.value});
        Toast.show((r.value ? "已开启：" : "已关闭：") + name); }
      catch (e) { Toast.show(e.msg || "操作失败"); await load(); }
    }
    function openSignup(acc) { signup.account = acc; signup.tea_name = ""; signup.order_numbers = ""; signup.submitting = false; signup.show = true; }
    async function submitSignup() { if (!signup.tea_name.trim() || !signup.order_numbers.trim()) return; const esc = s => String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); const ok = await Dialog.confirm("确认报名信息", "账号：" + esc(signup.account.nickname || signup.account.account_info) + "<br>奶茶名：<span style='color:#d93025;font-weight:700'>" + esc(signup.tea_name.trim()) + "</span><br>订单号：<span style='color:#d93025;font-weight:700;word-break:break-all'>" + esc(signup.order_numbers.trim()) + "</span><br><br>请核对无误后再提交"); if (!ok) return; signup.submitting = true; try { const d = await Api.post("/xiaocan/accounts/" + signup.account.id + "/signup", { tea_name: signup.tea_name.trim(), order_numbers: signup.order_numbers.trim() }); signup.account.signup = { status: d.status || "pending", tea_name: signup.tea_name.trim(), order_numbers: signup.order_numbers.trim() }; signup.show = false; Toast.show("报名任务已立即提交"); } catch (e) { Toast.show(e.msg || "报名失败"); } finally { signup.submitting = false; } }
    async function renew(acc) {
      window.navigateTo("bind?update=" + acc.id);
    }
    async function del(acc) {
      if (!await Dialog.confirm("删除账号", "确认删除「" + acc.nickname + "」？")) return;
      try { await Api.del("/xiaocan/accounts/" + acc.id); Toast.show("已删除"); await load(); }
      catch (e) { Toast.show(e.msg); }
    }
    function activate(acc) { window.navigateTo("/billing?acc=" + acc.id); }
    function bindNewAccount() { window.navigateTo("bind"); }
    const taskMeta = {
      "限量大牌券-代理版": { icon: "/assets/xiaocan/brand.png", className: "brand" },
      "保底大牌券": { icon: "/assets/xiaocan/brand.png", className: "brand" },
      "会员专属返利券": { icon: "/assets/xiaocan/rebate.png", className: "rebate" },
      "每日签到": { icon: "/assets/xiaocan/checkin.png", className: "checkin" },
      "元宝一键领取": { icon: "/assets/xiaocan/yuanbao.png", className: "yuanbao" },
      "免单券": { icon: "/assets/xiaocan/free.png", className: "free", note: "SVIP5-6 / VIP6" },
      "元宝抽奖": { icon: "/assets/xiaocan/yuanbao.png", className: "yuanbao" },
      "会员周卡": { icon: "/assets/xiaocan/week.png", className: "week", note: "SVIP3-6 / VIP6" },
      "影音周卡": { icon: "/assets/xiaocan/week.png", className: "week", note: "SVIP3-6 / VIP6" },
      "红包雨": { icon: "/assets/xiaocan/rain.png", className: "rain" },
      "双节抽礼": { icon: "/assets/xiaocan/xiaocan-anniversary.png", className: "anniversary" },
    };
    function vipIcon(acc) { const level = Number(acc.vip_level || 0); return level >= 2 && level <= 6 ? "/assets/xiaocan/svip" + level + ".png" : ""; }
    const taskLabels = {
      "会员专属返利券": "返利券",
      "保底大牌券": "保底大牌",
      "元宝一键领取": "元宝领取",
      "元宝抽奖": "元宝抽奖",
      "免单券": "免单券",
      "影音周卡": "影音周卡",
      "每日签到": "每日签到",
      "红包雨": "红包雨",
      "限量大牌券-代理版": "限量大牌",
      "双节抽礼": "双节抽礼",
    };
    function taskLabel(name) { return taskLabels[name] || name; }
    const filtered = computed(() => accs.value.filter(a => !kw.value || (a.nickname + (a.account_info||"")).includes(kw.value)));
    onMounted(load); onUnmounted(() => { if (countdownTimer) clearInterval(countdownTimer); });
    const statusText = { enabled: "运行中", disabled: "已暂停" };
    return { auth, accs, filtered, kw, loading, signup, toggleFeat, renew, del, activate, bindNewAccount, openSignup, submitSignup, load, statusText, pts, daysLeft, taskMeta, taskLabel, taskOrder, vipIcon };
  },
  template: `<div class="app-shell">
    <div class="navbar"><div class="brand"><img src="/assets/panel-logo.png?v=1" class="logo"/>我的账号</div></div>
    <div class="page">
      <div class="field mb12"><input class="field-input" v-model="kw" placeholder="搜索账号"/></div>
      <article v-if="!loading" v-for="a in filtered" :key="a.id" class="account-panel">
        <div class="account-topline">
          <div class="account-avatar-wrap"><img class="account-avatar" :src="a.avatar || '/assets/panel-logo.png'" alt="小蚕头像"/></div>
          <div class="account-ident"><div class="account-nickname">{{a.nickname}}</div><div class="account-id">ID: {{a.account_info}}</div></div>
          <div class="account-status"><i :class="a.status==='enabled'?'running-dot':'paused-dot'"></i>{{statusText[a.status]}}</div>
        </div>
        <div class="account-summary">
          <div class="summary-cell"><div class="summary-label">抢券到期时间</div><div class="summary-expire" :class="{expired:!a.membership_expire}">{{a.membership_expire?a.membership_expire.slice(0,10).replaceAll('-','/'):'未设置'}}</div><div class="summary-time" v-if="a.membership_expire">{{a.membership_expire.slice(11,19)}}</div></div>
          <div class="summary-cell vip-cell"><div class="summary-label">会员等级</div><img v-if="vipIcon(a)" class="svip-badge" :src="vipIcon(a)" :alt="'SVIP'+a.vip_level"/><div v-else class="svip-text">SVIP{{a.vip_level || '—'}}</div></div>
        </div>
        <div class="account-meta"><div><span>绑定时间</span><b>{{a.bind_time?.slice(0,19).replace('T',' ')}}</b></div><div><span>账号数据到期</span><b :class="{warning: a._countdown==='已到期'}">{{a._countdown}}</b></div></div>
        <div class="task-title">操作任务</div>
        <div class="task-grid">
          <div class="task-tile" v-for="name in taskOrder" :key="name"><img class="task-image" :class="taskMeta[name]?.className" :src="taskMeta[name]?.icon" :alt="taskLabel(name)"/><div class="task-copy"><div>{{taskLabel(name)}}</div><small v-if="taskMeta[name]?.note">{{taskMeta[name].note}}</small></div><app-switch :model-value="!!a.features[name]" :disabled="!a.membership_expire" @update:modelValue="toggleFeat(a, name)"/></div>
        </div>
        <div class="signup-action"><div><b>大牌券报名</b><span class="muted">填写奶茶名称和订单号后立即执行</span></div><button class="btn btn-primary btn-sm" @click="openSignup(a)" :disabled="!a.membership_expire">立即报名</button></div>
        <app-redeem-picker v-if="a.redeem" :account-id="a.id" :model-value="a.redeem" @update:modelValue="v=>a.redeem=v"/>
        <div class="account-actionbar"><button class="btn btn-primary btn-sm" @click="activate(a)">我要上车</button><button class="btn btn-plain btn-sm" @click="renew(a)">更新数据</button><button class="btn btn-danger btn-sm" @click="del(a)">删除</button></div>
      </article>
      <app-empty v-if="!loading && !filtered.length" text="暂无绑定账号，去绑定吧"/>
      <div class="center mt12"><button type="button" class="btn btn-plain btn-sm" @click="bindNewAccount">+ 绑定新账号</button></div>
    </div>
    <div v-if="signup.show" class="overlay" @click.self="signup.show=false"><div class="dialog" style="max-width:420px;text-align:left"><div class="dlg-head">大牌券报名</div><div style="padding:14px 18px"><div class="muted mb8">账号：{{signup.account?.nickname}}（{{signup.account?.account_info}}）</div><div class="field"><div class="field-label">奶茶名称</div><input class="field-input" v-model="signup.tea_name" placeholder="例如：喜茶"/></div><div class="field"><div class="field-label">订单号</div><textarea class="field-input" rows="3" v-model="signup.order_numbers" placeholder="多个订单号用 # 分隔"></textarea></div></div><div class="dlg-foot"><button class="cancel" @click="signup.show=false">取消</button><button class="confirm" :disabled="signup.submitting || !signup.tea_name.trim() || !signup.order_numbers.trim()" @click="submitSignup">{{signup.submitting?'提交中…':'立即报名'}}</button></div></div></div>
    <app-tab-bar active="accounts"/>
  </div>`,
  methods: {},
};

function daysLeft(a) {
  if (!a.membership_expire) return 0;
  const ms = new Date(a.membership_expire).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 86400000));
}

// ---------- 卡密兑换 + 积分明细 ----------
Views.PointsView = {
  setup() {
    const auth = getAuth();
    const code = ref(""); const loading = ref(false);
    const txs = ref([]); const total = ref(0); const page = ref(1); const hasMore = ref(false);
    async function loadTxs(reset = true) {
      if (reset) { page.value = 1; txs.value = []; }
      try { const d = await Api.get("/points/transactions?page=" + page.value + "&size=20");
        txs.value = txs.value.concat(d.records || []); total.value = d.total; hasMore.value = txs.value.length < d.total; } catch (e) {}
    }
    async function redeem() {
      if (!code.value) return Toast.show("请输入卡密");
      loading.value = true;
      try { const d = await Api.post("/points/redeem", { code: code.value }); auth.updateBalance(d.balance);
        Toast.show("兑换成功 +" + pts(d.amount) + " 积分"); code.value = ""; await loadTxs(); }
      catch (e) { Toast.show(e.msg || "兑换失败"); }
      finally { loading.value = false; }
    }
    async function loadMore() { page.value++; await loadTxs(false); }
    const typeText = { redeem: "卡密兑换", daily_check_in: "每日签到", lottery_reward: "转盘中奖", lottery_cost: "转盘消耗", purchase: "购买消费", admin_adjust: "管理员调整", invite_reward: "邀请奖励" };
    onMounted(async () => { await auth.loadProfile(); await loadTxs(); });
    return { auth, code, loading, txs, total, hasMore, redeem, loadMore, typeText, pts };
  },
  template: `<div class="app-shell" style="min-height:100vh">
    <app-nav-bar title="积分中心"/>
    <div class="page">
      <div class="card center" style="background:linear-gradient(135deg,#ff7a00,#ff9933);color:#fff;border:none">
        <div class="muted" style="color:rgba(255,255,255,.85)">积分余额</div><div class="balance-big" style="color:#fff">{{pts(auth.balance)}}</div>
        <div class="muted" style="color:rgba(255,255,255,.85)">可用于激活会员权益</div>
      </div>
      <div class="card">
        <div class="section-title">💳 卡密兑换</div>
        <div class="field-row"><input class="field-input" v-model="code" placeholder="请输入积分卡密" style="flex:1"/><button class="btn btn-primary btn-sm" :disabled="loading" @click="redeem">兑换</button></div>
        <div class="muted mt8">输入管理员发放的卡密，兑换后积分立即到账</div>
      </div>
      <div class="section-title">积分明细 · {{total}} 条</div>
      <div class="card" v-if="txs.length" style="padding:0 16px">
        <div class="cell" v-for="t in txs" :key="t.id">
          <div class="cell-main"><div class="cell-title">{{typeText[t.type] || t.type}}</div><div class="cell-sub">{{t.note}} · {{t.created_time.slice(0,16).replace('T',' ')}}</div></div>
          <div :style="{color: t.amount>=0?'var(--success)':'var(--danger)',fontWeight:700}">{{t.amount>=0?'+':''}}{{pts(t.amount)}}</div>
        </div>
        <div class="center mt12 mb12" v-if="hasMore"><button class="btn btn-plain btn-sm" @click="loadMore">加载更多</button></div>
      </div>
      <app-empty v-else text="暂无积分明细"/>
    </div>
  </div>`,
};

// ---------- 我的权益 ----------
Views.BillingView = {
  setup() {
    const auth = getAuth();
    const b = reactive({ accounts: [], points_balance: 0, brand_coupon_rate_bps: 6500 });
    const products = ref([]); const selAcc = ref(null); const showBuy = ref(false); const buyPid = ref(null);
    async function load() {
      try { await auth.loadProfile(); const d = await Api.get("/billing/status"); Object.assign(b, d);
        if (b.accounts.length) selAcc.value = b.accounts[0].id; } catch (e) {}
    }
    async function openBuy() {
      try { const d = await Api.get("/points/summary"); products.value = d.products.filter(p => p.product_type === "membership"); showBuy.value = true; buyPid.value = products.value[0]?.id; }
      catch (e) { Toast.show(e.msg); }
    }
    async function buy() {
      try { const d = await Api.post("/points/purchase", { product_id: buyPid.value, account_id: selAcc.value });
        auth.updateBalance(d.balance); Toast.show("购买成功，余额 " + pts(d.balance)); showBuy.value = false; await load(); }
      catch (e) { Toast.show(e.msg || "购买失败"); }
    }
    onMounted(load);
    return { b, products, selAcc, showBuy, buyPid, openBuy, buy, pts };
  },
  template: `<div class="app-shell" style="min-height:100vh">
    <app-nav-bar title="我的权益"/>
    <div class="page">
      <div class="card center" style="background:linear-gradient(135deg,#ff7a00,#ff9933);color:#fff;border:none">
        <div class="muted" style="color:rgba(255,255,255,.85)">可用积分</div><div class="balance-big" style="color:#fff">{{pts(b.points_balance)}}</div>
      </div>
      <div class="section-title">账号权益</div>
      <div class="card" v-for="a in b.accounts" :key="a.id">
        <div class="row-between"><div style="font-weight:600">{{a.nickname}}</div><span :class="'tag tag-'+(a.status==='enabled'?'success':'gray')">{{a.status==='enabled'?'运行中':'已暂停'}}</span></div>
        <div class="muted mt8">{{a.remaining_days}} 天 · {{a.membership_expire?a.membership_expire.slice(0,10):'尚未激活抢券权益'}}</div>
      </div>
      <app-empty v-if="!b.accounts.length" text="暂无绑定账号"/>
      <div class="mt12"><button class="btn btn-primary btn-block btn-lg" @click="openBuy">积分购买会员</button></div>
    </div>
    <!-- 购买弹窗 -->
    <div v-if="showBuy" class="overlay" @click.self="showBuy=false"><div class="dialog" style="max-width:340px;text-align:left">
      <div class="dlg-head" style="text-align:center">购买套餐</div>
      <div style="padding:12px 18px">
        <div class="field" v-if="b.accounts.length"><div class="field-label">选择账号</div>
          <select class="field-input" v-model="selAcc"><option v-for="a in b.accounts" :key="a.id" :value="a.id">{{a.nickname}}</option></select></div>
        <div class="field"><div class="field-label">选择套餐</div>
          <select class="field-input" v-model="buyPid"><option v-for="p in products" :key="p.id" :value="p.id">{{p.name}} ({{pts(p.points_price)}}积分)</option></select></div>
      </div>
      <div class="dlg-foot"><button class="cancel" @click="showBuy=false">取消</button><button class="confirm" @click="buy">确认购买</button></div>
    </div></div>
  </div>`,
};

// ---------- 卡密购买 ----------
Views.CardPurchaseView = {
  template: `<div class="app-shell"><app-nav-bar title="卡密购买" back="true"/><div style="height:calc(100vh - 48px);background:#fff;overflow:hidden"><iframe src="https://wzyp.cn/shop/WX2S0YWM" title="卡密购买" style="display:block;width:100%;height:100%;border:0" referrerpolicy="no-referrer-when-downgrade"></iframe></div></div>`,
};

// ---------- 邀请好友 ----------
Views.InviteView = {
  setup() {
    const auth = getAuth();
    const stats = ref({ total: 0 });
    const qrRef = ref(null);
    async function load() {
      try {
        await auth.loadProfile(); stats.value = await Api.get("/invite/stats");
        const c = auth.user?.invite_code;
        if (c && qrRef.value && window.QRCode) {
          qrRef.value.innerHTML = "";
          new QRCode(qrRef.value, { text: location.origin + "/#/register?invite=" + c, width: 168, height: 168, colorDark: "#222", colorLight: "#ffffff" });
        }
      } catch (e) {}
    }
    function copy() {
      const c = auth.user?.invite_code; if (!c) return;
      const link = location.origin + "/#/register?invite=" + c;
      navigator.clipboard?.writeText(link).then(() => Toast.show("邀请链接已复制")).catch(() => Toast.show(c));
    }
    onMounted(load);
    return { auth, stats, qrRef, copy };
  },
  template: `<div class="app-shell" style="min-height:100vh">
    <app-nav-bar title="邀请好友"/>
    <div class="page">
      <div class="card center" style="background:linear-gradient(135deg,#ff7a00,#ff9933);color:#fff;border:none;padding:24px">
        <div style="font-size:15px;margin-bottom:12px">分享你的专属邀请码</div>
        <div style="font-size:32px;font-weight:800;letter-spacing:2px">{{auth.user?.invite_code || '-'}}</div>
        <div class="muted mt8" style="color:rgba(255,255,255,.85)">已邀请 {{stats.total}} 人</div>
        <button class="btn btn-plain btn-sm mt12" @click="copy">点击复制邀请链接</button>
      </div>
      <div class="card center">
        <div ref="qrRef" style="display:inline-block;padding:8px;background:#fff;border-radius:8px;min-height:168px"></div>
        <div class="muted mt8">扫一扫或复制链接邀请好友注册</div>
      </div>
      <div class="card">
        <div class="section-title">邀请奖励规则</div>
        <div class="cell"><div class="cell-icon" style="color:var(--primary)">1</div><div class="cell-main">好友填写你的邀请码完成注册后，将成为你的直接下级</div></div>
        <div class="cell"><div class="cell-icon" style="color:var(--primary)">2</div><div class="cell-main">直接下级使用积分购买会员时，你可获得消费积分的 9% 奖励</div></div>
        <div class="cell"><div class="cell-icon" style="color:var(--primary)">3</div><div class="cell-main">奖励向下取整，并在下级购买成功后直接计入余额</div></div>
      </div>
    </div>
  </div>`,
};

// ---------- 积分转盘 ----------
Views.LotteryView = {
  setup() {
    const auth = getAuth();
    const data = reactive({ prizes: [], balance: 0, cost_points: 200, remaining_times: 30, records: [] });
    const spinning = ref(false); const wheelRef = ref(null);
    async function load() { try { await auth.loadProfile(); const d = await Api.get("/points/lottery"); Object.assign(data, d); } catch (e) {} }
    async function draw() {
      if (spinning.value) return;
      if (data.balance < data.cost_points) return Toast.show("积分不足");
      if (data.remaining_times <= 0) return Toast.show("今日次数已用完");
      spinning.value = true;
      try {
        const d = await Api.post("/points/lottery/draw", {});
        const idx = data.prizes.findIndex(p => p.name === d.prize.name);
        if (idx >= 0 && wheelRef.value) wheelRef.value.spinTo(idx);
        setTimeout(() => {
          auth.updateBalance(d.balance); data.balance = d.balance; data.remaining_times--;
          if (d.prize.reward_points > 0) Toast.show("🎉 中奖：" + d.prize.name + " +" + pts(d.prize.reward_points) + " 积分");
          else Toast.show("未中奖，再接再厉");
          data.records.unshift({ name: d.prize.name, reward_points: d.prize.reward_points, created_time: new Date().toISOString() });
          spinning.value = false;
        }, 4100);
      } catch (e) { spinning.value = false; Toast.show(e.msg || "抽奖失败"); }
    }
    onMounted(load);
    return { auth, data, spinning, wheelRef, draw, pts };
  },
  template: `<div class="app-shell" style="min-height:100vh">
    <app-nav-bar title="积分转盘"/>
    <div class="page">
      <div class="row-between mb12" style="font-size:14px"><div>余额 <b style="color:var(--primary)">{{pts(data.balance)}}</b></div><div>今日剩余 <b>{{data.remaining_times}}</b> 次</div></div>
      <div class="card center" style="padding:20px 16px">
        <app-wheel ref="wheelRef" :prizes="data.prizes" :spinning="spinning" @draw="draw"/>
        <div class="muted mt12">{{pts(data.cost_points)}} 积分/次</div>
      </div>
      <div class="card">
        <div class="section-title">概率详情</div>
        <div class="row-between" style="padding:6px 0;font-size:13px" v-for="p in data.prizes" :key="p.name">
          <div>{{p.name}} <span class="muted">{{(p.probability_bps/100).toFixed(2)}}%</span></div>
          <div style="color:var(--primary)">{{pts(p.reward_points)}} 积分</div>
        </div>
        <div class="row-between" style="padding:6px 0;font-size:13px"><div>未中奖 <span class="muted">{{(data.no_prize_probability_bps/100).toFixed(2)}}%</span></div><div class="muted">—</div></div>
      </div>
      <div class="section-title">最近抽奖记录</div>
      <div class="card" v-if="data.records.length" style="padding:0 16px">
        <div class="cell" v-for="(r,i) in data.records" :key="i"><div class="cell-main"><div class="cell-title">{{r.name}}</div><div class="cell-sub">{{r.created_time.slice(0,16).replace('T',' ')}}</div></div><div :style="{color:r.reward_points>0?'var(--success)':'var(--text-3)',fontWeight:600}">{{r.reward_points>0?'+'+pts(r.reward_points):'未中'}}</div></div>
      </div>
      <app-empty v-else text="暂无抽奖记录"/>
    </div>
  </div>`,
};

// ---------- 每日签到 ----------
Views.CheckInView = {
  setup() {
    const auth = getAuth();
    const data = reactive({ balance: 0, checked_in_today: false, total_days: 0, records: [] });
    const loading = ref(false);
    const now = new Date(); const year = ref(now.getFullYear()); const month = ref(now.getMonth() + 1);
    async function load() { try { await auth.loadProfile(); const d = await Api.get("/points/check-in"); Object.assign(data, d); } catch (e) {} }
    async function doCheckin() {
      if (data.checked_in_today) return;
      loading.value = true;
      try { const d = await Api.post("/points/check-in", {}); Object.assign(data, d); auth.updateBalance(d.balance); Toast.show("签到成功 +" + pts(d.reward) + " 积分"); }
      catch (e) { Toast.show(e.msg || "签到失败"); }
      finally { loading.value = false; }
    }
    function prevMonth() { let y = year.value, m = month.value - 1; if (m < 1) { m = 12; y--; } year.value = y; month.value = m; }
    function nextMonth() { let y = year.value, m = month.value + 1; if (m > 12) { m = 1; y++; } year.value = y; month.value = m; }
    onMounted(load);
    return { auth, data, loading, year, month, doCheckin, prevMonth, nextMonth, pts };
  },
  template: `<div class="app-shell" style="min-height:100vh">
    <app-nav-bar title="每日签到"/>
    <div class="page">
      <div class="card center" style="background:linear-gradient(135deg,#ff7a00,#ff9933);color:#fff;border:none;padding:24px">
        <div class="muted" style="color:rgba(255,255,255,.85)">DAILY REWARD</div>
        <div style="font-size:20px;font-weight:700;margin:6px 0">今天也要来签到</div>
        <div class="muted" style="color:rgba(255,255,255,.85);margin-bottom:14px">完成签到领取今日积分奖励</div>
        <div class="row gap20" style="justify-content:center"><div><div class="muted" style="color:rgba(255,255,255,.85)">累计签到</div><div style="font-size:22px;font-weight:800">{{data.total_days}} 天</div></div>
        <div><div class="muted" style="color:rgba(255,255,255,.85)">当前积分</div><div style="font-size:22px;font-weight:800">{{pts(data.balance)}}</div></div></div>
        <button class="btn btn-plain mt14" :disabled="loading||data.checked_in_today" @click="doCheckin">{{data.checked_in_today?'今日已签':'立即签到'}}</button>
      </div>
      <div class="card">
        <div class="row-between mb12"><div class="section-title" style="margin:0">签到日历</div><div class="row gap8"><button class="btn btn-plain btn-sm" @click="prevMonth">‹</button><button class="btn btn-plain btn-sm" @click="nextMonth">›</button></div></div>
        <app-calendar :signed-dates="data.records.map(r=>r.date)" :year="year" :month="month"/>
      </div>
    </div>
  </div>`,
};

// ---------- 绑定账号 ----------
Views.BindView = {
  setup() {
    const auth = getAuth();
    const route = VueRouter.useRoute();
    const updateId = Number(route.query.update || 0) || 0;
    const state = ref("idle"); // idle/waiting/scanned/done/expired/error
    const qrUrl = ref(""); const sid = ref(""); const errMsg = ref("");
    const countdown = ref(0); const account = ref(null);
    // 手动绑定：粘贴「备注#小蚕UserId#silk_id#token」，多账号用 @ 分隔（与后台「账号数据」导出一致）
    const manual = reactive({ show: true, data: "", submitting: false });
    async function submitManual() {
      const text = (manual.data || "").trim();
      if (!text) return Toast.show("请粘贴账号数据");
      manual.submitting = true;
      try {
        const d = await Api.post("/xiaocan/bind", updateId ? { data: text, account_id: updateId } : { data: text });
        const first = (d.accounts || [])[0];
        Toast.show((updateId ? "账号数据已更新：" : "绑定成功：") + ((first && first.nickname) || ""));
        manual.data = "";
        setTimeout(() => window.navigateTo("accounts"), 900);
      } catch (e) { Toast.show(e.msg || "绑定失败"); }
      finally { manual.submitting = false; }
    }
    let pollTimer = null, countTimer = null;
    function stop() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } if (countTimer) { clearInterval(countTimer); countTimer = null; } }
    async function genQr() {
      stop(); state.value = "waiting"; errMsg.value = ""; account.value = null; qrUrl.value = "";
      try {
        const d = await Api.post("/xiaocan/qrcode", updateId ? { account_id: updateId } : {});
        sid.value = d.session_id; qrUrl.value = d.qrcode_url; countdown.value = 300;
        startCount(); startPoll();
      } catch (e) { state.value = "error"; errMsg.value = e.msg || "获取二维码失败"; }
    }
    function startCount() {
      countTimer = setInterval(() => {
        countdown.value--;
        if (countdown.value <= 0) { stop(); state.value = "expired"; Toast.show("二维码已过期"); }
      }, 1000);
    }
    async function startPoll() {
      const poll = async () => {
        try {
          const d = await Api.get("/xiaocan/qrcode/status?session_id=" + sid.value);
          if (d.state === "scanned") { state.value = "scanned"; }
          else if (d.state === "done") { state.value = "done"; account.value = d.account; stop();
            Toast.show((updateId ? "账号数据更新成功：" : "绑定成功：") + (d.account?.nickname || "")); setTimeout(() => window.navigateTo("accounts"), 1200); }
          else if (d.state === "expired") { stop(); state.value = "expired"; }
          else if (d.state === "error") { stop(); state.value = "error"; errMsg.value = d.error || "绑定失败"; }
        } catch (e) {}
      };
      poll();
      pollTimer = setInterval(poll, 2500);
    }
    onMounted(() => auth.loadProfile());
    onUnmounted(stop);
    return { auth, state, qrUrl, countdown, account, errMsg, genQr, stop, updateId, manual, submitManual };
  },
  template: `<div class="app-shell" style="min-height:100vh">
    <app-nav-bar title="绑定账号"/>
    <div class="page">
      <div class="card center" style="padding:24px 16px">
        <div style="font-size:40px">🔗</div>
        <div style="font-size:18px;font-weight:600;margin-top:8px">微信扫码{{updateId ? '更新账号数据' : '绑定账号'}}</div>
        <div class="muted mt8">请用另一台手机打开微信扫一扫</div>
      </div>
      <div class="card center" style="padding:20px 16px">
        <template v-if="state==='idle'">
          <div class="muted mb12">点击生成二维码，用微信扫码登录绑定小蚕账号</div>
          <button class="btn btn-primary btn-lg" @click="genQr">生成二维码</button>
        </template>
        <template v-else-if="state==='expired'">
          <div class="muted mb12" style="color:var(--danger)">二维码已过期</div>
          <button class="btn btn-primary btn-lg" @click="genQr">重新生成二维码</button>
        </template>
        <template v-else-if="state==='error'">
          <div class="muted mb12" style="color:var(--danger)">{{errMsg}}</div>
          <button class="btn btn-primary btn-lg" @click="genQr">重新生成二维码</button>
        </template>
        <template v-else>
          <div v-if="qrUrl" style="position:relative;width:200px;height:200px;margin:0 auto">
            <img :src="qrUrl" style="display:block;width:200px;height:200px;border-radius:12px;border:1px solid var(--border)"/>
            <img src="/assets/xiaocan-anniversary.png" alt="" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:34px;height:34px;border:0;border-radius:6px;background:transparent"/>
          </div>
          <div class="muted mt8">{{countdown}}s 后失效</div>
          <div class="muted mt8" v-if="state==='waiting'">⏳ 等待微信扫码...</div>
          <div class="muted mt8" v-if="state==='scanned'" style="color:var(--success)">✅ 已扫码，请在手机上确认登录</div>
          <div class="muted mt8" v-if="state==='done'" style="color:var(--success)">🎉 绑定成功：{{account?.nickname}}（ID: {{account?.account_info}}）</div>
          <button class="btn btn-outline btn-sm mt12" @click="genQr" v-if="state==='waiting'||state==='scanned'">重新生成</button>
        </template>
      </div>
      <div class="card" style="padding:16px">
        <div class="section-title">手动粘贴绑定</div>
        <div class="muted mb8">内容格式：<b>备注#小蚕UserId#小蚕ID#token</b>，多个账号用 @ 分隔。可直接用后台「账号数据」页导出的整段文本。</div>
        <textarea class="field-input" rows="5" v-model="manual.data" placeholder="备注#UserId#silk_id#token@备注2#UserId2#silk_id2#token2" spellcheck="false"></textarea>
        <div class="mt12"><button class="btn btn-primary btn-block" :disabled="manual.submitting" @click="submitManual">{{manual.submitting ? '提交中…' : (updateId ? '更新账号数据' : '绑定账号')}}</button></div>
      </div>
    </div>
  </div>`,
};

// ---------- 我的 ----------
Views.ProfileView = {
  setup() {
    const auth = getAuth();
    const pw = reactive({ old: "", new: "", confirm: "" });
    async function logout() { if (!await Dialog.confirm("退出登录", "确认退出当前账号？")) return; await auth.logout(); window.navigateTo("login"); }
    async function changePw() {
      if (!pw.old || !pw.new) return Toast.show("请填写原密码和新密码");
      if (pw.new.length < 8) return Toast.show("新密码至少 8 位");
      if (pw.new !== pw.confirm) return Toast.show("两次输入的新密码不一致");
      try { await Api.put("/auth/password", { old_password: pw.old, new_password: pw.new }); Toast.show("密码修改成功"); pw.old = ""; pw.new = ""; pw.confirm = ""; }
      catch (e) { Toast.show(e.msg || "修改失败"); }
    }
    function openPasswordDialog() {
      const w = document.createElement("div"); w.className = "overlay";
      w.innerHTML = `<div class="dialog password-dialog"><div class="dlg-head">修改密码</div><div class="dlg-body">
        <div class="field"><div class="field-label">原密码</div><input class="field-input pw-old" type="password" placeholder="请输入原密码" autocomplete="current-password"/></div>
        <div class="field"><div class="field-label">新密码</div><input class="field-input pw-new" type="password" placeholder="至少 8 位" autocomplete="new-password"/></div>
        <div class="field"><div class="field-label">确认新密码</div><input class="field-input pw-confirm" type="password" placeholder="请再次输入新密码" autocomplete="new-password"/></div>
      </div><div class="dlg-foot"><button class="cancel">取消</button><button class="confirm">保存修改</button></div></div>`;
      document.body.appendChild(w);
      const close = () => w.remove();
      w.querySelector(".cancel").onclick = close;
      w.onclick = (e) => { if (e.target === w) close(); };
      w.querySelector(".confirm").onclick = async () => {
        pw.old = w.querySelector(".pw-old").value;
        pw.new = w.querySelector(".pw-new").value;
        pw.confirm = w.querySelector(".pw-confirm").value;
        if (!pw.old || !pw.new) return Toast.show("请填写原密码和新密码");
        if (pw.new.length < 8) return Toast.show("新密码至少 8 位");
        if (pw.new !== pw.confirm) return Toast.show("两次输入的新密码不一致");
        const btn = w.querySelector(".confirm"); btn.disabled = true;
        try { await Api.put("/auth/password", { old_password: pw.old, new_password: pw.new }); Toast.show("密码修改成功"); close(); pw.old = ""; pw.new = ""; pw.confirm = ""; }
        catch (e) { btn.disabled = false; Toast.show(e.msg || "修改失败"); }
      };
      w.querySelector(".pw-old").focus();
    }
    async function toggleNotify(v) {
      try { await Api.put("/auth/notify", { email_notify: v }); Toast.show(v ? "已开启邮件通知" : "已关闭邮件通知"); }
      catch (e) { Toast.show(e.msg); }
    }
    function copyInvite() { const c = auth.user?.invite_code; if (!c) return; navigator.clipboard?.writeText(c).then(() => Toast.show("邀请码已复制")).catch(() => Toast.show(c)); }
    function go(p) { window.navigateTo(p); }
    onMounted(() => auth.loadProfile());
    return { auth, pw, logout, changePw, openPasswordDialog, toggleNotify, copyInvite, go, pts };
  },
  template: `<div class="app-shell">
    <div class="navbar"><div class="brand"><img src="/assets/panel-logo.png?v=1" class="logo"/>我的</div></div>
    <div class="page">
      <div class="card center" style="padding:20px 16px">
        <img src="/assets/panel-logo.png?v=1" style="width:56px;height:56px;border-radius:50%;object-fit:cover;margin:0 auto 8px"/>
        <div style="font-weight:700;font-size:16px;margin-bottom:4px">{{auth.user?.nickname || '用户'}}</div>
        <div class="muted">{{auth.user?.email}}</div>
        <div class="row gap12 mt12 profile-balance-row">
          <div class="profile-balance"><div class="muted">积分余额</div><div class="stat-num">{{pts(auth.balance)}}</div></div>
        </div>
      </div>
      <div class="card" style="padding:0 16px">
        <div class="cell" icon="📧"><div class="cell-main"><div class="cell-title">抢券结果邮件</div></div><app-switch :model-value="!!auth.user?.email_notify" @update:modelValue="toggleNotify"/></div>
        <app-cell icon="🎁" title="我的权益" @click="go('billing')"/>
        <app-cell icon="💳" title="积分中心" @click="go('points')"/>
        <app-cell icon="📅" title="每日签到" @click="go('check-in')"/>
        <app-cell icon="👥" title="邀请好友" @click="go('invite')"/>
      </div>
      <div class="card" style="padding:0 16px"><app-cell icon="🔑" title="修改密码" sub="定期更新密码，保护账号安全" @click="openPasswordDialog"/></div>
      <button class="btn btn-danger btn-block" @click="logout">退出登录</button>
    </div>
    <app-tab-bar active="profile"/>
  </div>`,
};

window.Views = Views;
window.__pts = pts;
})();
