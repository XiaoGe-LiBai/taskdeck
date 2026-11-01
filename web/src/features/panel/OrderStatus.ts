/**
 * 霸王餐订单状态的统一口径。
 *
 * 助手页与「我的记录」都会显示订单状态，标签和色调必须一致，
 * 否则同一个 status 在两个页面译成不同中文，用户会以为是两回事。
 */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: '待提交',
  auditing: '审核中',
  completed: '已到账',
  rejected: '已拒绝',
  cancelled: '已取消',
};

export const ORDER_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'gray'> = {
  completed: 'success',
  auditing: 'warning',
  rejected: 'danger',
  pending: 'gray',
  cancelled: 'gray',
};

/** 空串表示「全部」，与后端 status 取值同名。 */
export const ORDER_STATUS_FILTERS = ['', 'pending', 'auditing', 'completed', 'rejected', 'cancelled'];

/** 平台标识同样要统一口径：库里存的是英文 key，界面一律显示中文。 */
export const ORDER_PLATFORM_LABEL: Record<string, string> = {
  meituan: '美团',
  eleme: '饿了么',
  jingdong: '京东',
};
