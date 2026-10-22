import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { zStyleProps } from '@/lib/doc/schema';
import { STYLE_CSS_PROPERTY } from './style-css-map';
import {
  DEFAULT_FIELDS,
  EXTRA_FIELDS,
  NEEDS_EDITOR,
  type ExtraField,
} from './extra-fields';

/**
 * Mọi field trong schema phải có MỘT đường tới nó.
 *
 * Đây là test chịu lực của cả tính năng "thêm khi cần". Thiếu một field thì không có
 * gì báo: nó chỉ đơn giản không xuất hiện ở đâu cả, và người dùng phải xuống ô CSS
 * tuỳ chỉnh — tức mất validate, mất dấu "đặt riêng ở lớp này", mất cảnh báo customCss.
 * Loại thiếu sót đó sống rất lâu vì panel vẫn trông đầy đủ.
 *
 * Nên test duyệt `zStyleProps` THẬT và đòi mỗi field thuộc đúng một trong ba tập:
 *
 *   DEFAULT_FIELDS  — bày sẵn trong panel
 *   EXTRA_FIELDS    — thêm bằng một cú bấm
 *   NEEDS_EDITOR    — cần editor riêng, còn nợ (và được khai TƯỜNG MINH là còn nợ)
 */

/** Tên field của một nhóm, đọc từ chính schema. */
function schemaFields(group: string): string[] {
  const shape = (zStyleProps as unknown as z.ZodObject<z.ZodRawShape>).shape;
  let entry = shape[group];
  expect(entry, `schema không có nhóm "${group}"`).toBeDefined();

  // `group()` bọc bằng `.optional()`, và nhóm có thể lồng thêm `.nullable()` ở bản
  // patch. Cởi hết vỏ cho tới khi gặp object thật.
  while (entry && !(entry instanceof z.ZodObject)) {
    const inner = (entry as unknown as { unwrap?: () => z.ZodTypeAny }).unwrap?.();
    if (!inner) break;
    entry = inner;
  }
  expect(entry instanceof z.ZodObject, `nhóm "${group}" không phải object`).toBe(true);
  return Object.keys((entry as z.ZodObject<z.ZodRawShape>).shape);
}

const GROUPS = [
  'layout', 'size', 'spacing', 'position', 'typography', 'fill', 'border', 'effects', 'container',
] as const;

/** Mọi ô thêm-khi-cần, phẳng — khoá theo nhóm SCHEMA, không phải nhóm panel. */
const ALL_EXTRAS: ExtraField[] = Object.values(EXTRA_FIELDS).flat();

describe('mọi field của schema đều có đường tới nó', () => {
  it.each(GROUPS)('%s', (group) => {
    const fields = schemaFields(group);
    expect(fields.length, `nhóm ${group} rỗng — schema đổi hình?`).toBeGreaterThan(0);

    const covered = new Set([
      ...(DEFAULT_FIELDS[group] ?? []),
      ...(NEEDS_EDITOR[group] ?? []),
      ...ALL_EXTRAS.filter((e) => e.group === group).map((e) => e.field),
    ]);

    const orphans = fields.filter((f) => !covered.has(f));
    expect(
      orphans,
      `nhóm ${group}: field không có đường nào tới — thêm vào EXTRA_FIELDS, ` +
        'hoặc khai vào NEEDS_EDITOR nếu nó cần editor riêng',
    ).toEqual([]);
  });

  it('không khai một field ở hai tập', () => {
    for (const group of GROUPS) {
      const def = new Set(DEFAULT_FIELDS[group] ?? []);
      const editor = new Set(NEEDS_EDITOR[group] ?? []);
      const extra = ALL_EXTRAS.filter((e) => e.group === group).map((e) => e.field);

      for (const f of extra) {
        expect(def.has(f), `${group}.${f} vừa bày sẵn vừa nằm trong danh sách thêm`).toBe(false);
        expect(editor.has(f), `${group}.${f} vừa thêm được vừa "cần editor riêng"`).toBe(false);
      }
      for (const f of editor) {
        expect(def.has(f), `${group}.${f} vừa bày sẵn vừa "cần editor riêng"`).toBe(false);
      }
    }
  });

  it('DEFAULT_FIELDS không kê field không tồn tại', () => {
    // Bày sẵn một field đã bị xoá khỏi schema thì panel render một ô ghi vào hư không:
    // `setStyle` bị validator từ chối, và người dùng chỉ thấy một ô đỏ không rõ vì sao.
    for (const group of GROUPS) {
      const fields = new Set(schemaFields(group));
      for (const f of DEFAULT_FIELDS[group] ?? []) {
        expect(fields.has(f), `${group}.${f} không có trong schema`).toBe(true);
      }
    }
  });
});

describe('metadata của ô thêm-khi-cần', () => {
  it('field thật sự tồn tại trong schema', () => {
    for (const e of ALL_EXTRAS) {
      expect(schemaFields(e.group), `${e.group}.${e.field} không có trong schema`).toContain(
        e.field,
      );
    }
  });

  it('mỗi ô có ánh xạ property CSS, hoặc nhãn ghi tay', () => {
    /*
     * Không có mục trong `STYLE_CSS_PROPERTY` thì `cssLabel()` rơi về TÊN FIELD —
     * nhãn thành `objectFit` thay vì `object-fit`, tức đúng thứ mà cả đợt này đi sửa.
     * Nhãn ghi tay là đường thoát hợp lệ, nhưng phải là lựa chọn có ý thức.
     */
    for (const e of ALL_EXTRAS) {
      const mapped = STYLE_CSS_PROPERTY[`${e.group}.${e.field}`];
      expect(
        mapped || e.label,
        `${e.group}.${e.field}: thêm vào STYLE_CSS_PROPERTY, hoặc đặt \`label\``,
      ).toBeTruthy();
    }
  });

  it('select nào cũng có lựa chọn, và lựa chọn là giá trị CSS thật', () => {
    for (const e of ALL_EXTRAS.filter((x) => x.control === 'select')) {
      expect(e.options?.length, `${e.group}.${e.field}: select mà không có options`)
        .toBeGreaterThan(1);
      for (const o of e.options ?? []) {
        // Giá trị CSS, không phải nhãn tiếng Việt: nhãn hiện đúng bằng giá trị.
        expect(o, `${e.group}.${e.field}: "${o}" trông không giống giá trị CSS`).toMatch(
          /^[a-z][a-z0-9- ]*$/,
        );
      }
    }
  });

  it('number nào cũng có bước, để mũi tên lên/xuống có nghĩa', () => {
    for (const e of ALL_EXTRAS.filter((x) => x.control === 'number')) {
      expect(e.step, `${e.group}.${e.field}: number mà không có step`).toBeGreaterThan(0);
    }
  });
});
