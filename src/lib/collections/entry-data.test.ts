import { describe, expect, it } from 'vitest';

import type { FieldDef, GroupTable } from './field-def';
import { validateEntryData, zEntryData, zEntryDataPartial, type EntryDataCtx } from './entry-data';

/**
 * Ngữ cảnh mặc định của bộ test: KHÔNG host nào được phép nhúng.
 *
 * Đó là mặc định đúng cho phần lớn test — nó kiểm rằng `<iframe>` bị gỡ khi chưa
 * khai host. Test nào cần chiều ngược lại thì truyền ctx riêng, ngay tại chỗ, để
 * người đọc thấy host được khai mà không phải cuộn lên đây.
 */
const CTX: EntryDataCtx = { iframeHosts: [], siteHost: 'vd.test' };

const GROUPS: GroupTable = {
  cta: [
    { t: 'text', key: 'heading', label: 'Tiêu đề', required: true },
    { t: 'link', key: 'action', label: 'Đường dẫn' },
  ],
  quote: [{ t: 'text', key: 'text', label: 'Câu trích', required: true }],
};

const NEWS: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề', required: true, maxLength: 120 },
  { t: 'text', key: 'excerpt', label: 'Mô tả', maxLength: 200 },
  { t: 'richtext', key: 'body', label: 'Nội dung', required: true },
  { t: 'image', key: 'cover', label: 'Ảnh bìa', required: true },
  { t: 'number', key: 'views', label: 'Lượt xem' },
  { t: 'boolean', key: 'pinned', label: 'Ghim' },
  { t: 'date', key: 'eventAt', label: 'Diễn ra' },
  { t: 'enum', key: 'tone', label: 'Sắc thái', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
  { t: 'relation', key: 'related', label: 'Liên quan', typeKey: 'news', cardinality: 'many' },
  { t: 'group', key: 'ctas', label: 'CTA', groupKey: 'cta', repeatable: true, max: 2 },
  { t: 'blocks', key: 'zone', label: 'Khối', allowed: ['quote', 'cta'] },
];

const FULL = {
  title: 'Lãi suất tháng 8',
  body: [{ t: 'text', v: 'Nội dung' }],
  cover: { assetId: 'a1', alt: 'Ảnh' },
};

describe('zEntryData', () => {
  it('nhận entry đủ field bắt buộc', () => {
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse(FULL).success).toBe(true);
  });

  it('từ chối khi thiếu field bắt buộc', () => {
    const r = zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, title: undefined });
    expect(r.success).toBe(false);
  });

  it('nhận field không bắt buộc khi vắng mặt', () => {
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse(FULL).success).toBe(true);
  });

  it('chặn chữ dài quá maxLength', () => {
    const r = zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, title: 'x'.repeat(121) });
    expect(r.success).toBe(false);
  });

  it('richtext phải là cây RichText, không phải chuỗi HTML', () => {
    // Nhận chuỗi ở đây là mở một đường thứ hai cho HTML thô đi vào trang, ngoài
    // CustomCode — thứ đang bị sandbox ba tầng.
    const r = zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, body: '<p>xin chào</p>' });
    expect(r.success).toBe(false);
  });

  it('richtext chặn href javascript: — dùng chung zRichText với doc', () => {
    const r = zEntryData(NEWS, GROUPS, CTX).safeParse({
      ...FULL,
      body: [{ t: 'link', href: 'javascript:alert(1)', children: [{ t: 'text', v: 'x' }] }],
    });
    expect(r.success).toBe(false);
  });

  it('enum chỉ nhận giá trị trong danh sách', () => {
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, tone: 'c' }).success).toBe(false);
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, tone: 'a' }).success).toBe(true);
  });

  // Loại có khai báo `taxonomy` — NEWS không có, nên hai test dưới phải dùng bản này:
  // với NEWS thì `.strip()` bỏ `cats` chỉ vì không field nào tên `cats`, và test sẽ
  // xanh kể cả khi field `taxonomy` được đưa trở lại vào shape.
  const NEWS_TAX: FieldDef[] = [
    ...NEWS,
    { t: 'taxonomy', key: 'cats', label: 'Danh mục', required: true, multiple: true },
  ];

  it('field taxonomy KHÔNG nằm trong data — giá trị sống ở bảng nối', () => {
    // Hai bản của một sự thật, mà bản trong `data` không ai đọc: đường truy vấn lọc
    // qua `taxonomies.some`. Để nó lại còn làm API công khai phát mảng cuid nội bộ.
    const r = zEntryData(NEWS_TAX, GROUPS, CTX).safeParse({ ...FULL, cats: ['t1'] });
    expect(r.success).toBe(true);
    expect(r.success && 'cats' in r.data).toBe(false);
  });

  it('field taxonomy bắt buộc KHÔNG làm data bị từ chối — cưỡng chế ở entry-write', () => {
    // `required: true` ở trên mà `data` không có `cats`: vẫn nhận, vì phép kiểm bắt
    // buộc sống ở `checkRequiredTaxonomy` trên `taxonomyIds`.
    expect(zEntryData(NEWS_TAX, GROUPS, CTX).safeParse(FULL).success).toBe(true);
  });

  it('entry CŨ còn cats trong JSONB thì được dọn khi parse, không bị từ chối', () => {
    const r = zEntryData(NEWS_TAX, GROUPS, CTX).safeParse({ ...FULL, cats: ['con-sot'] });
    expect(r.success).toBe(true);
    expect(r.success && 'cats' in r.data).toBe(false);
  });

  it('nhóm lặp là mảng, và tôn trọng max', () => {
    const one = { ...FULL, ctas: [{ heading: 'A' }] };
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse(one).success).toBe(true);
    const three = { ...FULL, ctas: [{ heading: 'A' }, { heading: 'B' }, { heading: 'C' }] };
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse(three).success).toBe(false);
  });

  it('nhóm lặp áp field bắt buộc BÊN TRONG từng mục', () => {
    const r = zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, ctas: [{ action: { href: '/a', label: 'A' } }] });
    expect(r.success).toBe(false);
  });

  it('blocks mang __type, và chỉ nhận loại được cho phép', () => {
    const ok = { ...FULL, zone: [{ __type: 'quote', text: 'Câu' }] };
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse(ok).success).toBe(true);
    const bad = { ...FULL, zone: [{ __type: 'table', rows: [] }] };
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse(bad).success).toBe(false);
  });

  it('__type SỐNG SÓT qua parse — nó là thứ duy nhất cho renderer biết khối đó là gì', () => {
    const r = zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, zone: [{ __type: 'quote', text: 'Câu' }] });
    expect(r.success).toBe(true);
    expect(r.success && (r.data.zone as Record<string, unknown>[])[0]!.__type).toBe('quote');
  });

  it('relation many là mảng id, relation one là một id', () => {
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, related: ['x', 'y'] }).success).toBe(true);
    expect(zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, related: 'x' }).success).toBe(false);
  });

  it('image bắt buộc có alt khi field khai requireAlt', () => {
    const fields: FieldDef[] = [
      { t: 'image', key: 'cover', label: 'Ảnh', required: true, requireAlt: true },
    ];
    expect(zEntryData(fields, GROUPS, CTX).safeParse({ cover: { assetId: 'a1' } }).success).toBe(false);
    expect(zEntryData(fields, GROUPS, CTX).safeParse({ cover: { assetId: 'a1', alt: 'x' } }).success).toBe(true);
  });

  it('bỏ khoá lạ chứ không từ chối cả entry', () => {
    // Field vừa bị XOÁ khỏi schema vẫn còn giá trị trong JSONB của entry cũ (spec
    // §10: xoá field không xoá dữ liệu). Từ chối cả entry ở đây nghĩa là mọi bài
    // cũ không mở được nữa sau một lần sửa cấu trúc.
    const r = zEntryData(NEWS, GROUPS, CTX).safeParse({ ...FULL, fieldDaXoa: 'còn sót' });
    expect(r.success).toBe(true);
    expect(r.success && 'fieldDaXoa' in r.data).toBe(false);
  });
});

describe('zEntryData với bảng nhóm hỏng', () => {
  it('bảng nhóm CÓ VÒNG không làm dựng validator đệ quy không dừng', () => {
    // `validateCollectionSchema` từ chối schema sâu quá 3, nhưng một hàng đã có trong
    // DB có thể lưu trước khi luật đó tồn tại. Chặn cứng ở tầng dựng là thứ duy nhất
    // còn lại lúc đó.
    const cyc: GroupTable = {
      a: [{ t: 'group', key: 'g', label: 'G', groupKey: 'b' }],
      b: [{ t: 'group', key: 'g', label: 'G', groupKey: 'a' }],
    };
    const fields: FieldDef[] = [{ t: 'group', key: 'top', label: 'Top', groupKey: 'a' }];
    // Không được throw, không được treo.
    expect(() => zEntryData(fields, cyc, CTX)).not.toThrow();
    expect(zEntryData(fields, cyc, CTX).safeParse({ top: { g: { g: { g: {} } } } }).success).toBe(true);
  });
});

describe('zEntryDataPartial', () => {
  it('field required KHÔNG bắt buộc — dịch tiêu đề mà chưa dịch thân bài là bình thường', () => {
    const r = zEntryDataPartial(NEWS, GROUPS, CTX).safeParse({ title: 'August rates' });
    expect(r.success).toBe(true);
  });

  it('nhưng field CÓ mặt thì phải đúng shape — chuỗi HTML thô vào richtext bị từ chối', () => {
    // Không có luật này thì `applyEntryLocale` đặt chuỗi HTML vào đúng chỗ mà
    // `zRichText` tồn tại để chặn, và hai test của zEntryData bị vô hiệu hoá bởi
    // một đường ghi ở file khác.
    const r = zEntryDataPartial(NEWS, GROUPS, CTX).safeParse({ body: '<p>xin chào</p>' });
    expect(r.success).toBe(false);
  });

  it('href javascript: trong bản dịch cũng bị chặn', () => {
    const r = zEntryDataPartial(NEWS, GROUPS, CTX).safeParse({
      body: [{ t: 'link', href: 'javascript:alert(1)', children: [{ t: 'text', v: 'x' }] }],
    });
    expect(r.success).toBe(false);
  });

  it('object rỗng hợp lệ — chưa dịch gì cũng là một trạng thái', () => {
    expect(zEntryDataPartial(NEWS, GROUPS, CTX).safeParse({}).success).toBe(true);
  });
});

describe('validateEntryData', () => {
  it('trả lỗi có tên field, để form biết tô ô nào', () => {
    const r = validateEntryData(NEWS, GROUPS, { ...FULL, title: undefined }, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('title');
  });

  it('thông báo lỗi là tiếng Việt, không phải câu mặc định của zod', () => {
    const r = validateEntryData(NEWS, GROUPS, { ...FULL, title: 'x'.repeat(121) }, CTX);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('Dài quá 120 ký tự');
    expect(r.ok === false && r.error).not.toContain('String must contain');
  });
});

/* ── Field richdoc và trần độ dài ─────────────────────────────────────── */

const P = (v: string) => ({ b: 'p', children: [{ t: 'text', v }] });

describe('field richdoc', () => {
  const F: FieldDef[] = [{ t: 'richdoc', key: 'body', label: 'Nội dung', required: true }];

  it('nhận cây khối', () => {
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [P('Xin chào')] }).success).toBe(true);
  });

  it('từ chối chuỗi HTML — cùng luật với richtext', () => {
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: '<p>xin chào</p>' }).success).toBe(false);
  });

  it('từ chối cây RichText phẳng — richdoc là một định dạng KHÁC, không phải richtext đậm hơn', () => {
    // Đây là lý do `richtext → richdoc` không có trong `SAFE_RETYPE`: một giá trị
    // richtext cũ đọc bằng zod của richdoc sẽ trượt ở mọi phần tử.
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [{ t: 'text', v: 'x' }] }).success).toBe(false);
  });

  it('từ chối hình dạng { type:"doc", content } của Tiptap', () => {
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: { type: 'doc', content: [] } }).success).toBe(false);
  });

  it('chặn href javascript: — dùng chung zInline với doc', () => {
    const body = [{ b: 'p', children: [{ t: 'link', href: 'javascript:alert(1)', children: [{ t: 'text', v: 'x' }] }] }];
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body }).success).toBe(false);
  });

  it('ảnh trong nội dung phải có alt, trừ khi được đánh dấu trang trí', () => {
    // `zRichDoc` nhận alt rỗng ở tầng cú pháp (discriminatedUnion không nhận
    // ZodEffects), nên nếu đường ghi này không cưỡng chế thì luật đó không tồn tại
    // ở đâu cả — khác doc, vốn có `doc/validate.ts`.
    const noAlt = [{ b: 'figure', assetId: 'a1', alt: '' }];
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: noAlt }).success).toBe(false);
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [{ b: 'figure', assetId: 'a1', alt: '   ' }] }).success).toBe(false);
    expect(
      zEntryData(F, GROUPS, CTX).safeParse({ body: [{ b: 'figure', assetId: 'a1', alt: '', decorative: true }] }).success,
    ).toBe(true);
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [{ b: 'figure', assetId: 'a1', alt: 'Lịch' }] }).success).toBe(true);
  });
});

describe('trần độ dài — không còn là cấu hình chết', () => {
  it('maxChars của richdoc được áp, đếm trên chữ chứ không trên JSON', () => {
    const F: FieldDef[] = [{ t: 'richdoc', key: 'body', label: 'Nội dung', maxChars: 10 }];
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [P('mười chữ.')] }).success).toBe(true);
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [P('x'.repeat(11))] }).success).toBe(false);
    // Chia làm nhiều khối không lách được trần: nó đếm cả tài liệu.
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [P('xxxxxx'), P('xxxxxx')] }).success).toBe(false);
  });

  it('maxBlocks của richdoc được áp — một cú dán từ Word có thể sinh nghìn đoạn', () => {
    const F: FieldDef[] = [{ t: 'richdoc', key: 'body', label: 'Nội dung', maxBlocks: 3 }];
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [P('a'), P('b'), P('c')] }).success).toBe(true);
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [P('a'), P('b'), P('c'), P('d')] }).success).toBe(false);
  });

  it('maxBlocks và maxChars là HAI trục, một cái đạt không tha cái kia', () => {
    const F: FieldDef[] = [{ t: 'richdoc', key: 'body', label: 'Nội dung', maxBlocks: 100, maxChars: 5 }];
    // Ít khối, nhiều chữ.
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [P('x'.repeat(20))] }).success).toBe(false);
    // Nhiều khối, ít chữ.
    const many: FieldDef[] = [{ t: 'richdoc', key: 'body', label: 'Nội dung', maxBlocks: 2, maxChars: 1000 }];
    expect(zEntryData(many, GROUPS, CTX).safeParse({ body: [P('a'), P('b'), P('c')] }).success).toBe(false);
  });

  it('maxLength của richtext được áp — trước đây SchemaEditor cho đặt mà không ai đọc', () => {
    // `entry-data.ts` chỉ áp trần trong `case 'text'`, nên một ô "tối đa 10 ký tự"
    // vẫn nhận trọn một cú dán 5MB, và chỗ vỡ là lúc render.
    const F: FieldDef[] = [{ t: 'richtext', key: 'body', label: 'Nội dung', maxLength: 10 }];
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [{ t: 'text', v: 'mười chữ.' }] }).success).toBe(true);
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [{ t: 'text', v: 'x'.repeat(11) }] }).success).toBe(false);
  });

  it('richtext đếm trên plainText nên chữ trong strong/link cũng tính', () => {
    const F: FieldDef[] = [{ t: 'richtext', key: 'body', label: 'Nội dung', maxLength: 5 }];
    const body = [{ t: 'strong', children: [{ t: 'link', href: '/x', children: [{ t: 'text', v: 'xxxxxxxx' }] }] }];
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body }).success).toBe(false);
  });

  it('không đặt trần thì không chặn gì', () => {
    const F: FieldDef[] = [
      { t: 'richtext', key: 'rt', label: 'A' },
      { t: 'richdoc', key: 'rd', label: 'B' },
    ];
    const long = 'x'.repeat(50000);
    expect(zEntryData(F, GROUPS, CTX).safeParse({ rt: [{ t: 'text', v: long }], rd: [P(long)] }).success).toBe(true);
  });

  it('trần cũng áp trong lớp phủ bản dịch — không có đường ghi nào bỏ qua nó', () => {
    // `zEntryDataPartial` là một đường ghi RIÊNG (`applyEntryLocale`). Trần chỉ áp ở
    // một trong hai đường nghĩa là bản dịch lách được trần của bản gốc.
    const F: FieldDef[] = [{ t: 'richdoc', key: 'body', label: 'Nội dung', maxChars: 5 }];
    expect(zEntryDataPartial(F, GROUPS, CTX).safeParse({ body: [P('x'.repeat(20))] }).success).toBe(false);
  });
});

/* ── Field html: làm sạch Ở ĐƯỜNG GHI ─────────────────────────────────── */

/*
 * Những test này kiểm một điều mà `html-sanitize.test.ts` KHÔNG kiểm được: rằng
 * phép làm sạch thực sự nằm trên đường ghi, và giá trị đi ra khỏi validator là bản
 * đã lọc — không phải bản gốc.
 *
 * Đây là chỗ vỡ tệ nhất nếu ai đó đổi `.transform()` thành `.refine()` sau này:
 * mọi test của `html-sanitize.ts` vẫn xanh, và database vẫn nhận `<script>`.
 */
describe('field html', () => {
  const F: FieldDef[] = [{ t: 'html', key: 'body', label: 'Nội dung' }];

  /**
   * `data.body` của một lần parse THÀNH CÔNG.
   *
   * Ép `r as { data: { body: string } }` không biên dịch được: kết quả `safeParse`
   * là union, và nhánh lỗi có `data: undefined` — TypeScript nói đúng khi từ chối.
   *
   * NÉM khi thất bại chứ không trả `undefined`: một test đọc `undefined` rồi
   * `expect(undefined).not.toContain('onclick')` sẽ XANH mà chẳng kiểm gì cả. Đây
   * là file canh cho việc HTML được làm sạch TRƯỚC khi vào database, nên một test
   * xanh giả ở đây tệ hơn không có test.
   */
  const bodyOf = (r: {
    success: boolean;
    data?: unknown;
    error?: { issues: { message: string }[] };
  }): string => {
    if (!r.success) {
      const why = r.error?.issues.map((i) => i.message).join('; ') ?? 'không rõ';
      throw new Error(`safeParse thất bại: ${why}`);
    }
    return (r.data as { body: string }).body;
  };

  it('trả về chuỗi ĐÃ LÀM SẠCH, không phải chuỗi gốc', () => {
    const r = zEntryData(F, GROUPS, CTX).safeParse({
      body: '<p onclick="alert(1)">a</p><script>alert(2)</script>',
    });
    expect(r.success).toBe(true);
    const body = bodyOf(r);
    expect(body).not.toContain('onclick');
    expect(body).not.toContain('alert');
    expect(body).toContain('a');
  });

  it('bài rỗng chuẩn hoá về chuỗi rỗng, không phải "<p>&nbsp;</p>"', () => {
    for (const raw of ['<p></p>', '<p>&nbsp;</p>', '<p><br></p>']) {
      const r = zEntryData(F, GROUPS, CTX).safeParse({ body: raw });
      expect(r.success, raw).toBe(true);
      expect(bodyOf(r), raw).toBe('');
    }
  });

  it('iframe bị gỡ khi chưa khai host, và ĐƯỢC giữ khi đã khai', () => {
    const yt = '<iframe src="https://www.youtube.com/embed/abc"></iframe>';

    const closed = zEntryData(F, GROUPS, CTX).safeParse({ body: yt });
    expect(bodyOf(closed)).not.toContain('iframe');

    const open = zEntryData(F, GROUPS, { iframeHosts: ['www.youtube.com'], siteHost: null }).safeParse({ body: yt });
    expect(bodyOf(open)).toContain('youtube.com/embed/abc');
  });

  it('maxChars đếm trên CHỮ, không trên chuỗi HTML', () => {
    const G: FieldDef[] = [{ t: 'html', key: 'body', label: 'Nội dung', maxChars: 10 }];
    // 9 chữ nhưng ~70 ký tự HTML: đếm trên chuỗi thì trượt, đếm trên chữ thì đúng.
    const rich = '<p style="text-align:center"><strong>chin chu.</strong></p>';
    expect(zEntryData(G, GROUPS, CTX).safeParse({ body: rich }).success).toBe(true);
    expect(zEntryData(G, GROUPS, CTX).safeParse({ body: '<p>mot cau dai hon muoi ky tu</p>' }).success).toBe(false);
  });

  it('từ chối giá trị không phải chuỗi — richdoc cũ là một MẢNG', () => {
    // Đây là ca mà `SAFE_RETYPE` cố ý không cho `richdoc → html`: giá trị cũ trong
    // JSONB là mảng, và nó phải bị từ chối ồn ào chứ không lặng lẽ thành bài trống.
    expect(zEntryData(F, GROUPS, CTX).safeParse({ body: [{ b: 'p', children: [] }] }).success).toBe(false);
  });

  it('giữ bảng, mark, u/s/sup/sub, màu chữ và canh lề', () => {
    const raw =
      '<h2>T</h2><p style="text-align:center"><u>a</u><s>b</s><mark class="marker-yellow">c</mark>' +
      '<sup>d</sup><sub>e</sub><span style="color:#ff4d2e">f</span></p>' +
      '<figure class="table"><table><tbody><tr><th colspan="2">x</th></tr></tbody></table></figure>';
    const r = zEntryData(F, GROUPS, CTX).safeParse({ body: raw });
    const body = bodyOf(r);
    for (const frag of ['<h2>', '<u>', '<s>', 'marker-yellow', '<sup>', '<sub>', 'color:#ff4d2e', 'text-align:center', 'colspan="2"', '<table>']) {
      expect(body, frag).toContain(frag);
    }
  });

  it('lớp phủ bản dịch đi qua ĐÚNG cùng phép làm sạch', () => {
    // `validateEntryDataPartial` là cửa riêng của bản dịch. Một đường ghi bỏ qua
    // phép làm sạch ở đây thì `applyEntryLocale` sẽ đặt HTML thô vào đúng chỗ mà
    // `data` đã được lọc — cùng loại lỗ mà `entry-write.ts` đã phải bịt một lần.
    const r = zEntryDataPartial(F, GROUPS, CTX).safeParse({ body: '<p onmouseover="x()">en</p>' });
    expect(r.success).toBe(true);
    expect(bodyOf(r)).not.toContain('onmouseover');
  });
});

describe('field seo', () => {
  const F: FieldDef[] = [
    { t: 'text', key: 'title', label: 'Tiêu đề', required: true },
    { t: 'seo', key: 'seo', label: 'SEO' },
  ];

  it('nhận giá trị đủ, chuẩn hoá trước khi lưu', () => {
    const r = validateEntryData(F, GROUPS, {
      title: 'A',
      seo: {
        metaTitle: ' Tiêu đề SEO ',
        metaDescription: '',
        ogImage: { assetId: 'img1', alt: 'Ảnh' },
        canonicalUrl: 'https://vd.test/blogs/a#x',
        noindex: true,
        structuredData: { '@type': 'Article' },
      },
    }, CTX);
    expect(r).toEqual({
      ok: true,
      data: {
        title: 'A',
        seo: {
          metaTitle: 'Tiêu đề SEO',
          ogImage: { assetId: 'img1', alt: 'Ảnh' },
          canonicalUrl: '/blogs/a',
          noindex: true,
          structuredData: { '@type': 'Article' },
        },
      },
    });
  });

  it('không có field seo trong data vẫn hợp lệ — ô SEO luôn tuỳ chọn', () => {
    expect(validateEntryData(F, GROUPS, { title: 'A' }, CTX)).toEqual({ ok: true, data: { title: 'A' } });
  });

  it('lỗi chỉ đúng ô con, bằng tiếng Việt', () => {
    expect(validateEntryData(F, GROUPS, { title: 'A', seo: { metaTitle: 'a'.repeat(121) } }, CTX)).toEqual({
      ok: false,
      error: 'seo.metaTitle: Tiêu đề SEO dài quá 120 ký tự (đang có 121)',
    });
    expect(validateEntryData(F, GROUPS, { title: 'A', seo: { canonicalUrl: 'https://evil.com/x' } }, CTX)).toEqual({
      ok: false,
      error: 'seo.canonicalUrl: Đường dẫn chuẩn phải thuộc site này (vd.test). Nhập dạng /duong-dan.',
    });
  });

  it('lớp phủ bản dịch đi qua CÙNG luật', () => {
    const r = zEntryDataPartial(F, GROUPS, CTX).safeParse({ seo: { metaDescription: 'a'.repeat(301) } });
    expect(r.success).toBe(false);
    const ok = zEntryDataPartial(F, GROUPS, CTX).safeParse({ seo: { ogImage: { alt: 'EN' } } });
    expect(ok.success && ok.data).toEqual({ seo: { ogImage: { alt: 'EN' } } });
  });
});

/*
 * Form gửi `null` cho mọi ô TRỐNG không phải chữ (`emptyValue` trong `form-state.ts`:
 * ảnh, tệp, số, ngày, quan hệ một). `.optional()` chỉ nhận "vắng mặt", nên trước
 * 21/10/2026 mọi bài có một ô tuỳ chọn để trống KHÔNG lưu được qua form —
 * "author_photo: Phải là đối tượng, không phải null" trên 9 bài `news` chưa có ảnh tác giả.
 */
describe('ô tuỳ chọn để trống từ form (null)', () => {
  const F: FieldDef[] = [
    { t: 'text', key: 'title', label: 'Tiêu đề', required: true },
    { t: 'image', key: 'author_photo', label: 'Ảnh tác giả' },
    { t: 'file', key: 'pdf', label: 'Tệp' },
    { t: 'number', key: 'views', label: 'Lượt xem' },
    { t: 'date', key: 'at', label: 'Ngày' },
    { t: 'relation', key: 'related', label: 'Liên quan', typeKey: 'news', cardinality: 'one' },
    { t: 'seo', key: 'seo', label: 'SEO' },
  ];

  it('null ở ô tuỳ chọn = vắng mặt: lưu được, và khoá không vào data', () => {
    const r = validateEntryData(
      F, GROUPS,
      { title: 'A', author_photo: null, pdf: null, views: null, at: null, related: null, seo: null },
      CTX,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(JSON.stringify(r.data))).toEqual({ title: 'A' });
  });

  it('null ở ô BẮT BUỘC vẫn bị từ chối', () => {
    const req: FieldDef[] = [{ t: 'image', key: 'cover', label: 'Ảnh bìa', required: true }];
    expect(validateEntryData(req, GROUPS, { cover: null }, CTX).ok).toBe(false);
  });

  it('lớp phủ bản dịch cũng nhận null', () => {
    expect(zEntryDataPartial(F, GROUPS, CTX).safeParse({ views: null, author_photo: null }).success).toBe(true);
  });
});
