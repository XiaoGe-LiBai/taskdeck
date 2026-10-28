import { createContext, use } from 'react';

/**
 * 签到页的「余额」同步层 —— Context 与读取 Hook。
 *
 * 单独放一个 .ts 文件（不含组件），这样组件文件只导出组件，
 * React Fast Refresh 才能正常工作。
 *
 * 背景：签到页有三个组件各自显示/改余额（签到卡、日历的补签、记录），
 * 之前签到卡把余额存在自己的 useState 里，**别的组件改了它不知道**
 * （补签扣了 30 分，余额纹丝不动）。
 */
export type CheckInSyncValue = {
  /** 当前应显示的余额 */
  balance: number;
  /** 操作成功后调用：传服务端返回的余额（可空），并广播"数据变了" */
  commit: (serverBalance?: number) => void;
  /** 数据变更版本号，日历用它当 effect 依赖重新拉取 */
  version: number;
};

export const CheckInSyncContext = createContext<CheckInSyncValue>({
  balance: 0,
  commit: () => {},
  version: 0,
});

export const useCheckInSync = () => use(CheckInSyncContext);
