'use server';

import { revalidatePath } from 'next/cache';
import { panelSend } from '@/libs/PanelApi';

/** 卡密域：卡密生成/作废/删除、卡密档位与积分商品的增删改、拖拽排序保存。 */
type _prev = string;

export async function generateCardsAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const tierId = Number(formData.get('tier_id'));
  const count = Number(formData.get('count')) || 10;
  const result = await panelSend<{ codes: string[]; count: number }>('POST', '/admin/cards/generate', {
    tier_id: tierId,
    count,
  });
  revalidatePath('/dashboard/cards');
  return result.ok ? `generated:${result.data?.count ?? 0}` : `error:${result.msg}`;
}

export async function voidCardsAction(_state: _prev, formData: FormData): Promise<string> {
  const ids = formData.getAll('ids').map(value => Number(value)).filter(Boolean);
  if (!ids.length) {
    return 'error:请先勾选卡密';
  }
  const result = await panelSend('POST', '/admin/cards/void', { ids });
  revalidatePath('/dashboard/cards');
  return result.ok ? `ok:已作废 ${ids.length} 张卡密` : `error:${result.msg || '作废失败'}`;
}

export async function deleteCardsAction(_state: _prev, formData: FormData): Promise<string> {
  const ids = formData.getAll('ids').map(value => Number(value)).filter(Boolean);
  if (!ids.length) {
    return 'error:请先勾选卡密';
  }
  const result = await panelSend('POST', '/admin/cards/delete', { ids });
  revalidatePath('/dashboard/cards');
  return result.ok ? `ok:已删除 ${ids.length} 张卡密` : `error:${result.msg || '删除失败'}`;
}

export async function saveCardTierAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('tier_id') ?? 0) || undefined;
  const payload = {
    name: String(formData.get('name') ?? '').trim(),
    points_value: Number(formData.get('points_value') ?? 0),
    price: Number(formData.get('price') ?? 0),
    sort_order: Number(formData.get('sort_order') ?? 0),
    status: formData.get('status') ? 'enabled' : 'disabled',
  };
  if (!payload.name) {
    return 'error:请填写档位名称';
  }
  const result = id
    ? await panelSend<Record<string, unknown>>('PUT', `/admin/card-tiers/${id}`, payload)
    : await panelSend<{ id: number }>('POST', '/admin/card-tiers', payload);
  revalidatePath('/dashboard/cards');
  return result.ok ? `ok:${id ? '已保存' : '已新增档位'}` : `error:${result.msg || '保存失败'}`;
}

export async function deleteCardTierAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('tier_id'));
  const result = await panelSend('DELETE', `/admin/card-tiers/${id}`);
  revalidatePath('/dashboard/cards');
  return result.ok ? 'ok:已删除' : `error:${result.msg || '删除失败'}`;
}

export async function saveProductAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('product_id') ?? 0) || undefined;
  const payload = {
    name: String(formData.get('name') ?? '').trim(),
    product_type: String(formData.get('product_type') ?? 'membership'),
    grant_value: Number(formData.get('grant_value') ?? 1),
    points_price: Number(formData.get('points_price') ?? 0),
    sort_order: Number(formData.get('sort_order') ?? 0),
    status: formData.get('status') ? 'enabled' : 'disabled',
  };
  if (!payload.name) {
    return 'error:请填写商品名称';
  }
  const result = id
    ? await panelSend<Record<string, unknown>>('PUT', `/admin/products/${id}`, payload)
    : await panelSend<{ id: number }>('POST', '/admin/products', payload);
  revalidatePath('/dashboard/cards');
  return result.ok ? `ok:${id ? '已保存' : '已新增商品'}` : `error:${result.msg || '保存失败'}`;
}

export async function deleteProductAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('product_id'));
  const result = await panelSend('DELETE', `/admin/products/${id}`);
  revalidatePath('/dashboard/cards');
  return result.ok ? 'ok:已删除' : `error:${result.msg || '删除失败'}`;
}

/** 批量保存排序：把拖拽/上下移动后的 id 顺序一次性写回 sort_order */
export async function reorderCatalogAction(
  table: 'card_tiers' | 'products',
  ids: number[],
): Promise<string> {
  if (!ids.length) {
    return 'error:没有可排序的记录';
  }
  const result = await panelSend<{ updated: number }>('POST', '/admin/reorder', { table, ids });
  revalidatePath('/dashboard/cards');
  return result.ok
    ? `ok:排序已保存（${result.data?.updated ?? ids.length} 条）`
    : `error:${result.msg || '保存排序失败'}`;
}
