/**
 * 面板写操作 server action 的统一出口（barrel，只做转发）。
 *
 * 统一约定：所有写操作 server action 都返回 "ok:..." / "error:..." 字符串，
 * 客户端表单（ActionForm / StateForm / FeedbackButton）据此展示结果，
 * 杜绝「点了按钮没反应但其实失败了」的静默失败。
 *
 * 实现按域拆在下面这些同级文件里，导入方继续用 `@/features/panel/actions` 即可：
 *   accounts.ts       小蚕账号：任务开关 / 到期 / 报名 / 删除 / 批量延长
 *   cards.ts          卡密、卡密档位、积分商品、拖拽排序
 *   users.ts          用户管理：积分 / 车位 / 会员 / 权限 / 批量 / 详情流水
 *   panels.ts         青龙面板：连通检测 / 下发任务 / cron 运行停止 / 增删
 *   announcements.ts  公告发布编辑删除
 *   me.ts             个人中心：签到 / 卡密兑换 / 推送设置 / 站内信 / 换绑邮箱
 *   settings.ts       系统设置与邮件服务
 */

export {
  batchExpireAction,
  deleteAccountAction,
  refreshAccountLevelAction,
  refreshAccountLevelsAction,
  refreshOwnAccountLevelAction,
  setAccountExpireAction,
  signupAccountAction,
  toggleAccountFeatureAction,
  toggleAccountStatusAction,
  toggleOwnFeatureAction,
} from './accounts';

export {
  deleteAnnouncementAction,
  saveAnnouncementAction,
} from './announcements';

export {
  deleteCardsAction,
  deleteCardTierAction,
  deleteProductAction,
  generateCardsAction,
  reorderCatalogAction,
  saveCardTierAction,
  saveProductAction,
  voidCardsAction,
} from './cards';

export {
  changeEmailAction,
  changePasswordAction,
  doCheckInAction,
  fetchCheckInCalendarAction,
  fetchMyNotificationsAction,
  makeupCheckInAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  purchaseProductAction,
  redeemPointsCardAction,
  saveNotifySettingsAction,
  sendEmailChangeCodeAction,
} from './me';

export type { CheckInCalendarData, CheckInCalendarDay } from './me';

export type { MyNotificationRow } from './me';

export {
  addPanelAction,
  checkPanelAction,
  deletePanelAction,
  provisionPanelAction,
  runCronAction,
  stopCronAction,
} from './panels';

export {
  deleteSiteLogoAction,
  saveSettingsAction,
  testMailAction,
  testNotifyChannelAction,
  toggleSiteLogoAction,
  uploadSiteLogoAction,
} from './settings';

export {
  adjustUserPointsAction,
  adjustUserSlotsAction,
  batchUsersAction,
  createUserAction,
  deleteUserAction,
  fetchUserDetailAction,
  fetchUserTransactionsAction,
  fetchVipLevelsAction,
  grantUserBenefitsAction,
  grantUserProjectsAction,
  kickUserAction,
  renameUserAction,
  resetUserPasswordAction,
  sendUserNotificationAction,
  toggleUserRoleAction,
  toggleUserStatusAction,
  updateUserMembershipAction,
  updateUserRemarkAction,
} from './users';

export type { VipLevelBenefit } from './users';

export {
  callXiaocanAction,
  cancelMeituanAuthAction,
  claimMeituanAction,
  deleteMeituanAccountAction,
  pollMeituanAuthAction,
  saveMeituanTokenAction,
  startMeituanAuthAction,
  clearJobLogsAction,
  fetchStoresAction,
  runAdminXiaocanDailyAction,
  runMyXiaocanDailyAction,
  runXiaocanDailyAction,
  scheduleGrabAction,
} from './xiaocan';

export type { MeituanAccount, MeituanSession, StoreItem, StoresResult, XcAction, XcActionParam, XcDailyResult, XcDailyStep } from './xiaocan';
