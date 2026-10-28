// ============ UI 组件 & 工具 ============
(function () {
const { h, reactive, ref, computed } = Vue;

// ---------- Toast ----------
let toastTimer = null;
window.Toast = {
  show(msg, ms = 1800) {
    let el = document.getElementById("__toast");
    if (!el) { el = document.createElement("div"); el.id = "__toast"; el.className = "toast"; el.style.opacity = "0"; el.style.transition = "opacity .15s"; document.body.appendChild(el); }
    el.textContent = msg; el.style.opacity = "1"; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = "0"; }, ms);
  },
};

// ---------- Dialog ----------
window.Dialog = {
  confirm(title, content) {
    return new Promise((resolve) => {
      const w = document.createElement("div"); w.className = "overlay";
      // Render both real and escaped newlines as line breaks in confirmation dialogs.
      const rendered = String(content || "").replace(/\\n/g, "<br>").replace(/\n/g, "<br>");
      w.innerHTML = `<div class="dialog"><div class="dlg-head">${title || "提示"}</div><div class="dlg-body">${rendered}</div><div class="dlg-foot"><button class="cancel">取消</button><button class="confirm">确定</button></div></div>`;
      document.body.appendChild(w);
      w.querySelector(".cancel").onclick = () => { w.remove(); resolve(false); };
      w.querySelector(".confirm").onclick = () => { w.remove(); resolve(true); };
      w.onclick = (e) => { if (e.target === w) { w.remove(); resolve(false); } };
    });
  },
  alert(title, content) {
    return new Promise((resolve) => {
      const w = document.createElement("div"); w.className = "overlay";
      w.innerHTML = `<div class="dialog"><div class="dlg-head">${title || "提示"}</div><div class="dlg-body">${content || ""}</div><div class="dlg-foot"><button class="confirm" style="border-left:none;width:100%">知道了</button></div></div>`;
      document.body.appendChild(w);
      w.querySelector(".confirm").onclick = () => { w.remove(); resolve(true); };
    });
  },
};

const UI = {};

UI.RedeemPicker = {
  props: { accountId: Number, modelValue: Object, apiBase: { default: "/xiaocan/accounts" } },
  emits: ["update:modelValue"],
  data() { return { prizes: [], draft: String(this.modelValue.exchange_id || ""), loading: false, saving: false, error: "", loaded: false }; },
  computed: {
    selected() { return this.prizes.find(p => String(p.exchange_id) === this.draft); },
    changed() { return this.draft !== String(this.modelValue.exchange_id || ""); },
    canEnable() { return !!this.selected?.available && !this.changed && !!this.modelValue.runner_ready && !this.loading && !this.saving; },
  },
  mounted() { this.loadPrizes(); },
  methods: {
    timeText(ts) { return ts ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(ts * 1000)) : "未提供"; },
    async loadPrizes() {
      if (this.loading || this.saving) return;
      this.loading = true; this.error = "";
      try { this.prizes = await Api.get(this.apiBase + "/" + this.accountId + "/redeem-prizes"); this.loaded = true; }
      catch (e) { this.prizes = []; this.loaded = false; this.error = e.msg || "获取奖品列表失败，请重试"; }
      finally { this.loading = false; }
    },
    async save(enabled) {
      if (this.saving) return;
      const stopping = this.modelValue.enabled && !enabled;
      const id = stopping ? this.modelValue.exchange_id : this.selected?.exchange_id;
      if (!stopping && (!this.selected?.available || (enabled && this.changed))) { Toast.show(this.changed && enabled ? "请先保存奖品，再开启任务" : "请选择可抢兑奖品"); return; }
      this.saving = true;
      try {
        const d = await Api.put(this.apiBase + "/" + this.accountId + "/redeem", { exchange_id: id, start_at: stopping ? undefined : this.selected.start_at, enabled: !!enabled });
        this.$emit("update:modelValue", d);
        Toast.show(enabled ? "抢兑已开启" : stopping ? "抢兑已关闭" : "奖品已保存，抢兑保持关闭");
      } catch (e) { Toast.show(e.msg || "抢兑设置失败"); }
      finally { this.saving = false; }
    },
  },
  template: `<div class="redeem-setting">
    <div class="redeem-heading"><b>抢兑</b><span class="muted">{{modelValue.runner_ready?'按所属青龙面板执行':'青龙运行器尚未接通'}}</span></div>
    <div class="redeem-prize-row"><select class="field-input redeem-prize-select" v-model="draft" :disabled="loading || saving || !loaded || modelValue.enabled" aria-label="选择抢兑奖品">
      <option value="">{{loading?'正在获取奖品…':'请选择奖品'}}</option>
      <option v-if="draft && !selected" :value="draft" disabled>已保存奖品 ID {{draft}}（当前列表未找到）</option>
      <option v-for="p in prizes" :key="p.group+':'+p.exchange_id" :value="String(p.exchange_id)" :disabled="!p.available">{{p.name}} · {{p.yuanbao_cost == null ? '元宝数未提供' : p.yuanbao_cost + '元宝'}} · {{p.group}} · {{timeText(p.start_at)}}{{!p.available?'（不可抢兑）':!p.upcoming?'（等待新场次）':''}}</option>
    </select><button class="btn btn-plain btn-sm" type="button" @click="loadPrizes" :disabled="loading || saving">刷新奖品</button></div>
    <div v-if="selected" class="redeem-prize-detail"><strong>{{selected.name}}</strong><span>所需元宝：{{selected.yuanbao_cost == null ? '未提供' : selected.yuanbao_cost}}</span><span>兑换 ID：{{selected.exchange_id}}</span><span>开抢：{{timeText(selected.start_at)}}</span><span v-if="selected.end_at">结束：{{timeText(selected.end_at)}}</span><span v-if="selected.available && selected.upcoming">任务启动：{{timeText(selected.start_at-20)}}（提前20秒）</span><span v-else-if="selected.available">当前场次已过或临近，保存后等待接口更新下一场次，不会立即兑换。</span></div>
    <div v-if="error" class="redeem-error" role="alert">{{error}}</div><div v-else-if="loaded && !prizes.length" class="muted">当前账号暂无奖品</div>
    <div class="redeem-controls"><button class="btn btn-outline btn-sm" type="button" @click="save(false)" :disabled="saving || loading || modelValue.enabled || !selected?.available">{{saving?'保存中…':'保存奖品'}}</button><span v-if="changed" class="muted">未保存</span><span class="redeem-state">{{modelValue.enabled?'已开启':'已关闭'}}</span><app-switch :model-value="modelValue.enabled" :disabled="saving || (!modelValue.enabled && !canEnable)" @update:modelValue="save"/></div>
  </div>`,
};

UI.Button = {
  props: { type: { default: "primary" }, block: Boolean, size: { default: "" }, disabled: Boolean, loading: Boolean },
  emits: ["click"],
  template: `<button :class="['btn','btn-'+type,{'btn-block':block,'btn-sm':size==='sm','btn-lg':size==='lg'}]" :disabled="disabled||loading" @click="$emit('click')"><slot></slot></button>`,
};

UI.Field = {
  props: { label: String, placeholder: String, modelValue: [String, Number], type: { default: "text" }, required: Boolean, maxlength: [String, Number] },
  emits: ["update:modelValue"],
  template: `<div class="field"><div class="field-label" v-if="label">{{label}}<span class="req" v-if="required">*</span></div><input class="field-input" :type="type" :placeholder="placeholder" :value="modelValue" :maxlength="maxlength" @input="$emit('update:modelValue', $event.target.value)"/></div>`,
};

UI.Switch = {
  props: { modelValue: Boolean, disabled: { default: false } },
  emits: ["update:modelValue"],
  template: `<label class="switch"><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="$emit('update:modelValue', $event.target.checked)"/><span class="track"></span></label>`,
};

UI.Cell = {
  props: { icon: String, title: String, sub: String, value: String, arrow: { type: Boolean, default: true } },
  emits: ["click"],
  template: `<div class="cell" :class="{'cell-action': $attrs.onClick}" @click="$emit('click')"><div class="cell-icon" v-if="icon">{{icon}}</div><div class="cell-main"><div class="cell-title">{{title}}</div><div class="cell-sub" v-if="sub">{{sub}}</div></div><div class="cell-value" v-if="value!==undefined&&value!==null&&value!==''">{{value}}</div><div class="arrow" v-if="arrow">›</div></div>`,
};

UI.Tag = { props: { type: { default: "info" } }, template: `<span :class="'tag tag-'+type"><slot></slot></span>` };

UI.NavBar = {
  props: { title: String, back: { type: Boolean, default: true } },
  emits: ["back"],
  template: `<div class="navbar"><div class="nb-left" v-if="back" role="button" tabindex="0" @click="goBack" @keydown.enter="goBack" @keydown.space.prevent="goBack">‹ 返回</div><div class="nb-left" v-else></div><div class="nb-title">{{title}}</div><div class="nb-right"><slot name="right"></slot></div></div>`,
  methods: {
    goBack() {
      this.$emit("back");
      const router = window.AppRouter;
      const current = router?.currentRoute?.value?.path || "";
      // A page opened directly has no usable in-app history. Use its parent
      // route so the visible return control always performs an action.
      const fallback = current.startsWith("/admin/") || current === "/admin"
        ? "/admin"
        : current === "/bind" ? "/accounts"
        : current === "/billing" ? "/accounts"
        : current === "/points" ? "/profile"
        : "/home";
      // Use an explicit parent route so the action is deterministic even
      // when the page was opened directly or browser history is unavailable.
      if (window.navigateTo) window.navigateTo(fallback);
    },
  },
};

UI.Empty = { props: { text: { default: "暂无数据" } }, template: `<div class="empty">{{text}}</div>` };

UI.TabBar = {
  props: { active: String },
  setup() {
    const auth = getAuth();
    const I = (p) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const baseTabs = [
      { key: "home", icon: I('<path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'), text: "首页" },
      { key: "accounts", icon: I('<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.6"/><path d="M15 14.5c2.8.3 4.5 2.2 4.5 4.5"/>'), text: "账号" },
      { key: "profile", icon: I('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>'), text: "我的" },
    ];
    const tabs = computed(() => auth.isAdmin ? baseTabs.concat({ key: "admin", icon: I('<path d="M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3z"/><path d="M9 12l2 2 4-4"/>'), text: "管理" }) : baseTabs);
    return { tabs };
  },
  template: `<div class="tabbar"><div v-for="t in tabs" :class="['tab',{active:active===t.key}]" @click="go(t.key)"><span class="ti" v-html="t.icon"></span><span>{{t.text}}</span></div></div>`,
  methods: { go(k) { window.navigateTo(k); } },
};

// ---------- 签到日历 ----------
UI.Calendar = {
  props: { signedDates: { default: () => [] }, year: Number, month: Number },
  template: `<div>
    <div class="cal-head"><div class="cm-title">{{year}}年{{month}}月</div></div>
    <div class="cal-grid">
      <div class="cw" v-for="w in ['日','一','二','三','四','五','六']" :key="w">{{w}}</div>
      <template v-for="(d,i) in days" :key="i"><div class="cd" :class="{empty:!d, signed: d && signedSet.includes(d), today: d && isToday(d)}"><span v-if="d">{{d.slice(-2)*1}}</span><span class="dot" v-if="d && signedSet.includes(d)"></span></div></template>
    </div></div>`,
  computed: {
    signedSet() { return this.signedDates || []; },
    days() {
      const first = new Date(this.year, this.month - 1, 1).getDay();
      const dim = new Date(this.year, this.month, 0).getDate();
      const arr = [];
      for (let i = 0; i < first; i++) arr.push(0);
      for (let d = 1; d <= dim; d++) {
        const dd = String(d).padStart(2, "0");
        const mm = String(this.month).padStart(2, "0");
        arr.push(`${this.year}-${mm}-${dd}`);
      }
      return arr;
    },
  },
  methods: {
    isToday(d) { const t = new Date(); return d === `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`; },
  },
};

// ---------- 转盘 ----------
UI.Wheel = {
  props: { prizes: { default: () => [] }, spinning: Boolean },
  emits: ["draw"],
  data() { return { rotation: 0, colors: ["#ff7a00","#ff9d3c","#ff5e00","#ffb366","#e56e00","#ffc285","#ff8c1a"] }; },
  computed: { segCount() { return this.prizes.length || 1; } },
  methods: {
    segStyle(i) {
      const seg = 360 / this.segCount;
      return { transform: `rotate(${i * seg}deg) skewY(${seg - 90}deg)`, background: this.colors[i % this.colors.length] };
    },
    spinTo(idx) {
      const seg = 360 / this.segCount;
      this.rotation = 360 * 6 + (360 - (idx * seg + seg / 2));
    },
  },
  template: `<div class="wheel-wrap">
    <div class="wheel-pointer"></div>
    <div class="wheel" :style="{transform:'rotate('+rotation+'deg)'}">
      <div v-for="(p,i) in prizes" :key="i" class="wheel-seg" :style="segStyle(i)"><div class="seg-name">{{p.name}}</div><div class="seg-pts">{{(p.reward_points/100).toFixed(2)}}</div></div>
    </div>
    <div class="wheel-hub" @click="$emit('draw')">{{spinning?'...':'抽奖'}}</div>
  </div>`,
};

window.UI = UI;
})();
