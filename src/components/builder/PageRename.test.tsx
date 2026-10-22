import { describe, expect, it } from 'vitest';

import {
  collectionProblem,
  draftCollection,
  relationFieldsOf,
  ROLE_LABEL,
} from './PageRename';
import {
  PAGE_PARAM_ROLES,
  PARAM_ROLE_EXAMPLE,
  checkCollectionPairing,
  parsePageCollection,
  type PageParamRole,
} from '@/lib/builder/page-collection';
import type { FieldDef } from '@/lib/collections/field-def';

/**
 * Ba ô của dialog đổi tên — loại nội dung, vai, field quan hệ — và luật ghép chúng.
 *
 * ## Vì sao test phần THUẦN chứ không render dialog
 *
 * `vitest.config.ts` chạy `environment: 'node'`, nên không có DOM để bấm vào. Cùng
 * lý do và cùng cách đã ghi ở `SaveChip.test.tsx`: thứ đáng sai ở đây không phải
 * markup mà là phép quyết định "ba ô này ghép lại thành lời khai gì, và khi nào thì
 * chặn nút Lưu". Tách nó ra hàm thuần làm nó đo được.
 *
 * ## Tính chất chịu lực
 *
 * **UI không bao giờ được gửi đi một hình dạng mà server từ chối.** Server chặn hai
 * chiều (`zCollection.superRefine` ở `site-tools.ts`, `checkCollectionPairing` ở
 * `page-collection.ts`): vai `relation` thiếu `field`, và `field` đặt nhầm lên vai
 * khác. Một dropdown chào lựa chọn thứ ba rồi để server từ chối là một dropdown dạy
 * người dùng rằng builder hỏng.
 */

const RELATION_SCHEMA: FieldDef[] = [
  { t: 'text', key: 'title', label: 'Tiêu đề' },
  { t: 'relation', key: 'category', label: 'Danh mục', typeKey: 'danh-muc', cardinality: 'one' },
  { t: 'relation', key: 'author', label: 'Tác giả', typeKey: 'tac-gia', cardinality: 'one' },
  { t: 'taxonomy', key: 'tags', label: 'Thẻ' },
];

const CATEGORY = relationFieldsOf(RELATION_SCHEMA);

describe('ROLE_LABEL — dropdown chào đủ bốn vai', () => {
  it('không thiếu vai nào so với PAGE_PARAM_ROLES', () => {
    // Thiếu một khoá ở đây là một vai định tuyến mà giao diện không bao giờ đặt được;
    // thừa một khoá là một lựa chọn server không hiểu.
    expect(Object.keys(ROLE_LABEL).sort()).toEqual([...PAGE_PARAM_ROLES].sort());
  });
});

describe('relationFieldsOf', () => {
  it('chỉ lấy field kiểu relation, kèm loại ĐÍCH', () => {
    expect(CATEGORY).toEqual([
      { key: 'category', label: 'Danh mục', typeKey: 'danh-muc' },
      { key: 'author', label: 'Tác giả', typeKey: 'tac-gia' },
    ]);
  });

  it('loại chưa đọc được schema thì là danh sách rỗng, không ném', () => {
    expect(relationFieldsOf(undefined)).toEqual([]);
  });
});

describe('draftCollection — `field` chỉ đi kèm vai relation', () => {
  it('vai relation mang field', () => {
    expect(draftCollection('tin-tuc', 'relation', 'category')).toEqual({
      typeKey: 'tin-tuc',
      param: 'relation',
      field: 'category',
    });
  });

  it('ĐỔI vai mà ô field còn giá trị cũ thì field KHÔNG được gửi đi', () => {
    // Chiều thứ hai mà `zCollection.superRefine` chặn. Trạng thái này có thật: người
    // dùng chọn relation, chọn field, rồi đổi ý sang "chi tiết".
    expect(draftCollection('tin-tuc', 'entry', 'category')).toEqual({
      typeKey: 'tin-tuc',
      param: 'entry',
    });
    expect(draftCollection('tin-tuc', 'taxonomy', 'category')).not.toHaveProperty('field');
    expect(draftCollection('tin-tuc', 'list', 'category')).not.toHaveProperty('field');
  });

  it('chưa chọn loại thì là trang thường', () => {
    expect(draftCollection('', 'list', '')).toBeNull();
  });
});

describe('collectionProblem — chặn TẠI CHỖ đúng những gì server chặn', () => {
  const p = (a: Partial<Parameters<typeof collectionProblem>[0]>) =>
    collectionProblem({
      slug: 'blogs/[category-slug]',
      typeKey: 'tin-tuc',
      role: 'relation',
      field: 'category',
      relationFields: CATEGORY,
      ...a,
    });

  it('đủ ba ô thì không có gì để nói', () => {
    expect(p({})).toBeNull();
  });

  it('vai relation chưa chọn field thì chặn', () => {
    expect(p({ field: '' })).toMatch(/field relation/i);
  });

  it('loại không có field relation nào thì nói thẳng, không bắt đoán', () => {
    const msg = p({ field: '', relationFields: [] });
    expect(msg).toMatch(/không có field relation/i);
  });

  it('chưa đọc xong danh sách field vẫn chặn khi field rỗng', () => {
    // `null` = chưa fetch xong. Cho bấm Lưu ở đây là gửi đi đúng hình dạng server
    // từ chối, chỉ vì mạng chậm.
    expect(p({ field: '', relationFields: null })).not.toBeNull();
  });

  it('field đã có sẵn thì không chặn dù chưa đọc xong danh sách', () => {
    // Trang này chỉ đang đổi tiêu đề; chặn nó là bắt người dùng chờ một fetch mà họ
    // không cần.
    expect(p({ relationFields: null })).toBeNull();
  });

  it('slug không có đoạn động thì nêu ví dụ CỦA ĐÚNG VAI ĐÓ', () => {
    expect(p({ slug: 'blogs' })).toContain(PARAM_ROLE_EXAMPLE.relation);
    expect(p({ slug: 'blogs', role: 'entry', field: '' })).toContain(PARAM_ROLE_EXAMPLE.entry);
    expect(p({ slug: 'blogs', role: 'taxonomy', field: '' })).toContain(
      PARAM_ROLE_EXAMPLE.taxonomy,
    );
  });

  it('đoạn động mà chưa chọn loại → 404 im lặng', () => {
    expect(p({ typeKey: '', role: 'list', field: '' })).toMatch(/loại nội dung/i);
  });

  it('trang danh sách không được có đoạn động', () => {
    expect(p({ role: 'list', field: '' })).toMatch(/danh sách/i);
  });

  it('trang thường không mang lời khai nào thì im lặng', () => {
    expect(p({ slug: 'gioi-thieu', typeKey: '', role: 'list', field: '' })).toBeNull();
  });
});

/**
 * Hàng rào cuối: quét CẢ lưới trạng thái ba ô có thể ở, và đòi một chiều duy nhất —
 * UI im lặng ⟹ server nhận. Chiều này bắt được cả những ca không ai nghĩ tới khi
 * viết từng `it` ở trên.
 */
describe('UI im lặng thì server không bao giờ từ chối', () => {
  const SLUGS = ['', 'blogs', 'blogs/[category-slug]', 'blogs/post/[slug]'];
  const TYPES = ['', 'tin-tuc'];
  const FIELDS = ['', 'category'];

  it('mọi tổ hợp (slug × loại × vai × field)', () => {
    for (const slug of SLUGS) {
      for (const typeKey of TYPES) {
        for (const role of PAGE_PARAM_ROLES) {
          for (const field of FIELDS) {
            const problem = collectionProblem({
              slug,
              typeKey,
              role: role as PageParamRole,
              field,
              relationFields: CATEGORY,
            });
            if (problem) continue;

            const sent = draftCollection(typeKey, role as PageParamRole, field);
            const where = `slug=${slug} type=${typeKey} role=${role} field=${field}`;

            // 1. `checkCollectionPairing` — đường chung của builder và tool MCP.
            expect(checkCollectionPairing(slug, sent), where).toBeNull();

            // 2. `parsePageCollection` — phép đọc lại. Lời khai gửi đi phải đọc lại
            //    ra ĐÚNG chính nó; một lời khai bị `parse` trả `null` là một trang
            //    khớp URL rồi 404.
            if (sent) expect(parsePageCollection(sent), where).toEqual(sent);
          }
        }
      }
    }
  });
});
