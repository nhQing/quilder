import { describe, expect, it } from 'vitest';

/**
 * Tầng cú pháp.
 *
 * Cho tới trước file này, `/api/ops` nhận `body.ops` rồi ép kiểu `as Op[]` — nên
 * "tầng 1" trong bốn tầng validator thật ra không tồn tại lúc chạy. Với op do
 * inspector sinh thì không lộ ra, vì chính code của ta tạo chúng. Với op do một
 * model sinh thì đó là toàn bộ bề mặt tấn công.
 *
 * Các test ở đây phần lớn là những thứ MỘT MODEL SẼ GỬI SAI, chứ không phải
 * những thứ một lập trình viên gõ nhầm.
 */

import { BREAKPOINTS, STYLE_STATES } from '@/lib/design/breakpoints';
import {
  STYLE_TARGET_LIST,
  zNode,
  zOp,
  zOps,
  zStylePatch,
  zStyleProps,
  zodIssues,
} from './schema';

const textNode = {
  id: 'n1',
  type: 'Text' as const,
  tag: 'h1' as const,
  parentId: 'root',
  children: [],
  effects: [],
  content: [{ t: 'text' as const, v: 'Xin chào' }],
  style: { base: {} },
};

describe('zOp — hình dạng cơ bản', () => {
  it('nhận op hợp lệ', () => {
    expect(zOp.safeParse({ op: 'setText', nodeId: 'n1', field: 'content', value: [{ t: 'text', v: 'A' }] }).success)
      .toBe(true);
    expect(zOp.safeParse({ op: 'removeNode', nodeId: 'n1' }).success).toBe(true);
  });

  it('từ chối op không có trong danh sách', () => {
    expect(zOp.safeParse({ op: 'deleteEverything', nodeId: 'n1' }).success).toBe(false);
  });

  it('từ chối field thừa', () => {
    // `.strict()` quan trọng với input từ model: một field thừa thường là dấu
    // hiệu model đang tưởng tượng ra một API khác, và im lặng bỏ qua nó nghĩa là
    // op chạy nhưng không làm đúng thứ model tưởng nó làm.
    const res = zOp.safeParse({ op: 'removeNode', nodeId: 'n1', recursive: true });
    expect(res.success).toBe(false);
  });

  it('chặn batch quá 80 op', () => {
    const many = Array.from({ length: 81 }, () => ({ op: 'removeNode', nodeId: 'n1' }));
    expect(zOps.safeParse(many).success).toBe(false);
    expect(zOps.safeParse(many.slice(0, 80)).success).toBe(true);
  });

  it('từ chối batch rỗng', () => {
    expect(zOps.safeParse([]).success).toBe(false);
  });
});

describe('chặn injection ngay ở schema', () => {
  it('từ chối hex thoát ra thành declaration thứ hai', () => {
    // Đây đúng là payload mà test R1 đã dùng để phá compiler bản đầu.
    const res = zStyleProps.safeParse({
      fill: { color: { hex: 'red;background:url(javascript:alert(1))' } },
    });
    expect(res.success).toBe(false);
  });

  it('nhận hex hợp lệ ở cả bốn độ dài', () => {
    for (const hex of ['#fff', '#ffff', '#0d1321', '#0d132180']) {
      expect(zStyleProps.safeParse({ fill: { color: { hex } } }).success).toBe(true);
    }
  });

  it('từ chối gridArea chứa ký tự đóng được declaration', () => {
    expect(zStyleProps.safeParse({ layout: { gridArea: 'a; color: red' } }).success).toBe(false);
    expect(zStyleProps.safeParse({ layout: { gridArea: 'hero-main' } }).success).toBe(true);
  });

  it('từ chối href dùng scheme javascript:', () => {
    const link = (href: string) => ({
      ...textNode,
      content: [{ t: 'link', href, children: [{ t: 'text', v: 'x' }] }],
    });
    expect(zNode.safeParse(link('javascript:alert(1)')).success).toBe(false);
    expect(zNode.safeParse(link('  JavaScript:alert(1)')).success).toBe(false);
    expect(zNode.safeParse(link('data:text/html,<script>')).success).toBe(false);
    expect(zNode.safeParse(link('/lien-he')).success).toBe(true);
    expect(zNode.safeParse(link('https://example.com')).success).toBe(true);
  });

  it('preload cua Video chi nhan ba gia tri cua HTML', () => {
    const video = (extra: Record<string, unknown>) => ({
      id: 'v1', type: 'Video', parentId: 'root', children: [], effects: [],
      assetId: 'a1', posterAssetId: null, style: { base: {} }, ...extra,
    });

    // Bo trong van hop le: renderer suy tu autoplay, nen doc cu khong doi.
    expect(zNode.safeParse(video({})).success).toBe(true);

    for (const v of ['none', 'metadata', 'auto']) {
      expect(zNode.safeParse(video({ preload: v })).success).toBe(true);
    }

    // Gia tri lac phai bi chan o tang cu phap: mot model se gui "lazy"
    // (thuoc tinh cua <img>, khong phai cua <video>) va trinh duyet se lang le
    // roi ve mac dinh thay vi bao loi.
    expect(zNode.safeParse(video({ preload: 'lazy' })).success).toBe(false);
    expect(zNode.safeParse(video({ preload: true })).success).toBe(false);
  });

  it('từ chối href javascript: trong action của Button', () => {
    const button = {
      id: 'b1', type: 'Button', parentId: 'root', children: [], effects: [],
      label: [{ t: 'text', v: 'Bấm' }], variant: 'primary',
      action: { kind: 'link', href: 'javascript:void(0)' },
      style: { base: {} },
    };
    expect(zNode.safeParse(button).success).toBe(false);
  });
});

describe('null: hợp lệ trong patch, không hợp lệ trong style', () => {
  it('patch cho phép null để xoá một key', () => {
    expect(zStylePatch.safeParse({ spacing: { pt: null } }).success).toBe(true);
    expect(zStylePatch.safeParse({ spacing: null }).success).toBe(true);
  });

  it('style đầy đủ KHÔNG cho null', () => {
    // Nếu lọt, `null` sống sót vào DB và compiler phát ra `gap: null;` — phép
    // kiểm ở css.ts là `!== undefined`, nên null đi qua được.
    expect(zStyleProps.safeParse({ spacing: { pt: null } }).success).toBe(false);
    expect(zStyleProps.safeParse({ layout: { gap: null } }).success).toBe(false);
  });
});

describe('ràng buộc cấu trúc', () => {
  it('node lá không nhận con', () => {
    expect(zNode.safeParse({ ...textNode, children: ['n2'] }).success).toBe(false);
    expect(zNode.safeParse(textNode).success).toBe(true);
  });

  it('token ref phải có tên', () => {
    expect(zStyleProps.safeParse({ spacing: { pt: { $token: '' } } }).success).toBe(false);
    expect(zStyleProps.safeParse({ spacing: { pt: { $token: 'space-l' } } }).success).toBe(true);
  });

  it('Len lồng nhau vẫn được kiểm', () => {
    const ok = { size: { maxWidth: { clamp: [{ v: 20, u: 'rem' }, { v: 50, u: 'cqw' }, { $token: 'measure' }] } } };
    expect(zStyleProps.safeParse(ok).success).toBe(true);

    const bad = { size: { maxWidth: { clamp: [{ v: 20, u: 'parsec' }, { v: 1, u: 'px' }, { v: 2, u: 'px' }] } } };
    expect(zStyleProps.safeParse(bad).success).toBe(false);
  });

  it('opacity ngoài khoảng 0–1 bị từ chối', () => {
    expect(zStyleProps.safeParse({ effects: { opacity: 1.5 } }).success).toBe(false);
    expect(zStyleProps.safeParse({ effects: { opacity: 0.4 } }).success).toBe(true);
  });

  it('NaN và Infinity không lọt vào độ dài', () => {
    expect(zStyleProps.safeParse({ spacing: { pt: { v: Number.NaN, u: 'px' } } }).success).toBe(false);
    expect(zStyleProps.safeParse({ spacing: { pt: { v: Infinity, u: 'px' } } }).success).toBe(false);
  });
});

describe('setStyle.target', () => {
  it('phủ đúng mọi breakpoint và state, không thừa không thiếu', () => {
    // STYLE_TARGETS phải viết tường minh (z.enum cần tuple literal), nên nó có
    // thể trôi khỏi hai nguồn kia. Test này là thứ giữ chúng khớp nhau.
    const expected = [...BREAKPOINTS, ...STYLE_STATES].sort();
    expect([...STYLE_TARGET_LIST].sort()).toEqual(expected);
  });

  it('từ chối target lạ', () => {
    const res = zOp.safeParse({ op: 'setStyle', nodeId: 'n1', target: 'desktop', patch: {} });
    expect(res.success).toBe(false);
  });
});

describe('zodIssues', () => {
  it('trỏ index về đúng op gây lỗi', () => {
    const res = zOps.safeParse([
      { op: 'removeNode', nodeId: 'n1' },
      { op: 'removeNode' },
    ]);
    expect(res.success).toBe(false);
    if (res.success) return;

    const issues = zodIssues(res.error);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.index).toBe(1);
  });
});

/**
 * `setOverride.patch` phải khai ĐỦ bộ khoá của `ContentOverride`.
 *
 * Nhánh này `.strict()`, nên một khoá thiếu không phải "chưa hỗ trợ" — nó là TỪ
 * CHỐI. `zInstance.overrides` đã nhận `posterAssetId` từ lâu, nên doc lưu được
 * giá trị ấy; chỉ đường OP là không ghi tới được nó. Hệ quả: ảnh chờ của một
 * video nằm trong component không ghi đè và không dịch được.
 */
describe('setOverride.patch — đủ bộ khoá của ContentOverride', () => {
  const patch = (p: unknown) =>
    zOp.safeParse({ op: 'setOverride', nodeId: 'n1', localId: 'v1', patch: p });

  it('nhận posterAssetId', () => {
    expect(patch({ posterAssetId: 'asset-1' }).success).toBe(true);
  });

  it('nhận posterAssetId: null — quay về poster của component', () => {
    expect(patch({ posterAssetId: null }).success).toBe(true);
  });

  it('vẫn từ chối khoá style — `.strict()` ở đây là thứ giữ mô hình instance', () => {
    expect(patch({ style: { base: {} } }).success).toBe(false);
  });

  it('mọi khoá của OVERRIDE_FIELDS đều qua được đường op', () => {
    // Ba nơi khai cùng một bộ khoá (`ContentOverride`, `zInstance.overrides`,
    // nhánh này). Test này là thứ bắt nơi thứ ba trôi khỏi hai nơi kia.
    expect(
      patch({
        content: [{ t: 'text', v: 'A' }],
        label: [{ t: 'text', v: 'B' }],
        alt: 'ảnh',
        assetId: 'a1',
        posterAssetId: 'p1',
        href: '/blogs',
        a11yLabel: 'nhãn',
      }).success,
    ).toBe(true);
  });
});
