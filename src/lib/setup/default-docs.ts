/**
 * Doc mặc định cho site vừa cài: trang chủ và trang 404.
 *
 * ## Vì sao trang chủ ở đây KHÔNG phải doc của `prisma/seed.ts`
 *
 * Doc của seed cũ là hero + trust bar của một site thật, có câu chữ và số giấy phép của một
 * dự án cụ thể. Builder chạy cho nhiều dự án, nên một site vừa cài phải mở ra một
 * trang trung tính, không mang câu chữ của dự án nào. Seed vẫn truyền doc của nó
 * vào `ensureSiteDefaults` cho máy dev.
 *
 * Chỉ dùng `$token`: không mã hex, không px.
 */

import { CURRENT_SCHEMA_VERSION, type Doc, type RichText } from '@/lib/doc/types';

const t = (name: string) => ({ $token: name });

export const DEFAULT_HOME = {
  title: 'Trang chủ',
  description: null as string | null,
};

export const DEFAULT_NOT_FOUND = {
  slug: '404',
  title: 'Không tìm thấy trang',
  description: 'Đường dẫn này không tồn tại, hoặc trang chưa được publish.',
};

/** Một khối giữa màn hình: tiêu đề, một đoạn, một nút. Dùng chung cho hai trang. */
function centeredDoc(opts: {
  rootName: string;
  heading: RichText;
  lede: string;
  button?: { label: string; href: string };
}): Doc {
  const children = ['heading1', 'lede0001', ...(opts.button ? ['cta00001'] : [])];
  const nodes: Doc['nodes'] = {
    root0001: {
      id: 'root0001', type: 'Section', tag: 'main',
      parentId: null, children: ['block001'],
      name: opts.rootName, effects: [],
      style: { base: { container: { type: 'inline-size' } } },
    },
    block001: {
      id: 'block001', type: 'Section', tag: 'section',
      parentId: 'root0001', children,
      name: 'Khối chính', effects: [],
      style: {
        base: {
          layout: { display: 'flex', flexDirection: 'column', align: 'center', justify: 'center', gap: t('space-s') },
          spacing: { pt: t('space-3xl'), pb: t('space-3xl'), pl: t('gutter'), pr: t('gutter') },
          size: { minHeight: { v: 60, u: 'svh' } },
          typography: { align: 'center' },
        },
      },
    },
    heading1: {
      id: 'heading1', type: 'Text', tag: 'h1',
      parentId: 'block001', children: [], name: 'Tiêu đề', effects: [],
      style: {
        base: {
          typography: { family: t('font-display'), size: t('step-4'), weight: 700, wrap: 'balance' },
          size: { maxWidth: 'measure' },
        },
      },
      content: opts.heading,
    },
    lede0001: {
      id: 'lede0001', type: 'Text', tag: 'p',
      parentId: 'block001', children: [], name: 'Mô tả', effects: [],
      style: {
        base: {
          typography: { size: t('step-0'), wrap: 'pretty' },
          size: { maxWidth: 'measure' },
        },
      },
      content: [{ t: 'text', v: opts.lede }],
    },
  } as Doc['nodes'];
  if (opts.button) {
    nodes.cta00001 = {
      id: 'cta00001', type: 'Button',
      parentId: 'block001', children: [], name: 'Nút', effects: [],
      variant: 'primary',
      action: { kind: 'link', href: opts.button.href },
      label: [{ t: 'text', v: opts.button.label }],
      style: { base: { spacing: { mt: t('space-s') } } },
    } as Doc['nodes'][string];
  }
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root0001', nodes } as Doc;
}

/** Ba thẻ giới thiệu Quilder trên trang chủ mặc định. */
const QUILDER_POINTS = [
  {
    title: 'Ghép khối thành trang',
    body: 'Mỗi trang là một cây khối: chữ, ảnh, nút, component dùng lại. Kéo thả và sửa ngay trên bản xem trước.',
  },
  {
    title: 'Claude cùng dựng',
    body: 'Kết nối Claude qua MCP rồi ra lệnh bằng lời: “đổi tiêu đề”, “thêm khối FAQ”. Claude chỉ chạm bản nháp.',
  },
  {
    title: 'Xuất bản là một ảnh chụp',
    body: 'Mỗi lần publish chụp lại cả site. Lùi về bản cũ mất chưa tới một giây — không build, không deploy lại.',
  },
] as const;

/**
 * Trang chủ của site vừa cài: lời chào + đoạn giới thiệu ngắn về Quilder.
 *
 * Giới thiệu Quilder vì đây là trang ĐẦU TIÊN người cài nhìn thấy — nó nên nói được công
 * cụ này làm gì và việc kế tiếp là gì (nút "Mở builder"). Nội dung khởi đầu, người dùng
 * sửa hoặc xoá thoải mái.
 *
 * Tên site đi vào CHỮ của trang, không qua binding: binding `source:'site'` đọc
 * `Site.globals`, còn tên site là một cột riêng.
 *
 * Chỉ dùng `$token`. Thẻ giới thiệu xếp bằng flex-wrap với `basis` 16rem: màn rộng ba
 * cột, màn hẹp tự xuống dòng — không cần override theo khổ màn.
 */
export function defaultHomeDoc(siteName: string): Doc {
  const pad = { pt: t('space-3xl'), pb: t('space-3xl'), pl: t('gutter'), pr: t('gutter') };
  const cardIds = QUILDER_POINTS.map((_, i) => `card000${i + 1}`);
  const nodes: Doc['nodes'] = {
    root0001: {
      id: 'root0001', type: 'Section', tag: 'main', parentId: null,
      children: ['hero0001', 'about001'], name: 'Trang chủ', effects: [],
      style: { base: { container: { type: 'inline-size' } } },
    },
    hero0001: {
      id: 'hero0001', type: 'Section', tag: 'section', parentId: 'root0001',
      children: ['heading1', 'lede0001', 'cta00001'], name: 'Mở đầu', effects: [],
      style: {
        base: {
          layout: { display: 'flex', flexDirection: 'column', align: 'center', justify: 'center', gap: t('space-s') },
          spacing: pad,
          size: { minHeight: { v: 60, u: 'svh' } },
          typography: { align: 'center' },
        },
      },
    },
    heading1: {
      id: 'heading1', type: 'Text', tag: 'h1', parentId: 'hero0001', children: [], name: 'Tiêu đề', effects: [],
      style: {
        base: {
          typography: { family: t('font-display'), size: t('step-5'), weight: 700, wrap: 'balance' },
          size: { maxWidth: 'measure' },
        },
      },
      content: [{ t: 'text', v: `Chào mừng tới ${siteName}` }],
    },
    lede0001: {
      id: 'lede0001', type: 'Text', tag: 'p', parentId: 'hero0001', children: [], name: 'Mô tả', effects: [],
      style: { base: { typography: { size: t('step-1'), wrap: 'pretty' }, size: { maxWidth: 'measure' } } },
      content: [
        { t: 'text', v: 'Đây là trang chủ mặc định. Mở builder để thay nội dung này bằng câu chuyện của bạn.' },
      ],
    },
    cta00001: {
      id: 'cta00001', type: 'Button', parentId: 'hero0001', children: [], name: 'Nút mở builder', effects: [],
      variant: 'primary',
      action: { kind: 'link', href: '/builder' },
      label: [{ t: 'text', v: 'Mở builder' }],
      style: { base: { spacing: { mt: t('space-s') } } },
    },
    about001: {
      id: 'about001', type: 'Section', tag: 'section', parentId: 'root0001',
      children: ['abouth01', 'aboutp01', 'cards001'], name: 'Về Quilder', effects: [],
      style: {
        base: {
          layout: { display: 'flex', flexDirection: 'column', align: 'center', gap: t('space-m') },
          spacing: pad,
          typography: { align: 'center' },
        },
      },
    },
    abouth01: {
      id: 'abouth01', type: 'Text', tag: 'h2', parentId: 'about001', children: [], name: 'Tiêu đề Quilder', effects: [],
      style: { base: { typography: { family: t('font-display'), size: t('step-3'), weight: 700, wrap: 'balance' } } },
      content: [{ t: 'text', v: 'Website này được dựng bằng Quilder' }],
    },
    aboutp01: {
      id: 'aboutp01', type: 'Text', tag: 'p', parentId: 'about001', children: [], name: 'Mô tả Quilder', effects: [],
      style: { base: { typography: { size: t('step-0'), wrap: 'pretty' }, size: { maxWidth: 'measure' } } },
      content: [
        {
          t: 'text',
          v: 'Quilder là trình dựng website bằng cách ghép khối — sửa trực tiếp trên bản xem trước, cùng Claude làm trợ lý.',
        },
      ],
    },
    cards001: {
      id: 'cards001', type: 'Stack', direction: { base: 'row' }, parentId: 'about001', children: cardIds, name: 'Ba điểm chính', effects: [],
      style: {
        base: {
          layout: { display: 'flex', wrap: true, gap: t('space-s'), justify: 'center' },
          size: { maxWidth: 'container', width: 'full' },
          spacing: { mt: t('space-s') },
          typography: { align: 'left' },
        },
      },
    },
  } as Doc['nodes'];

  QUILDER_POINTS.forEach((p, i) => {
    const id = cardIds[i]!;
    const h = `cardh00${i + 1}`;
    const b = `cardp00${i + 1}`;
    nodes[id] = {
      id, type: 'Stack', direction: { base: 'column' }, parentId: 'cards001', children: [h, b], name: p.title, effects: [],
      style: {
        base: {
          layout: { display: 'flex', flexDirection: 'column', gap: t('space-2xs'), flex: { grow: 1, basis: { v: 16, u: 'rem' } } },
          spacing: { pt: t('space-m'), pb: t('space-m'), pl: t('space-m'), pr: t('space-m') },
          fill: { color: t('color-glass') },
          border: { radius: t('radius-l') },
        },
      },
    } as Doc['nodes'][string];
    nodes[h] = {
      id: h, type: 'Text', tag: 'h3', parentId: id, children: [], name: 'Tiêu đề thẻ', effects: [],
      style: { base: { typography: { size: t('step-1'), weight: 700 } } },
      content: [{ t: 'text', v: p.title }],
    } as Doc['nodes'][string];
    nodes[b] = {
      id: b, type: 'Text', tag: 'p', parentId: id, children: [], name: 'Nội dung thẻ', effects: [],
      style: { base: { typography: { size: t('step--1'), wrap: 'pretty' } } },
      content: [{ t: 'text', v: p.body }],
    } as Doc['nodes'][string];
  });

  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'root0001', nodes } as Doc;
}

export function defaultNotFoundDoc(): Doc {
  return centeredDoc({
    rootName: 'Trang 404',
    heading: [{ t: 'text', v: DEFAULT_NOT_FOUND.title }],
    lede: DEFAULT_NOT_FOUND.description,
    button: { label: 'Về trang chủ', href: '/' },
  });
}
