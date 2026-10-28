// ============ 管理后台视图 ============
(function () {
const Admin = {};
const { ref, reactive, computed, onMounted, watch, nextTick } = Vue;
const pts = window.__pts || ((v) => ((Number(v) || 0) / 100).toFixed(2));

Admin.Layout = {
  setup() {
    const auth = getAuth();
    const currentRoute = VueRouter.useRoute();
    const menus = [
      { key: "admin", icon: "📊", text: "仪表盘" },
      { key: "admin/coupons", icon: "🎯", text: "优惠券类型" },
      { key: "admin/cards", icon: "🎫", text: "卡密管理" },
      { key: "admin/products", icon: "💎", text: "积分商品" },
      { key: "admin/accounts", icon: "📋", text: "账号订单" },
      { key: "admin/account-data", icon: "🪪", text: "账号数据" },
      { key: "admin/users", icon: "👥", text: "用户管理" },
      { key: "admin/announcements", icon: "📢", text: "公告管理" },
      { key: "admin/xiaocan-tasks", icon: "🗂️", text: "小蚕任务总览" },
      { key: "admin/task-logs", icon: "📜", text: "任务日志" },
      { key: "admin/ql", icon: "🐉", text: "青龙面板" },
      { key: "admin/settings", icon: "⚙️", text: "系统设置" },
    ];
    const route = computed(() => currentRoute.path.replace(/^\//, "") || "admin");
    function go(path) { window.navigateTo(path); }
    return { auth, menus, route, go };
  },
  template: `<div class="admin-shell">
    <div class="admin-head">
      <div class="brand"><img src="/assets/panel-logo.png?v=1" style="width:28px;height:28px;border-radius:50%;object-fit:cover"/> 我中了后台</div>
      <div class="row gap12" style="font-size:13px;color:var(--text-2)">
        <span>{{auth.user?.email}}</span>
        <a @click="go('home')" style="color:var(--primary);cursor:pointer">用户端</a>
        <a @click="go('profile')" style="cursor:pointer">我的</a>
      </div>
    </div>
    <div class="admin-body">
      <div class="admin-side">
        <div v-for="m in menus" :key="m.key" :class="['nav-link',{active:route===m.key}]" @click="go(m.key)"><span style="margin-right:6px">{{m.icon}}</span>{{m.text}}</div>
      </div>
      <div class="admin-main"><router-view/></div>
    </div>
    <app-tab-bar active="admin"/>
  </div>`,
};

Admin.Dashboard = {
  setup() {
    const stats = ref({});
    const brandRate = ref({ rate: 10000 });
    const failures = ref([]);
    onMounted(async () => { try { const [s, r, f] = await Promise.all([Api.get("/admin/stats"), Api.get("/brand-coupon/rate"), Api.get("/admin/brand-coupon-failures?days=7")]); stats.value = s; brandRate.value = r; failures.value = f.records || []; } catch (e) {} });
    const items = computed(() => [
      { label: "用户数", value: stats.value.users || 0, icon: "👥", color: "var(--info)", to: "admin/users" },
      { label: "账号总数", value: stats.value.accounts || 0, icon: "📋", color: "var(--primary)", to: "admin/accounts" },
      { label: "VIP账号数", value: stats.value.vip_accounts || 0, icon: "👑", color: "var(--warning)", to: "admin/accounts?vip=1" },
      { label: "卡密总数", value: stats.value.cards_total || 0, icon: "🎫", color: "var(--success)", to: "admin/cards" },
      { label: "已使用", value: stats.value.cards_used || 0, icon: "✔️", color: "var(--text-2)", to: "admin/cards" },
      { label: "积分发放", value: pts(stats.value.points_issued || 0), icon: "💎", color: "var(--danger)", to: "admin/cards" },
      { label: "积分消耗", value: pts(stats.value.points_spent || 0), icon: "📉", color: "var(--warning)", to: "admin/users" },
      { label: "今日大牌券抢券率", value: ((brandRate.value.rate || 0) / 100).toFixed(2) + "%", icon: "🎯", color: "var(--primary)", to: "admin/accounts" },
    ]);
    function go(path) { window.navigateTo(path); }
    const vipLevels = computed(() => stats.value.vip_levels || {});
    function levelIcon(level) { return "/assets/xiaocan/svip" + level + ".png"; }
    function goLevel(level) { window.navigateTo("admin/accounts?vip_level=" + level); }
    return { items, go, vipLevels, levelIcon, goLevel, failures };
  },
  template: `<div><h2 style="margin-bottom:16px">仪表盘</h2>
    <div class="admin-grid"><div class="admin-card" v-for="i in items" :key="i.label" @click="go(i.to)" style="cursor:pointer" role="link" tabindex="0">
      <div style="font-size:22px">{{i.icon}}</div><div class="ac-num" :style="{color:i.color}">{{i.value}}</div><div class="muted">{{i.label}}</div></div></div>
    <div class="admin-section-title" style="margin:22px 0 10px;font-weight:700">小蚕等级账号数</div>
    <div class="admin-grid vip-level-grid"><div class="admin-card" v-for="level in [6,5,4,3,2]" :key="level" @click="goLevel(level)" style="cursor:pointer" role="link" tabindex="0">
      <img :src="levelIcon(level)" :alt="'SVIP'+level" style="width:64px;height:48px;object-fit:contain"/><div class="ac-num">{{vipLevels[String(level)] || 0}}</div><div class="muted">SVIP{{level}}账号</div></div></div>
    <div class="admin-section-title" style="margin:22px 0 10px;font-weight:700">近 7 日限量大牌券未中</div>
    <div class="admin-failure-list" v-if="failures.length"><div class="admin-failure-row" v-for="f in failures" :key="f.run_date+'-'+f.account_info">
      <div><b>{{f.nickname || '未命名账号'}}</b><span class="muted"> ID: {{f.account_info}}</span><div class="muted">{{f.run_date}} · SVIP{{f.vip_level || '-'}} · {{f.panel_name || '未分配'}}</div></div><span class="tag tag-warning">库存耗尽</span>
    </div></div><app-empty v-else text="近 7 日暂无未中记录"/></div>`,
};

Admin.Platforms = {
  setup() {
    const list = ref([]); const editing = reactive({ show: false, form: {} });
    async function load() { try { list.value = await Api.get("/admin/platforms"); } catch (e) {} }
    function add() { editing.show = true; editing.form = { name: "", icon: "🎯", description: "", sort_order: 0, status: "enabled" }; }
    function edit(p) { editing.show = true; editing.form = { ...p }; }
    async function save() {
      if (!editing.form.name) return Toast.show("请填写名称");
      try { if (editing.form.id) await Api.put("/admin/platforms/" + editing.form.id, editing.form); else await Api.post("/admin/platforms", editing.form); Toast.show("保存成功"); editing.show = false; await load(); }
      catch (e) { Toast.show(e.msg); }
    }
    async function del(p) { if (!await Dialog.confirm("删除", "确认删除「" + p.name + "」？")) return; try { await Api.del("/admin/platforms/" + p.id); Toast.show("已删除"); await load(); } catch (e) { Toast.show(e.msg); } }
    onMounted(load);
    return { list, editing, add, edit, save, del };
  },
  template: `<div>
    <div class="row-between mb12"><h2>平台分类</h2><button class="btn btn-primary btn-sm" @click="add">+ 新建平台</button></div>
    <table class="admin-table"><tr><th>图标</th><th>平台名称</th><th>说明</th><th>排序</th><th>状态</th><th>操作</th></tr>
      <tr v-for="p in list" :key="p.id"><td data-label="图标">{{p.icon}}</td><td data-label="平台名称">{{p.name}}</td><td data-label="说明">{{p.description}}</td><td data-label="排序">{{p.sort_order}}</td>
        <td data-label="状态"><span :class="'tag tag-'+(p.status==='enabled'?'success':'gray')">{{p.status==='enabled'?'启用':'停用'}}</span></td>
        <td data-label="操作"><button class="btn btn-plain btn-sm" @click="edit(p)">编辑</button> <button class="btn btn-danger btn-sm" @click="del(p)">删除</button></td></tr>
    </table>
    <div v-if="editing.show" class="overlay" @click.self="editing.show=false"><div class="dialog" style="max-width:380px;text-align:left">
      <div class="dlg-head" style="text-align:center">{{editing.form.id?'编辑平台':'新建平台'}}</div>
      <div style="padding:12px 18px">
        <div class="field"><div class="field-label">平台名称</div><input class="field-input" v-model="editing.form.name" placeholder="如 某外卖平台"/></div>
        <div class="field"><div class="field-label">图标(emoji)</div><input class="field-input" v-model="editing.form.icon"/></div>
        <div class="field"><div class="field-label">说明</div><input class="field-input" v-model="editing.form.description"/></div>
        <div class="field"><div class="field-label">排序</div><input class="field-input" type="number" v-model="editing.form.sort_order"/></div>
        <div class="field"><div class="field-label">状态</div><select class="field-input" v-model="editing.form.status"><option value="enabled">启用</option><option value="disabled">停用</option></select></div>
      </div><div class="dlg-foot"><button class="cancel" @click="editing.show=false">取消</button><button class="confirm" @click="save">保存</button></div></div></div>
  </div>`,
};

Admin.Coupons = {
  setup() {
    const list = ref([]); const editing = reactive({ show: false, form: {} });
    async function load() { try { list.value = await Api.get("/admin/coupon-types"); } catch (e) {} }
    function edit(c) { editing.show = true; editing.form = { ...c }; }
    async function save() {
      if (!editing.form.name) return Toast.show("请填写名称");
      try { if (editing.form.id) await Api.put("/admin/coupon-types/" + editing.form.id, editing.form); else await Api.post("/admin/coupon-types", editing.form); Toast.show("保存成功"); editing.show = false; await load(); }
      catch (e) { Toast.show(e.msg); }
    }
    onMounted(load);
    return { list, editing, edit, save };
  },
  template: `<div>
    <div class="row-between mb12"><h2>优惠券/任务类型 <span class="muted">(账号功能开关)</span></h2></div>
    <table class="admin-table"><tr><th>名称</th><th>标签</th><th>说明</th><th>排序</th><th>状态</th><th>操作</th></tr>
      <tr v-for="c in list" :key="c.id"><td data-label="名称">{{c.name}}</td><td data-label="标签">{{c.label}}</td><td data-label="说明">{{c.description}}</td><td data-label="排序">{{c.sort_order}}</td>
        <td data-label="状态"><span :class="'tag tag-'+(c.status==='enabled'?'success':'gray')">{{c.status==='enabled'?'启用':'停用'}}</span></td>
        <td data-label="操作"><button class="btn btn-plain btn-sm" @click="edit(c)">编辑</button></td></tr>
    </table>
    <div v-if="editing.show" class="overlay" @click.self="editing.show=false"><div class="dialog" style="max-width:380px;text-align:left">
      <div class="dlg-head" style="text-align:center">编辑任务类型</div>
      <div style="padding:12px 18px">
        <div class="field"><div class="field-label">名称</div><input class="field-input" v-model="editing.form.name" disabled/></div>
        <div class="field"><div class="field-label">标签(如 SVIP5-6/VIP6)</div><input class="field-input" v-model="editing.form.label"/></div>
        <div class="field"><div class="field-label">说明</div><input class="field-input" v-model="editing.form.description"/></div>
        <div class="field"><div class="field-label">排序</div><input class="field-input" type="number" v-model="editing.form.sort_order"/></div>
        <div class="field"><div class="field-label">状态</div><select class="field-input" v-model="editing.form.status"><option value="enabled">启用</option><option value="disabled">停用</option></select></div>
      </div><div class="dlg-foot"><button class="cancel" @click="editing.show=false">取消</button><button class="confirm" @click="save">保存</button></div></div></div>
  </div>`,
};

Admin.Cards = {
  setup() {
    const tiers = ref([]); const cards = ref([]); const selected = ref([]); const tab = ref("tiers");
    const gen = reactive({ show: false, tier_id: null, count: 10, results: [] });
    const tf = reactive({ show: false, form: {} });
    const filter = reactive({ status: "", tier_id: "", page: 1, total: 0 });
    async function loadTiers() { tiers.value = await Api.get("/admin/card-tiers"); }
    async function loadCards() {
      const p = new URLSearchParams({ page: filter.page, size: 30 });
      if (filter.status) p.set("status", filter.status);
      if (filter.tier_id) p.set("tier_id", filter.tier_id);
      const d = await Api.get("/admin/cards?" + p.toString()); cards.value = d.records || []; filter.total = d.total || 0; selected.value = [];
    }
    async function load() { try { await loadTiers(); await loadCards(); } catch (e) {} }
    function newTier() { tf.show = true; tf.form = { name: "", points_value: 100, price: 1.0, sort_order: 0, status: "enabled" }; }
    function editTier(t) { tf.show = true; tf.form = { ...t }; }
    async function saveTier() { if (!tf.form.name) return Toast.show("请填写名称"); try { if (tf.form.id) await Api.put("/admin/card-tiers/" + tf.form.id, tf.form); else await Api.post("/admin/card-tiers", tf.form); Toast.show("保存成功"); tf.show = false; await loadTiers(); } catch (e) { Toast.show(e.msg); } }
    async function delTier(t) { if (!await Dialog.confirm("删除", "确认删除「" + t.name + "」？")) return; try { await Api.del("/admin/card-tiers/" + t.id); Toast.show("已删除"); await loadTiers(); } catch (e) { Toast.show(e.msg); } }
    function openGen() { gen.show = true; gen.tier_id = tiers.value[0]?.id; gen.count = 10; gen.results = []; }
    async function doGen() { if (!gen.tier_id) return Toast.show("请选择档位"); try { const d = await Api.post("/admin/cards/generate", { tier_id: gen.tier_id, count: gen.count }); gen.results = d.codes; Toast.show("生成 " + d.count + " 张"); await loadCards(); } catch (e) { Toast.show(e.msg); } }
    async function exportCodes() {
      if (!gen.results.length) return;
      const txt = gen.results.join("\n");
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(txt);
        else {
          const area = document.createElement("textarea");
          area.value = txt; area.style.position = "fixed"; area.style.opacity = "0";
          document.body.appendChild(area); area.focus(); area.select();
          if (!document.execCommand("copy")) throw new Error("copy failed");
          area.remove();
        }
        Toast.show("已复制 " + gen.results.length + " 个卡密");
      } catch (_) {
        Toast.show("浏览器禁止自动复制，请手动选择卡密文本复制");
      }
    }
    function toggleCard(id) { selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : selected.value.concat(id); }
    function toggleAll() { selected.value = selected.value.length === cards.value.length ? [] : cards.value.map(c => c.id); }
    async function voidCards(ids) {
      const list = ids || selected.value;
      if (!list.length) return Toast.show("请先选择卡密");
      if (!await Dialog.confirm("作废卡密", "确认将选中的 " + list.length + " 张卡密作废？作废后不可兑换。")) return;
      try { await Api.post("/admin/cards/void", { ids: list }); Toast.show("已作废 " + list.length + " 张"); await loadCards(); }
      catch (e) { Toast.show(e.msg || "操作失败"); }
    }
    async function deleteCards(ids) {
      const list = ids || selected.value;
      if (!list.length) return Toast.show("请先选择卡密");
      if (!await Dialog.confirm("删除卡密", "确认永久删除选中的 " + list.length + " 张卡密？删除后不可恢复。")) return;
      try { await Api.post("/admin/cards/delete", { ids: list }); Toast.show("已删除 " + list.length + " 张"); await loadCards(); }
      catch (e) { Toast.show(e.msg || "删除失败"); }
    }
    async function changePage(page) {
      const max = Math.max(1, Math.ceil(filter.total / 30));
      filter.page = Math.min(max, Math.max(1, page));
      await loadCards();
    }
    onMounted(load);
    return { tiers, cards, selected, tab, gen, tf, filter, load, loadCards, newTier, editTier, saveTier, delTier, openGen, doGen, exportCodes, toggleCard, toggleAll, voidCards, deleteCards, changePage, pts };
  },
  template: `<div>
    <div class="row-between mb12"><h2>卡密管理</h2><div class="row gap8">
      <button :class="'btn btn-sm '+(tab==='tiers'?'btn-primary':'btn-outline')" @click="tab='tiers'">档位</button>
      <button :class="'btn btn-sm '+(tab==='cards'?'btn-primary':'btn-outline')" @click="tab='cards'">卡密</button>
      <button class="btn btn-primary btn-sm" @click="openGen">生成卡密</button></div></div>
    <template v-if="tab==='tiers'"><table class="admin-table"><tr><th>档位名称</th><th>积分值</th><th>价格</th><th>状态</th><th>操作</th></tr>
      <tr v-for="t in tiers" :key="t.id"><td data-label="档位名称">{{t.name}}</td><td data-label="积分值">{{pts(t.points_value)}}</td><td data-label="价格">{{t.price}}元</td>
        <td data-label="状态"><span :class="'tag tag-'+(t.status==='enabled'?'success':'gray')">{{t.status==='enabled'?'启用':'停用'}}</span></td>
        <td data-label="操作"><button class="btn btn-plain btn-sm" @click="editTier(t)">编辑</button> <button class="btn btn-danger btn-sm" @click="delTier(t)">删除</button></td></tr></table></template>
    <template v-else>
      <div class="row gap8 mb12"><select class="field-input" style="height:32px" v-model="filter.status" @change="filter.page=1;loadCards()"><option value="">全部状态</option><option value="unused">未使用</option><option value="used">已使用</option><option value="void">已作废</option></select>
        <select class="field-input" style="height:32px" v-model="filter.tier_id" @change="filter.page=1;loadCards()"><option value="">全部档位</option><option v-for="t in tiers" :key="t.id" :value="t.id">{{t.name}}</option></select>
        <button class="btn btn-outline btn-sm" @click="loadCards">刷新</button><button class="btn btn-danger btn-sm" :disabled="!selected.length" @click="voidCards()">批量作废{{selected.length?' ('+selected.length+')':''}}</button><button class="btn btn-danger btn-sm" :disabled="!selected.length" @click="deleteCards()">批量删除{{selected.length?' ('+selected.length+')':''}}</button></div>
      <table class="admin-table"><tr><th><input type="checkbox" :checked="cards.length>0&&selected.length===cards.length" @change="toggleAll"/></th><th>卡密</th><th>档位</th><th>积分值</th><th>状态</th><th>使用人</th><th>时间</th><th>操作</th></tr>
        <tr v-for="c in cards" :key="c.id"><td data-label="选择"><input type="checkbox" :checked="selected.includes(c.id)" @change="toggleCard(c.id)"/></td><td data-label="卡密" class="mono">{{c.code}}</td><td data-label="档位">{{c.tier_name||'-'}}</td><td data-label="积分值">{{pts(c.points_value)}}</td>
        <td data-label="状态"><span :class="'tag tag-'+(c.status==='unused'?'info':c.status==='void'?'danger':'gray')">{{c.status==='unused'?'未使用':c.status==='void'?'已作废':'已使用'}}</span></td><td data-label="使用人">{{c.user_id||'-'}}</td><td data-label="时间">{{c.created_time?.slice(0,16).replace('T',' ')}}</td><td data-label="操作"><button class="btn btn-danger btn-sm" :disabled="c.status==='void'" @click="voidCards([c.id])">作废</button> <button class="btn btn-plain btn-sm" @click="deleteCards([c.id])">删除</button></td></tr></table><div class="row-between mt12" v-if="filter.total>30"><span class="muted">共 {{filter.total}} 张，第 {{filter.page}} / {{Math.ceil(filter.total/30)}} 页</span><div class="row gap8"><button class="btn btn-outline btn-sm" :disabled="filter.page<=1" @click="changePage(filter.page-1)">上一页</button><button class="btn btn-outline btn-sm" :disabled="filter.page>=Math.ceil(filter.total/30)" @click="changePage(filter.page+1)">下一页</button></div></div></template>
    <div v-if="gen.show" class="overlay" @click.self="gen.show=false"><div class="dialog" style="max-width:400px;text-align:left">
      <div class="dlg-head" style="text-align:center">生成卡密</div><div style="padding:12px 18px">
        <div class="field"><div class="field-label">选择档位</div><select class="field-input" v-model="gen.tier_id"><option v-for="t in tiers" :key="t.id" :value="t.id">{{t.name}} - {{pts(t.points_value)}}积分</option></select></div>
        <div class="field"><div class="field-label">生成数量(1-1000)</div><input class="field-input" type="number" v-model="gen.count"/></div>
        <button class="btn btn-primary btn-block" @click="doGen">生成</button>
        <div v-if="gen.results.length" class="mt12"><div class="row-between"><span class="muted">已生成 {{gen.results.length}} 张</span><button class="btn btn-plain btn-sm" @click="exportCodes">复制全部</button></div>
        <div style="max-height:200px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px"><div v-for="code in gen.results" :key="code" class="mono" style="padding:2px 0">{{code}}</div></div></div></div>
      <div class="dlg-foot"><button class="cancel" @click="gen.show=false">关闭</button></div></div></div>
    <div v-if="tf.show" class="overlay" @click.self="tf.show=false"><div class="dialog" style="max-width:380px;text-align:left">
      <div class="dlg-head" style="text-align:center">{{tf.form.id?'编辑档位':'新建档位'}}</div><div style="padding:12px 18px">
        <div class="field"><div class="field-label">档位名称</div><input class="field-input" v-model="tf.form.name" placeholder="如 100积分卡"/></div>
        <div class="field"><div class="field-label">积分值</div><input class="field-input" type="number" v-model="tf.form.points_value"/></div>
        <div class="field"><div class="field-label">售价(元)</div><input class="field-input" type="number" step="0.1" v-model="tf.form.price"/></div>
        <div class="field"><div class="field-label">排序</div><input class="field-input" type="number" v-model="tf.form.sort_order"/></div>
        <div class="field"><div class="field-label">状态</div><select class="field-input" v-model="tf.form.status"><option value="enabled">启用</option><option value="disabled">停用</option></select></div></div>
      <div class="dlg-foot"><button class="cancel" @click="tf.show=false">取消</button><button class="confirm" @click="saveTier">保存</button></div></div></div>
  </div>`,
};

Admin.Products = {
  setup() {
    const list = ref([]); const editing = reactive({ show: false, form: {} });
    async function load() { try { list.value = await Api.get("/admin/products"); } catch (e) {} }
    function add() { editing.show = true; editing.form = { code: "", name: "", product_type: "membership", grant_value: 1, points_price: 100, sort_order: 0, status: "enabled" }; }
    function edit(p) { editing.show = true; editing.form = { ...p }; }
    async function save() { if (!editing.form.name) return Toast.show("请填写名称"); try { if (editing.form.id) await Api.put("/admin/products/" + editing.form.id, editing.form); else await Api.post("/admin/products", editing.form); Toast.show("保存成功"); editing.show = false; await load(); } catch (e) { Toast.show(e.msg); } }
    async function del(p) { if (!await Dialog.confirm("删除", "确认删除「" + p.name + "」？")) return; try { await Api.del("/admin/products/" + p.id); Toast.show("已删除"); await load(); } catch (e) { Toast.show(e.msg); } }
    onMounted(load);
    return { list, editing, add, edit, save, del, pts };
  },
  template: `<div>
    <div class="row-between mb12"><h2>积分商品 <span class="muted">(会员套餐)</span></h2><button class="btn btn-primary btn-sm" @click="add">+ 新建</button></div>
    <table class="admin-table"><tr><th>商品</th><th>类型</th><th>数值</th><th>积分价</th><th>状态</th><th>操作</th></tr>
      <tr v-for="p in list.filter(p => p.product_type==='membership')" :key="p.id"><td data-label="商品">{{p.name}}</td><td data-label="类型">会员</td><td data-label="数值">{{p.grant_value}}</td><td data-label="积分价">{{pts(p.points_price)}}</td>
        <td data-label="状态"><span :class="'tag tag-'+(p.status==='enabled'?'success':'gray')">{{p.status==='enabled'?'启用':'停用'}}</span></td>
        <td data-label="操作"><button class="btn btn-plain btn-sm" @click="edit(p)">编辑</button> <button class="btn btn-danger btn-sm" @click="del(p)">删除</button></td></tr></table>
    <div v-if="editing.show" class="overlay" @click.self="editing.show=false"><div class="dialog" style="max-width:380px;text-align:left">
      <div class="dlg-head" style="text-align:center">{{editing.form.id?'编辑商品':'新建商品'}}</div><div style="padding:12px 18px">
        <div class="field"><div class="field-label">商品名称</div><input class="field-input" v-model="editing.form.name"/></div>
        <div class="field"><div class="field-label">类型</div><select class="field-input" v-model="editing.form.product_type"><option value="membership">会员</option></select></div>
        <div class="field"><div class="field-label">数值(天数/个数)</div><input class="field-input" type="number" v-model="editing.form.grant_value"/></div>
        <div class="field"><div class="field-label">积分价</div><input class="field-input" type="number" v-model="editing.form.points_price"/></div>
        <div class="field"><div class="field-label">状态</div><select class="field-input" v-model="editing.form.status"><option value="enabled">启用</option><option value="disabled">停用</option></select></div></div>
      <div class="dlg-foot"><button class="cancel" @click="editing.show=false">取消</button><button class="confirm" @click="save">保存</button></div></div></div>
  </div>`,
};

Admin.AccountData = {
  setup() {
    const text = ref(""); const count = ref(0); const skipped = ref(0); const loading = ref(false);
    async function load() {
      loading.value = true;
      try {
        const data = await Api.get("/admin/account-data");
        text.value = data.text || ""; count.value = data.count || 0; skipped.value = data.skipped || 0;
      } catch (e) { Toast.show(e.msg || "加载账号数据失败"); }
      finally { loading.value = false; }
    }
    async function copy() {
      if (!text.value) return Toast.show("暂无可复制的账号数据");
      try {
        if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text.value);
        else {
          const area = document.createElement("textarea");
          area.value = text.value; area.style.position = "fixed"; area.style.opacity = "0";
          document.body.appendChild(area); area.focus(); area.select();
          try { if (!document.execCommand("copy")) throw new Error("copy failed"); }
          finally { area.remove(); }
        }
        Toast.show("已复制 " + count.value + " 个账号的数据");
      } catch (_) { Toast.show("复制失败，请手动选择文本复制"); }
    }
    onMounted(load);
    return { text, count, skipped, loading, load, copy };
  },
  template: `<div>
    <div class="row-between mb12"><div><h2 style="margin:0">账号数据</h2><span class="muted">{{loading ? '加载中…' : '共 '+count+' 个账号'}} · 备注#user_id#silk_id#token</span></div><div class="row gap8"><button class="btn btn-outline btn-sm" @click="load">刷新</button><button class="btn btn-primary btn-sm" :disabled="!text" @click="copy">复制全部</button></div></div>
    <textarea class="field-input account-data-output" :value="text" readonly spellcheck="false" aria-label="全部小蚕账号数据"></textarea>
    <div v-if="skipped" class="muted mt12">{{skipped}} 个账号缺少有效字段，未拼入结果；请更新扫码数据或检查备注。</div>
    <div class="muted mt12">多个账号使用 @ 分隔。此内容包含登录令牌，请勿向他人分享。</div>
  </div>`,
};

Admin.Accounts = {
  setup() {
    const list = ref([]); const loading = ref(true); const page = ref(1); const total = ref(0); const pageSize = 10;
    const keyword = ref("");
    const taskOrder = ["限量大牌券-代理版", "保底大牌券", "会员专属返利券", "每日签到", "元宝一键领取", "元宝抽奖", "影音周卡", "红包雨", "免单券", "双节抽礼"];
    const openId = ref(null); const expiry = reactive({ show: false, account: null, value: "", quick: null });
    const signup = reactive({ show: false, account: null, tea_name: "", order_numbers: "", submitting: false });
    const route = VueRouter.useRoute();
    const selectedUserId = computed(() => Number(route.query.user_id || 0) || 0);
    const selectedAccountId = computed(() => Number(route.query.account_id || 0) || 0);
    const selectedVip = computed(() => String(route.query.vip || "") === "1");
    const selectedVipLevel = computed(() => Number(route.query.vip_level || 0) || 0);
    const selectedUserName = computed(() => String(route.query.user_name || ""));
    function normalizeFeatures(account) { const source = account && account.features && typeof account.features === "object" ? account.features : {}; account.features = Object.fromEntries(taskOrder.map(name => [name, source[name] === true || source[name] === 1 || source[name] === "1"])); return account; }
    async function load() { loading.value = true; try { const params = new URLSearchParams({page: String(page.value), size: String(pageSize)}); if (selectedUserId.value) params.set("user_id", selectedUserId.value); if (selectedAccountId.value) params.set("account_id", selectedAccountId.value); if (selectedVip.value) params.set("vip", "1"); if (selectedVipLevel.value) params.set("vip_level", selectedVipLevel.value); if (keyword.value.trim()) params.set("q", keyword.value.trim()); const d = await Api.get("/admin/accounts?" + params.toString()); list.value = (d.records || []).map(normalizeFeatures); total.value = d.total || 0; } catch (e) { Toast.show(e.msg || "加载账号失败"); } finally { loading.value = false; } }
    function search() { page.value = 1; openId.value = null; load(); }
    function clearSearch() { if (!keyword.value) return; keyword.value = ""; search(); }
    function changePage(next) { const max = Math.max(1, Math.ceil(total.value / pageSize)); page.value = Math.min(max, Math.max(1, next)); load(); }
    async function toggleTask(a, name) { try { const d = await Api.put("/admin/accounts/" + a.id + "/features/" + encodeURIComponent(name), {}); a.features[name] = !!d.value; Toast.show((d.value ? "已开启：" : "已关闭：") + name); } catch (e) { Toast.show(e.msg || "操作失败"); } }
    async function toggleStatus(a) { const next = a.status === "enabled" ? "disabled" : "enabled"; const action = next === "disabled" ? "暂停" : "启用"; if (!await Dialog.confirm(action + "账号", "确认" + action + "「" + (a.nickname || a.account_info) + "」？")) return; try { const d = await Api.put("/admin/accounts/" + a.id + "/status", { status: next }); a.status = d.status; Toast.show(next === "disabled" ? "账号已暂停" : "账号已启用"); await load(); } catch (e) { Toast.show(e.msg || "操作失败"); } }
    function openExpiry(a) { expiry.account = a; expiry.value = a.membership_expire ? a.membership_expire.slice(0,16) : ""; expiry.quick = null; expiry.show = true; }
    function setQuickExpiry(kind) { expiry.quick = kind; expiry.value = ""; }
    function localDateTime(d) { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
    function quickExpiryValue(kind) {
      const now = new Date();
      if (kind === "month") return localDateTime(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59));
      now.setDate(now.getDate() + Number(kind)); return localDateTime(now);
    }
    async function saveExpiry() { try { const value = expiry.quick ? quickExpiryValue(expiry.quick) : (expiry.value || ""); const d = await Api.put("/admin/accounts/" + expiry.account.id + "/membership-expire", { membership_expire: value }); expiry.account.membership_expire = d.membership_expire; expiry.show = false; Toast.show("到期时间已保存"); } catch (e) { Toast.show(e.msg || "保存失败"); } }
    function openSignup(a) { signup.account = a; signup.tea_name = ""; signup.order_numbers = ""; signup.submitting = false; signup.show = true; }
    async function submitSignup() { if (!signup.tea_name.trim() || !signup.order_numbers.trim()) return; const esc = s => String(s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); const ok = await Dialog.confirm("确认报名信息", "账号：" + esc(signup.account.nickname || signup.account.account_info) + "<br>奶茶名：<span style='color:#d93025;font-weight:700'>" + esc(signup.tea_name.trim()) + "</span><br>订单号：<span style='color:#d93025;font-weight:700;word-break:break-all'>" + esc(signup.order_numbers.trim()) + "</span><br><br>请核对无误后再提交"); if (!ok) return; signup.submitting = true; try { const d = await Api.post("/xiaocan/accounts/" + signup.account.id + "/signup", { tea_name: signup.tea_name.trim(), order_numbers: signup.order_numbers.trim() }); signup.account.signup = { status: d.status || "pending", tea_name: signup.tea_name.trim(), order_numbers: signup.order_numbers.trim() }; signup.show = false; Toast.show("报名任务已立即提交"); } catch (e) { Toast.show(e.msg || "报名失败"); } finally { signup.submitting = false; } }
    function vipIcon(a) { const level = Number(a.vip_level || 0); return level >= 2 && level <= 6 ? "/assets/xiaocan/svip" + level + ".png" : ""; }
    function panelLabel(name, remark) { return remark || name || "未分配"; }
    const taskMeta = {
      "限量大牌券-代理版": { label: "限量大牌", icon: "/assets/xiaocan/brand.png", className: "brand" },
      "保底大牌券": { label: "保底大牌", icon: "/assets/xiaocan/brand.png", className: "brand" },
      "会员专属返利券": { label: "返利券", icon: "/assets/xiaocan/rebate.png", className: "rebate" },
      "每日签到": { label: "每日签到", icon: "/assets/xiaocan/checkin.png", className: "checkin" },
      "元宝一键领取": { label: "元宝领取", icon: "/assets/xiaocan/yuanbao.png", className: "yuanbao" },
      "元宝抽奖": { label: "元宝抽奖", icon: "/assets/xiaocan/yuanbao.png", className: "yuanbao" },
      "影音周卡": { label: "影音周卡", icon: "/assets/xiaocan/week.png", className: "week", note: "SVIP3-6 / VIP6" },
      "红包雨": { label: "红包雨", icon: "/assets/xiaocan/rain.png", className: "rain" },
      "免单券": { label: "免单券", icon: "/assets/xiaocan/free.png", className: "free", note: "SVIP5-6 / VIP6" },
      "双节抽礼": { label: "双节抽礼", icon: "/assets/xiaocan/xiaocan-anniversary.png", className: "anniversary" },
    };
    function backToUsers() { window.navigateTo("admin/users"); }
    function backFromAccounts() { window.navigateTo(selectedAccountId.value ? "admin/account-data" : "admin/users"); }
    onMounted(load);
    watch(() => [route.query.user_id, route.query.account_id, route.query.vip, route.query.vip_level], () => { page.value = 1; load(); });
    const st = { enabled: "运行中", disabled: "已暂停" };
    return { list, loading, load, keyword, search, clearSearch, st, openId, expiry, signup, toggleTask, toggleStatus, openExpiry, setQuickExpiry, quickExpiryValue, saveExpiry, openSignup, submitSignup, vipIcon, panelLabel, taskMeta, taskOrder, selectedUserId, selectedAccountId, selectedUserName, selectedVip, selectedVipLevel, backFromAccounts, page, total, pageSize, changePage };
  },
  template: `<div><div class="row-between mb12"><div><button v-if="selectedUserId || selectedAccountId" class="btn btn-plain btn-sm" style="padding-left:0" @click="backFromAccounts">‹ 返回{{selectedAccountId?'账号数据':'用户管理'}}</button><h2 style="margin:0">{{selectedUserId ? (selectedUserName || '该用户') + '的小蚕账号' : '账号订单'}}</h2></div><button class="btn btn-outline btn-sm" @click="load">刷新</button></div>
    <div class="admin-search-bar mb12"><div class="admin-search-input"><span aria-hidden="true">⌕</span><input v-model="keyword" @keyup.enter="search" placeholder="搜索用户、邮箱、昵称、小蚕账号 ID" aria-label="搜索账号订单"/><button v-if="keyword" class="admin-search-clear" type="button" @click="clearSearch" aria-label="清空搜索">×</button></div><button class="btn btn-primary btn-sm" type="button" @click="search">搜索</button></div>
    <table class="admin-table"><tr><th>ID</th><th>用户</th><th>昵称</th><th>账号信息</th><th>SVIP等级</th><th>运行面板</th><th>状态</th><th>抢券到期时间</th><th>绑定时间</th><th>操作</th></tr>
      <template v-for="a in list" :key="a.id"><tr><td data-label="ID">{{a.id}}</td><td data-label="用户">{{a.user_nickname}}<br><span class="muted">{{a.user_email}}</span></td><td data-label="昵称">{{a.nickname}}</td><td data-label="账号信息" style="max-width:200px;white-space:normal">{{a.account_info}}</td>
        <td data-label="SVIP等级"><img v-if="vipIcon(a)" :src="vipIcon(a)" :alt="'SVIP'+a.vip_level" style="width:58px;height:34px;object-fit:contain;vertical-align:middle"/><span v-else class="tag tag-gray">{{a.vip_level ? 'SVIP'+a.vip_level : '待刷新'}}</span></td><td data-label="运行面板"><div>普通：{{panelLabel(a.default_panel_name, a.default_panel_remark)}}</div><div class="muted">限量：{{panelLabel(a.brand_panel_name, a.brand_panel_remark)}}</div></td><td data-label="状态"><span :class="'tag tag-'+(a.status==='enabled'?'success':'gray')">{{st[a.status]}}</span></td><td data-label="抢券到期时间">{{a.membership_expire?a.membership_expire.slice(0,16).replace('T',' '):'未设置'}}</td><td data-label="绑定时间">{{a.bind_time?.slice(0,16).replace('T',' ')}}</td>
        <td data-label="操作"><button class="btn btn-plain btn-sm" @click="openId=openId===a.id?null:a.id">{{openId===a.id?'收起任务':'任务管理'}}</button> <button class="btn btn-outline btn-sm" @click="openExpiry(a)">设置到期</button> <button :class="['btn','btn-sm',a.status==='enabled'?'btn-danger':'btn-primary']" @click="toggleStatus(a)">{{a.status==='enabled'?'暂停账号':'启用账号'}}</button></td></tr>
      <tr v-if="openId===a.id" class="admin-task-row"><td colspan="10"><div class="admin-task-panel"><div class="mb8"><b>账号 #{{a.id}} · {{a.nickname || '未命名账号'}}</b><span class="muted">（{{a.account_info}}）</span></div><div class="muted mb8">以下开关仅作用于此账号</div><div class="task-grid admin-task-grid"><div class="task-tile" v-for="name in taskOrder" :key="name"><img class="task-image" :class="taskMeta[name]?.className" :src="taskMeta[name]?.icon" :alt="taskMeta[name]?.label || name"/><div class="task-copy"><div>{{taskMeta[name]?.label || name}}</div><small v-if="taskMeta[name]?.note">{{taskMeta[name].note}}</small></div><app-switch :model-value="!!a.features[name]" @update:modelValue="toggleTask(a,name)"/></div></div><div class="signup-action"><div><b>大牌券报名</b><span class="muted">填写奶茶名称和订单号后立即执行</span></div><button class="btn btn-primary btn-sm" @click="openSignup(a)">立即报名</button></div><app-redeem-picker v-if="a.redeem" :account-id="a.id" :model-value="a.redeem" api-base="/admin/accounts" @update:modelValue="v=>a.redeem=v"/></div></td></tr></template>
    </table>
    <app-empty v-if="!list.length && !loading" text="暂无账号"/>
    <div class="row-between mt12" v-if="total>pageSize"><span class="muted">共 {{total}} 个账号，第 {{page}} / {{Math.ceil(total/pageSize)}} 页</span><div class="row gap8"><button class="btn btn-outline btn-sm" :disabled="page<=1" @click="changePage(page-1)">上一页</button><button class="btn btn-outline btn-sm" :disabled="page>=Math.ceil(total/pageSize)" @click="changePage(page+1)">下一页</button></div></div>
    <div v-if="expiry.show" class="overlay" @click.self="expiry.show=false"><div class="dialog" style="max-width:380px;text-align:left"><div class="dlg-head">设置抢券到期时间</div><div style="padding:12px 18px"><div class="muted mb8">{{expiry.account?.nickname}}</div><div class="muted mb8">快捷延长（以点击保存时刻计算）</div><div class="row gap8" style="flex-wrap:wrap;margin-bottom:10px"><button v-for="q in [{k:'1',t:'+1天'},{k:'3',t:'+3天'},{k:'7',t:'+7天'},{k:'15',t:'+15天'},{k:'month',t:'到月底'}]" :key="q.k" :class="['btn','btn-sm',expiry.quick===q.k?'btn-primary':'btn-outline']" @click="setQuickExpiry(q.k)">{{q.t}}</button></div><input class="field-input" type="datetime-local" v-model="expiry.value" @input="expiry.quick=null" :disabled="!!expiry.quick"/><div v-if="expiry.quick" class="muted mt8">保存时将设置为：{{quickExpiryValue(expiry.quick).replace('T',' ')}}</div></div><div class="dlg-foot"><button class="cancel" @click="expiry.show=false">取消</button><button class="confirm" @click="saveExpiry">保存</button></div></div></div>
    <div v-if="signup.show" class="overlay" @click.self="signup.show=false"><div class="dialog" style="max-width:420px;text-align:left"><div class="dlg-head">大牌券报名</div><div style="padding:14px 18px"><div class="muted mb8">账号：{{signup.account?.nickname}}（{{signup.account?.account_info}}）</div><div class="field"><div class="field-label">奶茶名称</div><input class="field-input" v-model="signup.tea_name" placeholder="例如：喜茶"/></div><div class="field"><div class="field-label">订单号</div><textarea class="field-input" rows="3" v-model="signup.order_numbers" placeholder="多个订单号用 # 分隔"></textarea></div></div><div class="dlg-foot"><button class="cancel" @click="signup.show=false">取消</button><button class="confirm" :disabled="signup.submitting || !signup.tea_name.trim() || !signup.order_numbers.trim()" @click="submitSignup">{{signup.submitting?'提交中…':'立即报名'}}</button></div></div></div>
  </div>`,
};

Admin.Users = {
  setup() {
    const list = ref([]); const loading = ref(true); const page = ref(1); const total = ref(0); const pageSize = 10;
    const keyword = ref("");
    const adj = reactive({ show: false, uid: null, amount: 100, note: "" });
    const nick = reactive({ show: false, user: null, value: "" });
    async function load() { loading.value = true; try { const params = new URLSearchParams({page: String(page.value), size: String(pageSize)}); if (keyword.value.trim()) params.set("q", keyword.value.trim()); const d = await Api.get("/admin/users?" + params.toString()); list.value = d.records || []; total.value = d.total || 0; } catch (e) { Toast.show(e.msg || "加载用户失败"); } finally { loading.value = false; } }
    function search() { page.value = 1; load(); }
    function clearSearch() { if (!keyword.value) return; keyword.value = ""; search(); }
    function changePage(next) { const max = Math.max(1, Math.ceil(total.value / pageSize)); page.value = Math.min(max, Math.max(1, next)); load(); }
    function openAdjust(u) { adj.show = true; adj.uid = u.id; adj.amount = 100; adj.note = ""; }
    function openNickname(u) { nick.user = u; nick.value = u.nickname || ""; nick.show = true; }
    async function saveNickname() { const value = nick.value.trim(); if (!value) return Toast.show("昵称不能为空"); try { await Api.put("/admin/users/" + nick.user.id + "/nickname", { nickname: value }); nick.user.nickname = value; nick.show = false; Toast.show("昵称已更新"); } catch (e) { Toast.show(e.msg || "修改失败"); } }
    async function doAdjust() { try { const d = await Api.post("/admin/users/" + adj.uid + "/points", { amount: Number(adj.amount), note: adj.note }); Toast.show("已调整，余额 " + pts(d.balance)); adj.show = false; await load(); } catch (e) { Toast.show(e.msg); } }
    async function toggleBan(u) { const ns = u.status === "banned" ? "normal" : "banned"; if (!await Dialog.confirm(ns === "banned" ? "封禁" : "解封", "确认" + (ns === "banned" ? "封禁" : "解封") + "「" + u.nickname + "」？")) return; try { await Api.put("/admin/users/" + u.id + "/status", { status: ns }); Toast.show("已操作"); await load(); } catch (e) { Toast.show(e.msg); } }
    async function toggleRole(u) { const nr = u.role === "admin" ? "user" : "admin"; if (!await Dialog.confirm(nr === "admin" ? "设为管理员" : "取消管理员", "确认将「" + u.nickname + "」" + (nr === "admin" ? "设为管理员" : "取消管理员") + "？")) return; try { await Api.put("/admin/users/" + u.id + "/role", { role: nr }); Toast.show("已操作"); await load(); } catch (e) { Toast.show(e.msg); } }
    function openAccounts(u) { window.navigateTo("admin/accounts?user_id=" + u.id + "&user_name=" + encodeURIComponent(u.nickname || "用户")); }
    onMounted(load);
    return { list, loading, keyword, search, clearSearch, adj, nick, load, openAdjust, doAdjust, openNickname, saveNickname, toggleBan, toggleRole, openAccounts, pts, page, total, pageSize, changePage };
  },
  template: `<div><div class="row-between mb12"><h2>用户管理</h2><button class="btn btn-outline btn-sm" @click="load">刷新</button></div>
    <div class="admin-search-bar mb12"><div class="admin-search-input"><span aria-hidden="true">⌕</span><input v-model="keyword" @keyup.enter="search" placeholder="搜索用户 ID、昵称、邮箱或登录 IP" aria-label="搜索用户"/><button v-if="keyword" class="admin-search-clear" type="button" @click="clearSearch" aria-label="清空搜索">×</button></div><button class="btn btn-primary btn-sm" type="button" @click="search">搜索</button></div>
    <table class="admin-table"><tr><th>ID</th><th>昵称</th><th>邮箱</th><th>上次登录 IP</th><th>角色</th><th>积分</th><th>积分消耗</th><th>状态</th><th>操作</th></tr>
      <tr v-for="u in list" :key="u.id"><td data-label="ID">{{u.id}}</td><td data-label="昵称"><button class="btn btn-plain btn-sm" style="padding:2px 0;font-weight:600" @click="openAccounts(u)">{{u.nickname}}</button></td><td data-label="邮箱">{{u.email}}</td><td data-label="上次登录 IP"><span class="mono">{{u.last_login_ip || '暂无记录'}}</span><div v-if="u.last_login_time" class="muted">{{u.last_login_time.slice(0,16).replace('T',' ')}}</div></td><td data-label="角色"><span :class="'tag tag-'+(u.role==='admin'?'primary':'gray')">{{u.role==='admin'?'管理员':'用户'}}</span></td><td data-label="积分">{{pts(u.points_balance)}}</td><td data-label="积分消耗">{{pts(u.points_spent)}}</td>
        <td data-label="状态"><span :class="'tag tag-'+(u.status==='normal'?'success':'danger')">{{u.status==='normal'?'正常':'封禁'}}</span></td>
        <td data-label="操作"><button class="btn btn-plain btn-sm" @click="openNickname(u)">改昵称</button> <button class="btn btn-plain btn-sm" @click="openAdjust(u)">调积分</button> <button class="btn btn-plain btn-sm" @click="toggleRole(u)">{{u.role==='admin'?'取消管理员':'设管理员'}}</button> <button class="btn btn-danger btn-sm" @click="toggleBan(u)">{{u.status==='normal'?'封禁':'解封'}}</button></td></tr></table>
    <app-empty v-if="!list.length && !loading" text="暂无用户"/>
    <div class="row-between mt12" v-if="total>pageSize"><span class="muted">共 {{total}} 个用户，第 {{page}} / {{Math.ceil(total/pageSize)}} 页</span><div class="row gap8"><button class="btn btn-outline btn-sm" :disabled="page<=1" @click="changePage(page-1)">上一页</button><button class="btn btn-outline btn-sm" :disabled="page>=Math.ceil(total/pageSize)" @click="changePage(page+1)">下一页</button></div></div>
    <div v-if="adj.show" class="overlay" @click.self="adj.show=false"><div class="dialog" style="max-width:380px;text-align:left">
      <div class="dlg-head" style="text-align:center">调整积分</div><div style="padding:12px 18px">
        <div class="muted mb12">正数充值，负数扣减</div>
        <div class="field"><div class="field-label">变动积分</div><input class="field-input" type="number" v-model="adj.amount"/></div>
        <div class="field"><div class="field-label">备注</div><input class="field-input" v-model="adj.note"/></div></div>
      <div class="dlg-foot"><button class="cancel" @click="adj.show=false">取消</button><button class="confirm" @click="doAdjust">确认</button></div></div></div>
    <div v-if="nick.show" class="overlay" @click.self="nick.show=false"><div class="dialog" style="max-width:380px;text-align:left"><div class="dlg-head" style="text-align:center">修改用户昵称</div><div style="padding:12px 18px"><div class="muted mb8">{{nick.user?.email}}</div><div class="field"><div class="field-label">昵称</div><input class="field-input" v-model="nick.value" maxlength="20" @keyup.enter="saveNickname"/></div></div><div class="dlg-foot"><button class="cancel" @click="nick.show=false">取消</button><button class="confirm" @click="saveNickname">保存</button></div></div></div></div>`,
};

Admin.Announcements = {
  setup() {
    const list = ref([]); const editing = reactive({ show: false, form: {} });
    const editor = ref(null); const textColor = ref("#ff7a00"); let savedRange = null;
    async function load() { try { list.value = await Api.get("/admin/announcements"); } catch (e) {} }
    function cleanHtml(html) {
      const box = document.createElement("template"); box.innerHTML = html || "";
      box.content.querySelectorAll("script,style,iframe,object,embed,form,input,button,textarea,select").forEach(n => n.remove());
      box.content.querySelectorAll("*").forEach(node => {
        [...node.attributes].forEach(attr => {
          const name = attr.name.toLowerCase(); const value = String(attr.value || "").trim().toLowerCase();
          if (name.startsWith("on") || name === "srcdoc" || ((name === "href" || name === "src") && value.startsWith("javascript:"))) node.removeAttribute(attr.name);
        });
        if (node.tagName === "A") { node.setAttribute("target", "_blank"); node.setAttribute("rel", "noopener noreferrer"); }
      });
      return box.innerHTML;
    }
    async function openEditor(form) {
      editing.show = true; editing.form = form;
      await nextTick(); if (editor.value) editor.value.innerHTML = cleanHtml(form.content || "");
    }
    function add() { openEditor({ title: "", content: "" }); }
    function edit(a) { openEditor({ ...a }); }
    function rememberSelection() {
      const selection = window.getSelection();
      if (selection && selection.rangeCount && editor.value?.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
    }
    function restoreSelection() {
      if (!savedRange) return;
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedRange);
    }
    function focusEditor() { if (editor.value) editor.value.focus(); }
    function command(name, value = null) { restoreSelection(); focusEditor(); document.execCommand(name, false, value); rememberSelection(); }
    function setBlock(event) { const value = event.target.value; if (value) command("formatBlock", value); event.target.value = ""; }
    function setColor() { command("foreColor", textColor.value); }
    function addLink() {
      const url = window.prompt("请输入链接地址，例如：https://example.com");
      if (!url) return;
      const safe = /^https?:\/\//i.test(url.trim()) ? url.trim() : "https://" + url.trim();
      command("createLink", safe);
    }
    function clearEditor() { if (editor.value && window.confirm("确认清空公告内容？")) { editor.value.innerHTML = ""; focusEditor(); } }
    async function save() {
      if (!editing.form.title) return Toast.show("请填写标题");
      editing.form.content = cleanHtml(editor.value?.innerHTML || "");
      if (!editing.form.content.replace(/<[^>]*>/g, "").trim()) return Toast.show("请填写公告内容");
      try { if (editing.form.id) await Api.put("/admin/announcements/" + editing.form.id, editing.form); else await Api.post("/admin/announcements", editing.form); Toast.show("保存成功"); editing.show = false; await load(); } catch (e) { Toast.show(e.msg); }
    }
    async function del(a) { if (!await Dialog.confirm("删除", "确认删除「" + a.title + "」？")) return; try { await Api.del("/admin/announcements/" + a.id); Toast.show("已删除"); await load(); } catch (e) { Toast.show(e.msg); } }
    onMounted(load);
    return { list, editing, editor, textColor, add, edit, save, del, command, setBlock, setColor, addLink, clearEditor, rememberSelection };
  },
  template: `<div><div class="row-between mb12"><h2>公告管理</h2><button class="btn btn-primary btn-sm" @click="add">+ 新建公告</button></div>
    <table class="admin-table"><tr><th>ID</th><th>标题</th><th>版本</th><th>发布时间</th><th>操作</th></tr>
      <tr v-for="a in list" :key="a.id"><td data-label="ID">{{a.id}}</td><td data-label="标题">{{a.title}}</td><td data-label="版本">v{{a.version}}</td><td data-label="发布时间">{{a.published_time?.slice(0,16).replace('T',' ')}}</td>
        <td data-label="操作"><button class="btn btn-plain btn-sm" @click="edit(a)">编辑</button> <button class="btn btn-danger btn-sm" @click="del(a)">删除</button></td></tr></table>
    <div v-if="editing.show" class="overlay announcement-overlay" @click.self="editing.show=false"><div class="dialog announcement-dialog">
      <div class="dlg-head" style="text-align:center">{{editing.form.id?'编辑公告':'新建公告'}}</div><div style="padding:12px 18px">
        <div class="field"><div class="field-label">标题</div><input class="field-input" v-model="editing.form.title"/></div>
        <div class="field"><div class="field-label">公告内容</div>
          <div class="rich-editor-shell">
            <div class="rich-toolbar" @mousedown="rememberSelection">
              <button type="button" title="撤销" @click="command('undo')">↶</button><button type="button" title="重做" @click="command('redo')">↷</button><span></span>
              <button type="button" title="加粗" class="rich-bold" @click="command('bold')">B</button><button type="button" title="斜体" class="rich-italic" @click="command('italic')">I</button><button type="button" title="下划线" class="rich-underline" @click="command('underline')">U</button>
              <select title="字号" @change="command('fontSize',$event.target.value);$event.target.value=''" value=""><option value="" disabled>字号</option><option value="2">小</option><option value="3">正常</option><option value="4">大</option><option value="5">较大</option><option value="6">特大</option></select>
              <label class="rich-color" title="文字颜色"><input type="color" v-model="textColor" @input="setColor"/><i :style="{background:textColor}"></i></label>
              <select title="段落样式" @change="setBlock" value=""><option value="" disabled>段落</option><option value="p">正文</option><option value="h2">大标题</option><option value="h3">小标题</option><option value="blockquote">引用</option></select>
              <button type="button" title="无序列表" @click="command('insertUnorderedList')">• 列表</button><button type="button" title="有序列表" @click="command('insertOrderedList')">1. 列表</button>
              <button type="button" title="插入链接" @click="addLink">🔗 链接</button><button type="button" title="清除所选文字格式" @click="command('removeFormat')">清除格式</button><button type="button" title="清空全部内容" class="rich-clear" @click="clearEditor">清空</button>
            </div>
            <div ref="editor" class="rich-editor" contenteditable="true" spellcheck="false" @mouseup="rememberSelection" @keyup="rememberSelection" @input="rememberSelection" data-placeholder="在这里直接输入公告内容，可选择文字后设置加粗、颜色、字号……"></div>
          </div>
          <div class="muted rich-help">提示：先选中文字，再点击上方格式按钮；可直接粘贴文字和链接。</div>
        </div></div>
      <div class="dlg-foot"><button class="cancel" @click="editing.show=false">取消</button><button class="confirm" @click="save">保存</button></div></div></div></div>`,
};

Admin.Settings = {
  setup() {
    const s = reactive({ register_enabled: "true", site_name: "", brand_coupon_rate_bps: "6500", referral_rate_bps: "900", lottery_cost: "200", lottery_daily_limit: "30" });
    async function load() { try { const d = await Api.get("/admin/settings"); Object.assign(s, d); } catch (e) {} }
    async function save() { try { await Api.put("/admin/settings", s); Toast.show("设置已保存"); } catch (e) { Toast.show(e.msg); } }
    onMounted(load);
    return { s, save };
  },
  template: `<div><h2 class="mb12">系统设置</h2>
    <div class="admin-card" style="max-width:520px">
      <div class="row-between mb12"><div><b>允许注册</b><div class="muted">关闭后用户无法注册</div></div>
        <app-switch :model-value="s.register_enabled==='true'" @update:modelValue="v=>s.register_enabled=v?'true':'false'"/></div>
      <div class="field"><div class="field-label">站点名称</div><input class="field-input" v-model="s.site_name"/></div>
      <div class="field"><div class="field-label">全站抢券率(bps,6500=65%)</div><input class="field-input" v-model="s.brand_coupon_rate_bps"/></div>
      <div class="field"><div class="field-label">邀请奖励比例(bps,900=9%)</div><input class="field-input" v-model="s.referral_rate_bps"/></div>
      <div class="field"><div class="field-label">转盘单次消耗(积分)</div><input class="field-input" v-model="s.lottery_cost"/></div>
      <div class="field"><div class="field-label">转盘每日上限(次)</div><input class="field-input" v-model="s.lottery_daily_limit"/></div>
      <div class="mt12"><button class="btn btn-primary" @click="save">保存设置</button></div></div></div>`,
};

// ---------- 小蚕任务总览 ----------
Admin.XiaocanTasks = {
  setup() {
    const panels = ref([]); const loading = ref(true);
    async function load() { loading.value = true; try { panels.value = await Api.get("/admin/xiaocan-tasks"); } catch (e) { Toast.show(e.msg || "加载任务失败"); } finally { loading.value = false; } }
    onMounted(load);
    return { panels, loading, load };
  },
  template: `<div>
    <div class="row-between mb12"><div><h2 style="margin:0">小蚕任务总览</h2><div class="muted mt4">四台青龙中的全部小蚕相关任务</div></div><button class="btn btn-outline btn-sm" @click="load">刷新</button></div>
    <div v-for="panel in panels" :key="panel.id" class="admin-card" style="margin-bottom:16px">
      <div class="row-between mb12"><div><b>🐉 {{panel.name}}</b><div class="muted">{{panel.tasks.length}} 个小蚕任务</div></div><span :class="'tag tag-'+(panel.status==='online'?'success':'gray')">{{panel.status==='online'?'在线':'未测'}}</span></div>
      <div v-if="panel.error" class="muted" style="color:var(--danger)">读取失败：{{panel.error}}</div>
      <table v-else-if="panel.tasks.length" class="admin-table"><tr><th>任务</th><th>定时</th><th>状态</th><th>控制台</th></tr>
        <tr v-for="task in panel.tasks" :key="task.id"><td data-label="任务"><b>{{task.name}}</b><div class="muted mono" style="max-width:360px;overflow:hidden;text-overflow:ellipsis">{{task.command}}</div></td><td data-label="定时" class="mono">{{task.schedule}}</td><td data-label="状态"><span :class="'tag tag-'+(task.isDisabled?'gray':'success')">{{task.isDisabled?'禁用':'启用'}}</span></td><td data-label="控制台"><span :class="'tag tag-'+(task.managed?'primary':'gray')">{{task.managed?'已接入':'未接入'}}</span></td></tr>
      </table><div v-else class="muted">暂无小蚕任务</div>
    </div>
    <app-empty v-if="!loading && !panels.length" text="暂无面板"/>
  </div>`,
};

// ---------- 青龙面板 ----------
Admin.TaskLogs = {
  setup() {
    const now = new Date(), localDay = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0") + "-" + String(now.getDate()).padStart(2,"0");
    const date = ref(localDay), task = ref(""), loading = ref(false), events = ref([]), tasks = ref([]), open = ref(null);
    async function load() { loading.value = true; try { const query = "?date=" + encodeURIComponent(date.value) + (task.value ? "&task=" + encodeURIComponent(task.value) : ""); const d = await Api.get("/admin/task-logs" + query); events.value = d.events || []; tasks.value = d.tasks || []; open.value = null; } catch (e) { Toast.show(e.msg || "读取日志失败"); } finally { loading.value = false; } }
    function stateText(s) { return s === "success" ? "执行成功" : s === "error" ? "存在异常" : "执行记录"; }
    function stateClass(s) { return s === "success" ? "success" : s === "error" ? "danger" : "gray"; }
    onMounted(load);
    return { date, task, loading, events, tasks, open, load, stateText, stateClass };
  },
  template: `<div class="task-log-page"><div class="row-between mb12"><div><h2 style="margin:0">任务日志</h2><div class="muted mt8">四台青龙面板按任务与执行场次合并，按时间顺序展示</div></div><button class="btn btn-outline btn-sm" @click="load">刷新</button></div>
    <div class="task-log-filters"><label class="task-log-date"><span>查看日期</span><input class="field-input" type="date" v-model="date" @change="load"/></label></div>
    <div class="task-log-taskbar"><button :class="['task-log-chip',{active:!task}]" @click="task='';load()">全部</button><button v-for="t in tasks" :key="t.key" :class="['task-log-chip',{active:task===t.key}]" @click="task=t.key;load()">{{t.name}}</button></div>
    <app-empty v-if="!loading && !events.length" text="该日期暂无任务日志"/>
    <div v-for="(e,i) in events" :key="e.task_key + e.time" class="task-log-event"><button class="task-log-head" @click="open=open===i?null:i"><div><b>{{e.time.slice(11,16)}} · {{e.task_name}}</b><span class="muted">{{e.panel_count}} 个面板日志</span></div><div><span :class="'tag tag-'+stateClass(e.state)">{{stateText(e.state)}}</span><span class="log-arrow">{{open===i?'⌃':'⌄'}}</span></div></button><div v-if="open===i" class="task-log-body"><article v-for="x in e.entries" :key="x.panel_id + x.file" class="task-log-entry"><div class="row-between"><b>{{x.panel_name}}</b><span :class="'tag tag-'+stateClass(x.state)">{{stateText(x.state)}}</span></div><div class="muted mt8">{{x.time}} · {{x.file}}</div><pre>{{x.output || '日志为空'}}</pre></article></div></div>
  </div>`,
};

Admin.QLPanels = {
  setup() {
    const list = ref([]); const loading = ref(true);
    const tasks = reactive({}); // panelId -> {show, data, loading}
    const editing = reactive({ show: false, form: {} });
    async function load() { loading.value = true; try { list.value = await Api.get("/admin/ql/panels"); } catch (e) {} finally { loading.value = false; } }
    async function check(p) { try { const d = await Api.post("/admin/ql/panels/" + p.id + "/check"); Toast.show(d.status === "online" ? "✅ 连接成功" : "❌ " + d.msg); await load(); } catch (e) { Toast.show(e.msg); } }
    async function checkAll() { for (const p of list.value) { await check(p); } }
    async function toggleTasks(p) {
      const key = p.id;
      if (!tasks[key]) tasks[key] = { show: false, data: [], loading: false };
      tasks[key].show = !tasks[key].show;
      if (tasks[key].show && !tasks[key].data.length) {
        tasks[key].loading = true;
        try { const d = await Api.get("/admin/ql/panels/" + p.id + "/proxy/api/crons?t=1"); tasks[key].data = (d.data && d.data.data) || d.data || []; }
        catch (e) { Toast.show(e.msg || "获取任务失败"); }
        finally { tasks[key].loading = false; }
      }
    }
    async function runTask(p, t) {
      try { await Api.put("/admin/ql/panels/" + p.id + "/proxy/api/crons/run", { id: t.id }); Toast.show("已触发：" + t.name); }
      catch (e) { Toast.show(e.msg || "运行失败"); }
    }
    async function stopTask(p, t) {
      try { await Api.put("/admin/ql/panels/" + p.id + "/proxy/api/crons/stop", { id: t.id }); Toast.show("已停止：" + t.name); }
      catch (e) { Toast.show(e.msg || "停止失败"); }
    }
    function addPanel() { editing.show = true; editing.form = { name: "青龙面板", remark: "", url: "", username: "admin", password: "123456" }; }
    function editPanel(p) { editing.show = true; editing.form = { ...p, password: "" }; }
    async function savePanel() {
      if (!editing.form.url) return Toast.show("请填写地址");
      try { if (editing.form.id) await Api.put("/admin/ql/panels/" + editing.form.id, editing.form); else await Api.post("/admin/ql/panels", editing.form); Toast.show("已保存"); editing.show = false; await load(); }
      catch (e) { Toast.show(e.msg); }
    }
    async function delPanel(p) { if (!await Dialog.confirm("删除", "确认删除面板「" + p.name + "」？")) return; try { await Api.del("/admin/ql/panels/" + p.id); Toast.show("已删除"); await load(); } catch (e) { Toast.show(e.msg); } }
    onMounted(load);
    const statusType = { online: "success", offline: "danger", unknown: "gray" };
    return { list, loading, tasks, editing, load, check, checkAll, toggleTasks, runTask, stopTask, addPanel, editPanel, savePanel, delPanel, statusType };
  },
  template: `<div>
    <div class="row-between mb12"><h2>青龙面板对接</h2><div class="row gap8">
      <button class="btn btn-outline btn-sm" @click="checkAll">全部测试</button>
      <button class="btn btn-primary btn-sm" @click="addPanel">+ 添加面板</button></div></div>
    <div v-for="p in list" :key="p.id" class="admin-card" style="margin-bottom:16px">
      <div class="row-between">
        <div><b style="font-size:15px">🐉 {{p.remark || p.name}}</b><div v-if="p.remark" class="muted">{{p.name}}</div><div class="muted">{{p.url}} · {{p.username}}</div></div>
        <div class="row gap8">
          <span :class="'tag tag-'+statusType[p.status]||'gray'">{{p.status==='online'?'在线':p.status==='offline'?'离线':'未测'}}</span>
          <button class="btn btn-plain btn-sm" @click="check(p)">测试</button>
          <button class="btn btn-plain btn-sm" @click="toggleTasks(p)">{{tasks[p.id]?.show?'收起任务':'查看任务'}}</button>
          <button class="btn btn-plain btn-sm" @click="editPanel(p)">编辑</button>
          <button class="btn btn-danger btn-sm" @click="delPanel(p)">删除</button>
        </div>
      </div>
      <div v-if="tasks[p.id] && tasks[p.id].show" style="margin-top:12px">
        <div v-if="tasks[p.id].loading" class="muted">加载中...</div>
        <table v-else-if="tasks[p.id].data.length" class="admin-table">
          <tr><th>ID</th><th>任务名</th><th>命令</th><th>定时</th><th>状态</th><th>操作</th></tr>
          <tr v-for="t in tasks[p.id].data" :key="t.id">
            <td data-label="ID">{{t.id}}</td><td data-label="任务名">{{t.name}}</td><td data-label="命令" class="mono" style="max-width:220px;overflow:hidden;text-overflow:ellipsis">{{t.command}}</td>
            <td data-label="定时" class="mono">{{t.schedule}}</td>
            <td data-label="状态"><span :class="'tag tag-'+(t.isDisabled?'gray':'success')">{{t.isDisabled?'禁用':'启用'}}</span></td>
            <td data-label="操作"><button class="btn btn-plain btn-sm" @click="runTask(p,t)">运行</button> <button class="btn btn-outline btn-sm" @click="stopTask(p,t)">停止</button></td>
          </tr>
        </table>
        <div v-else class="muted">暂无任务</div>
      </div>
    </div>
    <app-empty v-if="!list.length && !loading" text="暂无面板"/>
    <div v-if="editing.show" class="overlay" @click.self="editing.show=false"><div class="dialog" style="max-width:400px;text-align:left">
      <div class="dlg-head" style="text-align:center">{{editing.form.id?'编辑面板':'添加面板'}}</div>
      <div style="padding:12px 18px">
        <div class="field"><div class="field-label">名称</div><input class="field-input" v-model="editing.form.name"/></div>
        <div class="field"><div class="field-label">面板备注</div><input class="field-input" v-model="editing.form.remark" maxlength="30" placeholder="如 北京节点 / 主力机"/></div>
        <div class="field"><div class="field-label">地址(如 http://1.2.3.4:5700)</div><input class="field-input" v-model="editing.form.url"/></div>
        <div class="field"><div class="field-label">用户名</div><input class="field-input" v-model="editing.form.username"/></div>
        <div class="field"><div class="field-label">密码</div><input class="field-input" v-model="editing.form.password" placeholder="留空则不改"/></div>
      </div><div class="dlg-foot"><button class="cancel" @click="editing.show=false">取消</button><button class="confirm" @click="savePanel">保存</button></div></div></div>
  </div>`,
};

window.Admin = Admin;
})();
