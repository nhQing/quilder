/**
 * Đổi id NGUỒN sang id ĐÍCH trong doc, cây component và bản dịch.
 *
 * Đổi THEO KHOÁ chứa id (`assetId`, `posterAssetId`, `componentId`, mảng khung của
 * `image-sequence`, `repeat.blockComponents`) — không thay mù mọi chuỗi trùng id, vì một
 * alt text tình cờ trùng id không được bị sửa.
 *
 * `leftoverIds` thì quét MÙ, cố ý: nó là lưới cuối sau phép đổi theo khoá. Còn sót một id
 * nguồn nào là huỷ cả lần nhập — một trang vỡ ảnh im lặng là thứ spec cấm.
 */

import { EFFECT_ASSET_PARAMS } from '@/lib/render/instance';

export interface IdMaps {
  assets: ReadonlyMap<string, string>;
  components: ReadonlyMap<string, string>;
}

const ASSET_KEYS = new Set(['assetId', 'posterAssetId']);
const FRAME_KEYS = new Set(Object.values(EFFECT_ASSET_PARAMS).flat());

function mapString(key: string | null, v: string, maps: IdMaps): string {
  if (key !== null && ASSET_KEYS.has(key)) return maps.assets.get(v) ?? v;
  if (key === 'componentId') return maps.components.get(v) ?? v;
  return v;
}

function go(value: unknown, key: string | null, maps: IdMaps): unknown {
  if (typeof value === 'string') return mapString(key, value, maps);
  if (Array.isArray(value)) {
    if (key !== null && FRAME_KEYS.has(key)) {
      return value.map((v) => (typeof v === 'string' ? (maps.assets.get(v) ?? v) : v));
    }
    return value.map((v) => go(v, null, maps));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'blockComponents' && v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = Object.fromEntries(
          Object.entries(v).map(([bk, bv]) => [bk, typeof bv === 'string' ? (maps.components.get(bv) ?? bv) : bv]),
        );
      } else {
        out[k] = go(v, k, maps);
      }
    }
    return out;
  }
  return value;
}

export function remapValue<T>(value: T, maps: IdMaps): T {
  return go(value, null, maps) as T;
}

export function remapTranslationValue(field: string, value: unknown, maps: IdMaps): unknown {
  return ASSET_KEYS.has(field) && typeof value === 'string' ? (maps.assets.get(value) ?? value) : value;
}

export function leftoverIds(value: unknown, maps: IdMaps): string[] {
  const stale = new Set<string>();
  for (const [from, to] of maps.assets) if (from !== to) stale.add(from);
  for (const [from, to] of maps.components) if (from !== to) stale.add(from);

  const hits: string[] = [];
  const visit = (v: unknown, path: string[]) => {
    if (typeof v === 'string') {
      if (stale.has(v)) hits.push(path.join('.'));
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, [...path, String(i)]));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, [...path, k]);
    }
  };
  visit(value, []);
  return hits;
}
