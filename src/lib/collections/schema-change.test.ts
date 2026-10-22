import { describe, expect, it } from 'vitest';

import type { FieldDef } from './field-def';
import { checkSchemaChange, diffSchema } from './schema-change';

const A: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'text', key: 'excerpt', label: 'Mô tả' },
];

describe('diffSchema', () => {
  it('thấy field mới', () => {
    const b: FieldDef[] = [...A, { t: 'number', key: 'views', label: 'Lượt xem' }];
    expect(diffSchema(A, b)).toEqual([{ kind: 'add', field: { t: 'number', key: 'views', label: 'Lượt xem' } }]);
  });

  it('thấy field bị bỏ', () => {
    expect(diffSchema(A, [A[0]!])).toEqual([{ kind: 'remove', key: 'excerpt' }]);
  });

  it('thấy đổi kiểu', () => {
    const b: FieldDef[] = [{ t: 'richtext', key: 'title', label: 'Tiêu đề' }, A[1]!];
    expect(diffSchema(A, b)).toEqual([{ kind: 'retype', key: 'title', from: 'text', to: 'richtext' }]);
  });

  it('đổi nhãn không phải đổi kiểu', () => {
    const b: FieldDef[] = [{ t: 'text', key: 'title', label: 'Tên bài' }, A[1]!];
    expect(diffSchema(A, b)).toEqual([{ kind: 'reconfig', key: 'title' }]);
  });

  it('đổi thứ tự là một thay đổi riêng, không phải xoá rồi thêm', () => {
    expect(diffSchema(A, [A[1]!, A[0]!])).toEqual([{ kind: 'reorder' }]);
  });
});

describe('checkSchemaChange', () => {
  it('loại chưa có entry thì mọi thay đổi đều được', () => {
    const r = checkSchemaChange([{ kind: 'retype', key: 'a', from: 'richtext', to: 'number' }], 0);
    expect(r.ok).toBe(true);
  });

  it('thêm field luôn được, kể cả khi đã có 500 entry', () => {
    const r = checkSchemaChange([{ kind: 'add', field: { t: 'text', key: 'x', label: 'X' } }], 500);
    expect(r.ok).toBe(true);
  });

  it('đổi kiểu KHÔNG mất dữ liệu thì được: text → richtext', () => {
    const r = checkSchemaChange([{ kind: 'retype', key: 'a', from: 'text', to: 'richtext' }], 500);
    expect(r.ok).toBe(true);
  });

  it('đổi kiểu MẤT dữ liệu thì bị chặn: richtext → number', () => {
    const r = checkSchemaChange([{ kind: 'retype', key: 'a', from: 'richtext', to: 'number' }], 500);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('a');
  });

  it('bỏ field thì được, nhưng phải cảnh báo là dữ liệu còn nằm đó', () => {
    // Không cảnh báo thì người dùng tưởng đã xoá xong, trong khi JSONB vẫn giữ —
    // và nó sẽ quay lại nếu có ai thêm lại field cùng key.
    const r = checkSchemaChange([{ kind: 'remove', key: 'excerpt' }], 500);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.warnings.join(' ')).toContain('excerpt');
  });

  it('gộp nhiều thay đổi: một cái bị chặn là chặn cả lần lưu', () => {
    const r = checkSchemaChange(
      [
        { kind: 'add', field: { t: 'text', key: 'x', label: 'X' } },
        { kind: 'retype', key: 'a', from: 'image', to: 'text' },
      ],
      10,
    );
    expect(r.ok).toBe(false);
  });
});

describe('richtext ↔ richdoc là đổi kiểu KHÔNG an toàn', () => {
  const rt: FieldDef[] = [{ t: 'richtext', key: 'body', label: 'Nội dung' }];
  const rd: FieldDef[] = [{ t: 'richdoc', key: 'body', label: 'Nội dung' }];

  it('chặn richtext → richdoc khi đã có entry', () => {
    // Hai kiểu nghe như một kiểu đậm hơn của nhau, nên đây là dòng người sau sẽ
    // muốn thêm vào `SAFE_RETYPE`. Nhưng `richtext` lưu `InlineNode[]` và `richdoc`
    // lưu `Block[]`: đọc giá trị cũ bằng kiểu mới thì trượt ở MỌI phần tử, và không
    // ai thấy gì cho tới lần mở bài đầu tiên.
    const r = checkSchemaChange(diffSchema(rt, rd), 12);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('richdoc');
  });

  it('chặn cả chiều ngược lại', () => {
    expect(checkSchemaChange(diffSchema(rd, rt), 12).ok).toBe(false);
  });

  it('chưa có entry nào thì cho đổi — không có dữ liệu để mất', () => {
    expect(checkSchemaChange(diffSchema(rt, rd), 0).ok).toBe(true);
  });
});

describe('field seo', () => {
  const BASE: FieldDef[] = [{ t: 'text', key: 'title', label: 'Tiêu đề' }];
  const SEO: FieldDef = { t: 'seo', key: 'seo', label: 'SEO' };

  it('thêm field seo khi đã có bài là an toàn, không cảnh báo', () => {
    expect(checkSchemaChange(diffSchema(BASE, [...BASE, SEO]), 40)).toEqual({ ok: true, warnings: [] });
  });

  it('xoá field seo chỉ ẨN, như mọi field khác', () => {
    const r = checkSchemaChange(diffSchema([...BASE, SEO], BASE), 40);
    expect(r.ok && r.warnings[0]).toContain('chỉ bị ẨN');
  });

  it('đổi kiểu sang/từ seo khi đã có bài bị chặn', () => {
    const asText: FieldDef = { t: 'text', key: 'seo', label: 'SEO' };
    expect(checkSchemaChange(diffSchema([...BASE, asText], [...BASE, SEO]), 40).ok).toBe(false);
    expect(checkSchemaChange(diffSchema([...BASE, SEO], [...BASE, asText]), 40).ok).toBe(false);
  });
});
