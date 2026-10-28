'use client';

import type { MyNotificationRow } from './actions';
import { useEffect, useState, useTransition } from 'react';
import {
  fetchMyNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from './actions';
import { Card, fmtTime } from './Ui';

type NotificationData = {
  records: MyNotificationRow[];
  total: number;
  unread: number;
};

export const UserNotifications = () => {
  const [data, setData] = useState<NotificationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();

  const fetchData = async () => {
    const res = await fetchMyNotificationsAction();
    if (res) {
      setData(res);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const markRead = (id: number) => {
    startTransition(async () => {
      await markNotificationReadAction(id);
      await fetchData();
    });
  };

  const markAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      await fetchData();
    });
  };

  const records = data?.records ?? [];
  const unread = data?.unread ?? 0;

  return (
    <Card
      title="站内信通知"
      description={unread > 0 ? `您有 ${unread} 条未读消息` : '所有消息已读'}
    >
      {/* 操作栏 */}
      {unread > 0 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={markAllRead}
            disabled={pending}
            className="
              rounded-md border border-input bg-background px-3 py-1.5 text-xs
              font-medium text-foreground shadow-xs transition-colors
              hover:bg-muted
            "
          >
            {pending ? '处理中…' : '全部已读'}
          </button>
        </div>
      )}

      {loading
        ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              加载中…
            </div>
          )
        : records.length === 0
          ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                暂无站内信通知
              </div>
            )
          : (
              <div className="flex flex-col gap-2">
                {records.map(n => (
                  <div
                    key={n.id}
                    className={`
                      flex items-start justify-between rounded-lg border p-3
                      text-xs transition-colors
                      ${n.is_read
                        ? 'bg-muted/10 opacity-70'
                        : 'border-primary/20 bg-primary/5'}
                    `}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {!n.is_read && (
                          <span className="size-2 shrink-0 rounded-full bg-primary" />
                        )}
                        <span className="font-semibold text-foreground">
                          {n.title}
                        </span>
                        <span className="
                          rounded bg-muted px-1.5 py-0.5 text-[10px]
                          text-muted-foreground
                        "
                        >
                          {n.type === 'system' ? '系统' : n.type}
                        </span>
                      </div>
                      {n.content && (
                        <p className="whitespace-pre-line text-muted-foreground">
                          {n.content}
                        </p>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {fmtTime(n.created_time)}
                      </span>
                    </div>
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        disabled={pending}
                        className="
                          ml-2 shrink-0 rounded border border-input px-2 py-1
                          text-[10px] text-muted-foreground
                          hover:bg-muted hover:text-foreground
                        "
                      >
                        已读
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
    </Card>
  );
};
