'use client';

import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { CheckInSyncContext } from './CheckInSyncContext';

/**
 * 签到页的「余额」同步层（Provider）。
 *
 * 余额是"钱"，必须**服务端为准**：
 *   1. 操作成功后，用**服务端返回的余额**立刻刷新显示
 *      （不是前端自己算的，所以不存在乐观更新猜错的竞态）
 *   2. `router.refresh()` 回来后下发新的服务端余额 → 丢弃本地覆盖，回到服务端为准
 *      （万一服务端的值和刚才不同，以服务端为准）
 *   3. `version` 自增，供日历作为"该重新拉取了"的信号
 *      （日历有自己的接口，服务端组件的 refresh 不会让它重新请求）
 */
export const CheckInSyncProvider = (props: {
  /** 服务端下发的权威余额（每次 router.refresh 后更新） */
  serverBalance: number;
  children: ReactNode;
}) => {
  // 操作后暂时覆盖显示的值（来自服务端返回值，不是前端猜测）
  const [override, setOverride] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const [lastServer, setLastServer] = useState(props.serverBalance);

  // 服务端下发了新余额 → 丢掉本地覆盖，交还给服务端。
  // 渲染期同步：React 官方的 derived state 写法，比 useEffect 少一次渲染，
  // 也不会出现"乐观值被旧 props 覆盖"的回退闪烁。
  if (props.serverBalance !== lastServer) {
    setLastServer(props.serverBalance);
    setOverride(null);
  }

  const commit = useCallback((serverBalance?: number) => {
    if (typeof serverBalance === 'number') {
      setOverride(serverBalance);
    }
    setVersion(v => v + 1);
  }, []);

  return (
    /* React 19：直接渲染 <Context> 作为 Provider */
    <CheckInSyncContext value={{ balance: override ?? props.serverBalance, commit, version }}>
      {props.children}
    </CheckInSyncContext>
  );
};
