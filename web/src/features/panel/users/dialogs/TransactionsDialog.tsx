'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useEffect, useState } from 'react';
import { fetchUserTransactionsAction } from '@/features/panel/actions';
import { fen, fmtTime } from '@/features/panel/Ui';

type TxRecord = {
  id: number;
  amount: number;
  type: string;
  note: string;
  created_time: string;
};

const PAGE_SIZE = 15;

/**
 * 12. 收支明细弹窗：打开时拉第一页，底部分页继续拉。
 *
 * 加载态不用额外的 `loading` 布尔量：以「当前请求 key」与「已拿到的数据 key」比较推导，
 * 这样翻页只需 setPage，effect 内不再同步 setState（避免多余的二次渲染）。
 */
export const TransactionsDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
}) => {
  const [page, setPage] = useState(1);
  const [store, setStore] = useState<{ key: string; records: TxRecord[]; total: number } | null>(null);

  const { user } = props;
  const key = `${user.id}#${page}`;
  const loading = store?.key !== key;
  const records = store?.records ?? [];
  const total = store?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    let alive = true;
    fetchUserTransactionsAction(user.id, page).then((data) => {
      if (!alive || !data) {
        return;
      }
      setStore({ key: `${user.id}#${page}`, records: data.records, total: data.total });
    });
    return () => {
      alive = false;
    };
  }, [user.id, page]);

  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
      backdrop-blur-xs
    "
    >
      <div className="
        flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-card
        shadow-xl
      "
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              📋
              {' '}
              {user.nickname}
              {' '}
              的收支明细
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              余额
              {' '}
              <span className="font-mono font-semibold text-emerald-600">{fen(user.points_balance)}</span>
              {' '}
              · 共
              {total}
              {' '}
              条流水
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="
              rounded-lg p-2 text-muted-foreground
              hover:bg-muted hover:text-foreground
            "
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading
            ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  加载中…
                </div>
              )
            : records.length === 0
              ? (
                  <div className="
                    py-12 text-center text-sm text-muted-foreground
                  "
                  >
                    暂无收支记录
                  </div>
                )
              : (
                  <div className="flex flex-col gap-1.5">
                    {records.map(tx => (
                      <div
                        key={tx.id}
                        className="
                          flex items-center justify-between rounded-lg border
                          px-3 py-2 text-xs
                          hover:bg-muted/20
                        "
                      >
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{tx.note || tx.type}</span>
                          <span className="
                            font-mono text-[10px] text-muted-foreground
                          "
                          >
                            {fmtTime(tx.created_time)}
                          </span>
                        </div>
                        <span className={`
                          font-mono font-semibold
                          ${tx.amount > 0 ? `text-emerald-600` : `text-rose-600`}
                        `}
                        >
                          {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
        </div>
        {/* 分页 */}
        {total > PAGE_SIZE && (
          <div className="
            flex items-center justify-center gap-2 border-t px-4 py-2.5
          "
          >
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage(page - 1)}
              className="
                rounded-sm border px-2.5 py-1 text-xs
                hover:bg-muted
                disabled:opacity-40
              "
            >
              ← 上一页
            </button>
            <span className="text-xs text-muted-foreground">
              {page}
              {' '}
              /
              {totalPages}
              {' '}
              页
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(page + 1)}
              className="
                rounded-sm border px-2.5 py-1 text-xs
                hover:bg-muted
                disabled:opacity-40
              "
            >
              下一页 →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
