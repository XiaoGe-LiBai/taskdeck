/**
 * 登录态 cookie 名（独立常量，**不要**放进 PanelApi.ts）。
 *
 * 原因：middleware（src/proxy.ts）运行在 Edge Runtime，而 PanelApi.ts 依赖
 * `next/headers`（Node/服务端专用）。把 cookie 名单独放这里，middleware 就不必
 * 为一个字符串常量去加载服务端模块。
 */
export const SESSION_COOKIE = 'xc_panel_token';
export const USER_COOKIE = 'xc_panel_user';
