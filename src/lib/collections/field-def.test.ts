import { describe, expect, it } from 'vitest';

import {
  FIELD_TYPES, MAX_FIELD_DEPTH, schemaDepth, validateCollectionSchema, zFieldDef,
  type FieldDef, type GroupTable,
} from './field-def';

describe('FIELD_TYPES', () => {
  it('đúng 18 kiểu, và danh sách là ĐÓNG', () => {
    // 16 từ khi `richdoc` được thêm cho ô soạn kiểu Word; 17 từ khi `html` được thêm
    // cho ô soạn CKEditor; 18 từ khi `seo` được thêm (21/10/2026). Con số ở đây là thứ
    // buộc người thêm một kiểu mới phải sửa test — tức phải đọc lý do danh sách này đóng.
    expect(FIELD_TYPES).toHaveLength(18);
  });

  it('từ chối kiểu không có trong danh sách', () => {
    const r = zFieldDef.safeParse({ t: 'markdown', key: 'a', label: 'A' });
    expect(r.success).toBe(false);
  });
});

describe('zFieldDef', () => {
  it('nhận field text đủ tối thiểu', () => {
    const r = zFieldDef.safeParse({ t: 'text', key: 'title', label: 'Tiêu đề' });
    expect(r.success).toBe(true);
  });

  it('từ chối key có ký tự ngoài a-z0-9_ — key đi vào URL API và vào binding', () => {
    const r = zFieldDef.safeParse({ t: 'text', key: 'tiêu đề', label: 'A' });
    expect(r.success).toBe(false);
  });

  it('từ chối khoá lạ, để một field gõ sai không lặng lẽ mất cấu hình', () => {
    const r = zFieldDef.safeParse({ t: 'text', key: 'a', label: 'A', maxLenght: 10 });
    expect(r.success).toBe(false);
  });

  it('enum phải có ít nhất một lựa chọn — enum rỗng là một ô không chọn được gì', () => {
    expect(zFieldDef.safeParse({ t: 'enum', key: 'k', label: 'K', options: [] }).success).toBe(false);
    expect(
      zFieldDef.safeParse({
        t: 'enum', key: 'k', label: 'K', options: [{ value: 'a', label: 'A' }],
      }).success,
    ).toBe(true);
  });

  it('blocks phải khai danh sách khối cho phép', () => {
    expect(zFieldDef.safeParse({ t: 'blocks', key: 'z', label: 'Z' }).success).toBe(false);
    expect(
      zFieldDef.safeParse({ t: 'blocks', key: 'z', label: 'Z', allowed: ['cta'] }).success,
    ).toBe(true);
  });
});

describe('schemaDepth', () => {
  const groups: GroupTable = {
    cta: [{ t: 'text', key: 'heading', label: 'Tiêu đề' }],
    outer: [{ t: 'group', key: 'inner', label: 'Trong', groupKey: 'cta' }],
    loop: [{ t: 'group', key: 'again', label: 'Lại', groupKey: 'loop' }],
  };

  it('schema phẳng có độ sâu 1', () => {
    expect(schemaDepth([{ t: 'text', key: 'a', label: 'A' }], groups)).toBe(1);
  });

  it('một cấp group là độ sâu 2', () => {
    const f: FieldDef[] = [{ t: 'group', key: 'c', label: 'C', groupKey: 'cta' }];
    expect(schemaDepth(f, groups)).toBe(2);
  });

  it('hai cấp group là độ sâu 3', () => {
    const f: FieldDef[] = [{ t: 'group', key: 'o', label: 'O', groupKey: 'outer' }];
    expect(schemaDepth(f, groups)).toBe(3);
  });

  it('blocks tính độ sâu bằng khối sâu nhất nó cho phép', () => {
    const f: FieldDef[] = [{ t: 'blocks', key: 'z', label: 'Z', allowed: ['outer'] }];
    expect(schemaDepth(f, groups)).toBe(3);
  });

  it('nhóm tự tham chiếu KHÔNG treo, và bị báo quá sâu', () => {
    // Đây là ca duy nhất có thể làm form admin đệ quy vô hạn và treo trình duyệt.
    // Nó phải dừng ở tầng đo, không phải ở tầng render form.
    const f: FieldDef[] = [{ t: 'group', key: 'l', label: 'L', groupKey: 'loop' }];
    expect(schemaDepth(f, groups)).toBeGreaterThan(MAX_FIELD_DEPTH);
  });

  it('vòng giữa HAI nhóm cũng bị bắt, không chỉ nhóm tự tham chiếu', () => {
    // Đây là ca lọt qua `upsertFieldGroup` trước khi sửa: lúc validate B thì A chưa
    // có trong bảng, nên B→A trông như trỏ tới một nhóm mồ côi.
    const cyc: GroupTable = {
      a: [{ t: 'group', key: 'g', label: 'G', groupKey: 'b' }],
      b: [{ t: 'group', key: 'g', label: 'G', groupKey: 'a' }],
    };
    expect(schemaDepth([{ t: 'group', key: 'x', label: 'X', groupKey: 'a' }], cyc)).toBeGreaterThan(MAX_FIELD_DEPTH);
  });

  it('nhóm không tồn tại tính như một lá, không ném lỗi', () => {
    // Nhóm bị xoá trong khi một loại còn trỏ tới nó là chuyện xảy ra được; làm
    // trắng màn cấu trúc vì một tham chiếu mồ côi thì tệ hơn hẳn.
    const f: FieldDef[] = [{ t: 'group', key: 'x', label: 'X', groupKey: 'khong-co' }];
    expect(schemaDepth(f, groups)).toBe(2);
  });
});

describe('validateCollectionSchema', () => {
  const groups: GroupTable = { cta: [{ t: 'text', key: 'heading', label: 'Tiêu đề' }] };

  it('nhận schema hợp lệ', () => {
    const r = validateCollectionSchema(
      [{ t: 'text', key: 'title', label: 'Tiêu đề', required: true }],
      groups,
    );
    expect(r.ok).toBe(true);
  });

  it('từ chối hai field trùng key — key là địa chỉ của dữ liệu', () => {
    const r = validateCollectionSchema(
      [{ t: 'text', key: 'a', label: 'A' }, { t: 'number', key: 'a', label: 'A2' }],
      groups,
    );
    expect(r).toEqual({ ok: false, error: 'Trùng khoá field: a' });
  });

  it('từ chối slug.from trỏ tới field không tồn tại', () => {
    const r = validateCollectionSchema(
      [{ t: 'slug', key: 'slug', label: 'Đường dẫn', from: 'khong-co' }],
      groups,
    );
    expect(r.ok).toBe(false);
  });

  it('từ chối schema sâu quá 3', () => {
    const deep: GroupTable = {
      l1: [{ t: 'group', key: 'g', label: 'G', groupKey: 'l2' }],
      l2: [{ t: 'group', key: 'g', label: 'G', groupKey: 'l3' }],
      l3: [{ t: 'text', key: 'x', label: 'X' }],
    };
    const r = validateCollectionSchema(
      [{ t: 'group', key: 'g', label: 'G', groupKey: 'l1' }],
      deep,
    );
    expect(r.ok).toBe(false);
  });

  it('lỗi zod trả về tiếng Việt, không phải câu mặc định của zod', () => {
    // `parsed.error.issues[0].message` đi thẳng ra form admin, nên một câu tiếng
    // Anh ở đây là một câu tiếng Anh trên giao diện.
    const r = validateCollectionSchema([{ t: 'text', key: 'title', label: 'x'.repeat(81) }], groups);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('Dài quá 80 ký tự');
    expect(r.ok === false && r.error).not.toContain('String must contain');
  });

  it('lỗi có kèm đường dẫn tới field, để người sửa biết mở ô nào', () => {
    const r = validateCollectionSchema([{ t: 'text', key: 'title', label: 'x'.repeat(81) }], groups);
    expect(r.ok === false && r.error).toContain('0.label');
  });

  it('thông báo do CHÍNH TA viết được giữ nguyên, không bị dịch lại', () => {
    // `zKey` đã có câu tiếng Việt riêng; ghi đè nó bằng một câu chung là mất đi
    // thông tin cụ thể nhất mà người sửa cần.
    const r = validateCollectionSchema([{ t: 'text', key: 'Tiêu Đề', label: 'A' }], groups);
    expect(r.ok === false && r.error).toContain('Khoá field chỉ gồm');
  });

  it('khoá gõ sai bị `.strict()` bắt, và thông báo NÓI RA tên khoá đó', () => {
    const r = validateCollectionSchema([{ t: 'text', key: 'a', label: 'A', maxLenght: 10 }], groups);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('maxLenght');
  });

  it('nhóm field KHÔNG được chứa field danh mục', () => {
    // `EntryTaxonomy` liên kết entry với danh mục, không liên kết từng mục bên trong
    // một nhóm — nên một field taxonomy trong nhóm hứa một thứ tầng lưu trữ không
    // biểu diễn được.
    const r = validateCollectionSchema(
      [{ t: 'taxonomy', key: 'cats', label: 'Danh mục' }],
      groups,
      'group',
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('cats');
  });

  it('một loại nội dung chỉ được có MỘT field danh mục', () => {
    // `taxonomyIds` là một danh sách phẳng không mang khoá field, nên hai ô chọn
    // danh mục sẽ ghi vào cùng một chỗ và một danh mục làm cả hai ô "đã điền".
    const r = validateCollectionSchema(
      [
        { t: 'taxonomy', key: 'cats', label: 'Danh mục' },
        { t: 'taxonomy', key: 'regions', label: 'Vùng' },
      ],
      groups,
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('regions');
  });

  it('một field danh mục ở tầng ngoài thì vẫn nhận', () => {
    const r = validateCollectionSchema(
      [{ t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true }],
      groups,
    );
    expect(r.ok).toBe(true);
  });
});

describe('field richdoc', () => {
  it('nhận field richdoc với hai trần', () => {
    const r = zFieldDef.safeParse({ t: 'richdoc', key: 'body', label: 'Nội dung', maxBlocks: 300, maxChars: 20000 });
    expect(r.success).toBe(true);
  });

  it('richdoc KHÔNG nhận maxLength — nó có maxChars và maxBlocks', () => {
    // `.strict()` bắt được đúng ca này: một `maxLength` chép từ nhánh `richtext`
    // sang sẽ bị bỏ im lặng, và người đặt nó tưởng đã có trần.
    const r = zFieldDef.safeParse({ t: 'richdoc', key: 'body', label: 'Nội dung', maxLength: 100 });
    expect(r.success).toBe(false);
  });

  it('richtext KHÔNG nhận maxChars — hai kiểu, hai bộ tham số', () => {
    const r = zFieldDef.safeParse({ t: 'richtext', key: 'body', label: 'Nội dung', maxChars: 100 });
    expect(r.success).toBe(false);
  });
});

describe('field seo', () => {
  const SEO: FieldDef = { t: 'seo', key: 'seo', label: 'SEO' };

  it('nhận khai báo tối thiểu, từ chối `required` — ô SEO luôn tuỳ chọn', () => {
    expect(zFieldDef.safeParse(SEO).success).toBe(true);
    expect(zFieldDef.safeParse({ ...SEO, required: true }).success).toBe(false);
  });

  it('một loại chỉ có MỘT field SEO', () => {
    const r = validateCollectionSchema([SEO, { t: 'seo', key: 'seo2', label: 'SEO 2' }], {});
    expect(r).toEqual({ ok: false, error: 'Một loại nội dung chỉ có một field SEO (đang có: seo, seo2)' });
  });

  it('nhóm field không được chứa field SEO — renderer chỉ đọc ở tầng ngoài', () => {
    expect(validateCollectionSchema([SEO], {}, 'group')).toEqual({
      ok: false,
      error: 'Nhóm field không được chứa field SEO: seo',
    });
  });

  it('một field SEO ở tầng ngoài thì nhận', () => {
    expect(validateCollectionSchema([{ t: 'text', key: 'title', label: 'Tiêu đề' }, SEO], {}).ok).toBe(true);
  });
});
