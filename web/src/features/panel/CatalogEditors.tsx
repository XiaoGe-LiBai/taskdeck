'use client';

import type { PanelCardTier, PanelProduct } from '@/types/Panel';
import { useActionState, useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import { ConfettiBurst } from '@/components/reactbits';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/utils/Helpers';
import {
  deleteCardTierAction,
  deleteProductAction,
  reorderCatalogAction,
  saveCardTierAction,
  saveProductAction,
} from './actions';
import { fen, Table, Td } from './Ui';

/**
 * 档位 / 商品的编辑与排序。
 *
 * 三个坑这里都绕开了：
 * 1) `Card` 底层是 `.spotlight-card`（overflow:hidden）。编辑表单贴在窄网格卡片里会被裁掉右侧
 *    （实测面板 288px、卡片只有 272px），所以编辑态改成**整行展开**（colSpan 占满表格宽度）。
 * 2) 排序是「拖动」改本地顺序、点「保存排序」才落库，避免每拖一次发一次请求。
 * 3) 拖拽用 **pointer 事件**而不是 HTML5 `draggable`：后者在触屏（手机/平板）上根本不触发，
 *    pointer 事件鼠标与触摸通吃，手柄上加 `touch-none` 防止拖动时页面跟着滚。
 */

/**
 * 同构 layout effect：这个组件会先被 SSR，服务端没有 DOM，
 * 直接用 useLayoutEffect 会打印 "does nothing on the server" 警告。
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const ACTION_BTN = `
  rounded-md border px-2.5 py-1 text-xs font-medium transition-colors
  hover:bg-muted disabled:opacity-50
`;

/** 拖拽排序的本地状态机；save() 才写库 */
function useReorderable<T extends { id: number }>(items: T[], table: 'card_tiers' | 'products') {
  const [order, setOrder] = useState(items);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const [saving, startSaving] = useTransition();
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  const dragIdRef = useRef<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const topsRef = useRef(new Map<number, number>());
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const appliedXRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  // 行入场动画（.rtable tbody > tr）是 0.35s + 最多 290ms 延迟；播完后禁掉它，
  // 否则 React 重排 DOM 会重启动画、并按 CSS 规则盖掉拖拽的行内 transform
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(setIntroDone, 800, true);
    return () => clearTimeout(timer);
  }, []);

  /**
   * 被拖行的「跟随」视觉：抬起 + 横向轻微偏移（不旋转整行——旋转表格行会让所有单元格一起歪）。
   *
   * 两个性能要点：
   * 1) 走 rAF 节流 + 直接写 DOM，**不走 React state**：早先每个 pointermove 都 setState，
   *    整张表重渲 + 行上挂着 transition，每次都重启过渡，行追不上指针、看着发飘。
   * 2) getBoundingClientRect 里已经含了上一帧写入的位移，所以要减掉已应用的偏移，避免自激漂移。
   */
  const paintDraggedRow = () => {
    rafRef.current = null;
    const dragId = dragIdRef.current;
    const point = pointRef.current;
    if (dragId === null || !point) {
      return;
    }
    const el = rowRefs.current.get(dragId);
    if (!el) {
      return;
    }
    const baseLeft = el.getBoundingClientRect().left - appliedXRef.current;
    const ratio = Math.max(-0.5, Math.min(0.5, (point.x - baseLeft) / (el.offsetWidth || 1) - 0.5));
    appliedXRef.current = ratio * 10;
    el.style.transform = `translate(${appliedXRef.current.toFixed(1)}px, -3px) scale(1.01)`;
  };

  const schedulePaint = () => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(paintDraggedRow);
    }
  };

  /**
   * FLIP：顺序变化后把「让位行」从旧位置平滑滑到新位置。
   * 被拖的那一行不参与（它由指针驱动，带自己的倾斜）。
   */
  useIsomorphicLayoutEffect(() => {
    const prevTops = topsRef.current;
    const nextTops = new Map<number, number>();
    rowRefs.current.forEach((el, id) => {
      const top = el.getBoundingClientRect().top;
      nextTops.set(id, top);
      const before = prevTops.get(id);
      if (before === undefined || dragIdRef.current === id) {
        return;
      }
      const delta = before - top;
      if (Math.abs(delta) < 1) {
        return;
      }
      el.style.animation = 'none';
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.transform = '';
      });
    });
    topsRef.current = nextTops;
  }, [order]);

  /** 手柄按下：接管指针，后续 move/up 都会派发到这个元素上 */
  const startDrag = (item: T, event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragIdRef.current = item.id;
    setDraggingId(item.id);
  };

  /** 指针移动：用命中测试找当前悬停在哪一行，直接把被拖项挪到该位置 */
  const dragMove = (event: React.PointerEvent<HTMLElement>) => {
    const dragId = dragIdRef.current;
    if (dragId === null) {
      return;
    }
    pointRef.current = { x: event.clientX, y: event.clientY };
    schedulePaint();
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const row = hit?.closest('tr[data-row-index]');
    const to = Number((row as HTMLElement | null)?.dataset.rowIndex);
    if (Number.isNaN(to)) {
      return;
    }
    setOrder((prev) => {
      const from = prev.findIndex(item => item.id === dragId);
      if (from === -1 || from === to) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(from, 1);
      if (!item) {
        return prev;
      }
      next.splice(to, 0, item);
      return next;
    });
    setDirty(true);
    setMsg('');
    setOverIndex(to);
    pointRef.current = { x: event.clientX, y: event.clientY };
    schedulePaint();
  };

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const el = dragIdRef.current === null ? undefined : rowRefs.current.get(dragIdRef.current);
    if (el) {
      // 松手时用短过渡归位（拖动过程中不加过渡，否则行会一直追不上指针）
      el.style.transition = 'transform 160ms ease-out';
      el.style.transform = '';
      window.setTimeout(() => {
        el.style.transition = '';
      }, 220);
    }
    appliedXRef.current = 0;
    pointRef.current = null;
    dragIdRef.current = null;
    setDraggingId(null);
    setOverIndex(null);
  };

  /** 行 ref 收集：FLIP 与倾斜都要拿真实 DOM 量位置 */
  const rowRef = (id: number) => (el: HTMLTableRowElement | null) => {
    if (el) {
      rowRefs.current.set(id, el);
    } else {
      rowRefs.current.delete(id);
    }
  };

  const save = () => {
    startSaving(async () => {
      const result = await reorderCatalogAction(table, order.map(item => item.id));
      setMsg(result);
      if (result.startsWith('ok:')) {
        setDirty(false);
        setBurst(fire => fire + 1); // 保存成功撒一轮彩带
      }
    });
  };

  /** 撤销：回到服务端当前的顺序 */
  const reset = () => {
    setOrder(items);
    setDirty(false);
    setMsg('');
  };

  return { order, dirty, msg, saving, save, reset, burst, draggingId, overIndex, introDone, startDrag, dragMove, endDrag, rowRef };
}

/** 排序工具条：说明 + 保存/撤销 + 结果反馈 */
const SortToolbar = (props: {
  dirty: boolean;
  saving: boolean;
  msg: string;
  onSave: () => void;
  onReset: () => void;
  burst: number;
}) => {
  const ok = props.msg.startsWith('ok:');
  const error = props.msg.startsWith('error:') ? props.msg.slice(6) : '';
  return (
    <div className="relative mb-3 flex flex-wrap items-center gap-2 text-xs">
      <ConfettiBurst fire={props.burst} />
      <span className="text-muted-foreground">
        按住行首
        <span className="mx-0.5 font-mono">⠿</span>
        拖动即可调整顺序（手机也能拖）
      </span>
      <button
        type="button"
        onClick={props.onSave}
        disabled={!props.dirty || props.saving}
        className={cn(ACTION_BTN, props.dirty && `
          border-primary/40 bg-primary/10 text-primary
        `)}
      >
        {props.saving ? '保存中…' : props.dirty ? '保存排序 *' : '保存排序'}
      </button>
      {props.dirty && (
        <button type="button" onClick={props.onReset} className={ACTION_BTN}>
          撤销改动
        </button>
      )}
      {props.dirty && <span className="text-amber-600">顺序有未保存的改动</span>}
      {ok && <span className="text-emerald-600">{props.msg.slice(3)}</span>}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
};

/** 行首的拖拽手柄 + 序号（pointer 事件，鼠标与触屏通用） */
const OrderCell = (props: {
  index: number;
  label: string;
  dragging: boolean;
  drag: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  };
}) => (
  <Td className="w-16">
    <span
      data-drag-handle
      aria-label={`拖动排序：${props.label}`}
      title="按住拖动排序（鼠标 / 触屏都可）"
      {...props.drag}
      className={cn(
        `
          inline-flex cursor-grab touch-none items-center gap-1.5 select-none
          active:cursor-grabbing
        `,
        props.dragging && 'drag-handle-active',
      )}
    >
      <span className="text-muted-foreground">⠿</span>
      <span className="
        w-4 text-center text-xs text-muted-foreground tabular-nums
      "
      >
        {props.index + 1}
      </span>
    </span>
  </Td>
);

/* ---------------------------------------------------------------- 卡密档位 */

const TierForm = (props: { tier?: PanelCardTier; onDone?: () => void }) => {
  const [state, formAction, pending] = useActionState(saveCardTierAction, '');
  const [delState, delAction, delPending] = useActionState(deleteCardTierAction, '');
  const tier = props.tier;
  const ok = state.startsWith('ok:');
  const error = state.startsWith('error:') ? state.slice(6) : '';

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        {tier && <input type="hidden" name="tier_id" value={tier.id} />}
        <label className="flex w-56 flex-col gap-1 text-xs font-medium">
          名称
          <Input
            name="name"
            defaultValue={tier?.name ?? ''}
            placeholder="如：1000 积分档"
            className="h-9 text-sm"
            required
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-xs font-medium">
          面额（分）
          <Input
            name="points_value"
            type="number"
            min={0}
            defaultValue={tier?.points_value ?? 0}
            className="h-9 text-sm"
            required
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-xs font-medium">
          售价（元）
          <Input
            name="price"
            type="number"
            min={0}
            step={0.01}
            defaultValue={tier?.price ?? 0}
            className="h-9 text-sm"
            required
          />
        </label>
        <label className="flex w-28 flex-col gap-1 text-xs font-medium">
          排序值
          <Input
            name="sort_order"
            type="number"
            defaultValue={tier?.sort_order ?? 0}
            className="h-9 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            name="status"
            defaultChecked={tier?.status !== 'disabled'}
            className="size-4"
          />
          启用
        </label>
        <button
          type="submit"
          disabled={pending}
          className="
            h-9 rounded-md bg-primary px-4 text-xs font-medium
            text-primary-foreground
            hover:opacity-90
            disabled:opacity-60
          "
        >
          {pending ? '保存中…' : '保存'}
        </button>
        {props.onDone && (
          <button
            type="button"
            onClick={props.onDone}
            className={cn(ACTION_BTN, `h-9`)}
          >
            收起
          </button>
        )}
        {ok && <span className="pb-2 text-xs text-emerald-600">{state.slice(3)}</span>}
        {error && <span className="pb-2 text-xs text-destructive">{error}</span>}
      </form>

      {tier && (
        <form
          action={delAction}
          onSubmit={(event) => {
            // eslint-disable-next-line no-alert -- 项目约定：危险操作二次确认用 window.confirm
            if (!window.confirm('确认删除这个档位？已生成的卡密不受影响，但不能再生成。')) {
              event.preventDefault();
            }
          }}
          className="border-t pt-2"
        >
          <input type="hidden" name="tier_id" value={tier.id} />
          <button
            type="submit"
            disabled={delPending}
            className="
              text-xs text-destructive
              hover:underline
              disabled:opacity-60
            "
          >
            {delPending ? '删除中…' : '删除此档位'}
          </button>
          {delState.startsWith('error:') && (
            <span className="ml-2 text-xs text-destructive">
              {delState.slice(6)}
            </span>
          )}
        </form>
      )}
    </div>
  );
};

export const TierBoard = (props: { tiers: PanelCardTier[] }) => {
  const board = useReorderable(props.tiers, 'card_tiers');
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const rows: React.ReactNode[] = [];
  board.order.forEach((tier, index) => {
    const drag = {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => board.startDrag(tier, event),
      onPointerMove: board.dragMove,
      onPointerUp: board.endDrag,
      onPointerCancel: board.endDrag,
    };
    rows.push(
      <tr
        key={`tier-${tier.id}`}
        ref={board.rowRef(tier.id)}
        data-row-index={index}
        className={cn(
          'transition-colors',
          board.introDone && 'drag-static',
          board.draggingId === tier.id
            ? 'drag-lift'
            : board.overIndex === index ? 'drag-over' : 'hover:bg-muted/40',
        )}
      >
        <OrderCell index={index} label={tier.name} dragging={board.draggingId === tier.id} drag={drag} />
        <Td className="font-medium">{tier.name}</Td>
        <Td className="tabular-nums">{fen(tier.points_value)}</Td>
        <Td className="tabular-nums">{tier.price}</Td>
        <Td className="text-xs text-muted-foreground tabular-nums">{tier.sort_order}</Td>
        <Td>
          <span className={cn(
            'rounded-full border px-2 py-0.5 text-xs',
            tier.status === 'enabled'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
              : 'bg-muted text-muted-foreground',
          )}
          >
            {tier.status === 'enabled' ? '启用' : '停用'}
          </span>
        </Td>
        <Td>
          <button
            type="button"
            onClick={() => setEditing(editing === tier.id ? null : tier.id)}
            className={ACTION_BTN}
          >
            {editing === tier.id ? '收起' : '编辑'}
          </button>
        </Td>
      </tr>,
    );
    if (editing === tier.id) {
      rows.push(
        <tr key={`tier-edit-${tier.id}`} className="bg-muted/30">
          <Td colSpan={7} className="px-3 py-4">
            <TierForm tier={tier} onDone={() => setEditing(null)} />
          </Td>
        </tr>,
      );
    }
  });
  if (editing === 'new') {
    rows.push(
      <tr key="tier-edit-new" className="bg-muted/30">
        <Td colSpan={7} className="px-3 py-4">
          <TierForm onDone={() => setEditing(null)} />
        </Td>
      </tr>,
    );
  }

  return (
    <>
      <SortToolbar
        dirty={board.dirty}
        saving={board.saving}
        msg={board.msg}
        onSave={board.save}
        onReset={board.reset}
        burst={board.burst}
      />
      <Table head={['顺序', '名称', '面额（分）', '售价（元）', '排序值', '状态', '操作']}>
        {rows}
      </Table>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setEditing(editing === 'new' ? null : 'new')}
          className={cn(ACTION_BTN, 'h-9 px-3')}
        >
          {editing === 'new' ? '收起新增' : '+ 新增档位'}
        </button>
      </div>
    </>
  );
};

/* ---------------------------------------------------------------- 积分商品 */

const ProductForm = (props: { product?: PanelProduct; onDone?: () => void }) => {
  const [state, formAction, pending] = useActionState(saveProductAction, '');
  const [delState, delAction, delPending] = useActionState(deleteProductAction, '');
  const product = props.product;
  const ok = state.startsWith('ok:');
  const error = state.startsWith('error:') ? state.slice(6) : '';

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        {product && <input type="hidden" name="product_id" value={product.id} />}
        <label className="flex w-48 flex-col gap-1 text-xs font-medium">
          名称
          <Input
            name="name"
            defaultValue={product?.name ?? ''}
            placeholder="如：月卡会员"
            className="h-9 text-sm"
            required
          />
        </label>
        <label className="flex w-36 flex-col gap-1 text-xs font-medium">
          类型
          <Select
            name="product_type"
            defaultValue={product?.product_type ?? 'membership'}
            className="h-9 text-sm"
          >
            <option value="membership">会员</option>
            <option value="slot">卡槽</option>
          </Select>
        </label>
        <label className="flex w-28 flex-col gap-1 text-xs font-medium">
          发放数量
          <Input
            name="grant_value"
            type="number"
            min={1}
            defaultValue={product?.grant_value ?? 1}
            className="h-9 text-sm"
            required
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-xs font-medium">
          价格（分）
          <Input
            name="points_price"
            type="number"
            min={0}
            defaultValue={product?.points_price ?? 100}
            className="h-9 text-sm"
            required
          />
        </label>
        <label className="flex w-28 flex-col gap-1 text-xs font-medium">
          排序值
          <Input
            name="sort_order"
            type="number"
            defaultValue={product?.sort_order ?? 0}
            className="h-9 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            name="status"
            defaultChecked={product?.status !== 'disabled'}
            className="size-4"
          />
          上架
        </label>
        <button
          type="submit"
          disabled={pending}
          className="
            h-9 rounded-md bg-primary px-4 text-xs font-medium
            text-primary-foreground
            hover:opacity-90
            disabled:opacity-60
          "
        >
          {pending ? '保存中…' : '保存'}
        </button>
        {props.onDone && (
          <button
            type="button"
            onClick={props.onDone}
            className={cn(ACTION_BTN, `h-9`)}
          >
            收起
          </button>
        )}
        {ok && <span className="pb-2 text-xs text-emerald-600">{state.slice(3)}</span>}
        {error && <span className="pb-2 text-xs text-destructive">{error}</span>}
      </form>

      {product && (
        <form
          action={delAction}
          onSubmit={(event) => {
            // eslint-disable-next-line no-alert -- 项目约定：危险操作二次确认用 window.confirm
            if (!window.confirm('确认删除这个商品？')) {
              event.preventDefault();
            }
          }}
          className="border-t pt-2"
        >
          <input type="hidden" name="product_id" value={product.id} />
          <button
            type="submit"
            disabled={delPending}
            className="
              text-xs text-destructive
              hover:underline
              disabled:opacity-60
            "
          >
            {delPending ? '删除中…' : '删除此商品'}
          </button>
          {delState.startsWith('error:') && (
            <span className="ml-2 text-xs text-destructive">
              {delState.slice(6)}
            </span>
          )}
        </form>
      )}
    </div>
  );
};

export const ProductBoard = (props: { products: PanelProduct[] }) => {
  const board = useReorderable(props.products, 'products');
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  const rows: React.ReactNode[] = [];
  board.order.forEach((product, index) => {
    const drag = {
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => board.startDrag(product, event),
      onPointerMove: board.dragMove,
      onPointerUp: board.endDrag,
      onPointerCancel: board.endDrag,
    };
    rows.push(
      <tr
        key={`product-${product.id}`}
        ref={board.rowRef(product.id)}
        data-row-index={index}
        className={cn(
          'transition-colors',
          board.introDone && 'drag-static',
          board.draggingId === product.id
            ? 'drag-lift'
            : board.overIndex === index ? 'drag-over' : 'hover:bg-muted/40',
        )}
      >
        <OrderCell index={index} label={product.name} dragging={board.draggingId === product.id} drag={drag} />
        <Td>
          <div className="font-medium">{product.name}</div>
          <div className="text-xs text-muted-foreground">{product.code}</div>
        </Td>
        <Td className="text-xs">{product.product_type === 'membership' ? '会员' : '卡槽'}</Td>
        <Td className="text-xs tabular-nums">{product.grant_value}</Td>
        <Td className="text-xs tabular-nums">{fen(product.points_price)}</Td>
        <Td className="text-xs">{product.status === 'enabled' ? '上架' : '下架'}</Td>
        <Td>
          <button
            type="button"
            onClick={() => setEditing(editing === product.id ? null : product.id)}
            className={ACTION_BTN}
          >
            {editing === product.id ? '收起' : '编辑'}
          </button>
        </Td>
      </tr>,
    );
    if (editing === product.id) {
      rows.push(
        <tr key={`product-edit-${product.id}`} className="bg-muted/30">
          <Td colSpan={7} className="px-3 py-4">
            <ProductForm product={product} onDone={() => setEditing(null)} />
          </Td>
        </tr>,
      );
    }
  });
  if (editing === 'new') {
    rows.push(
      <tr key="product-edit-new" className="bg-muted/30">
        <Td colSpan={7} className="px-3 py-4">
          <ProductForm onDone={() => setEditing(null)} />
        </Td>
      </tr>,
    );
  }

  return (
    <>
      <SortToolbar
        dirty={board.dirty}
        saving={board.saving}
        msg={board.msg}
        onSave={board.save}
        onReset={board.reset}
        burst={board.burst}
      />
      <Table head={['顺序', '商品', '类型', '发放数量', '价格(分)', '状态', '操作']}>
        {rows}
      </Table>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setEditing(editing === 'new' ? null : 'new')}
          className={cn(ACTION_BTN, 'h-9 px-3')}
        >
          {editing === 'new' ? '收起新增' : '+ 新增商品'}
        </button>
      </div>
    </>
  );
};
