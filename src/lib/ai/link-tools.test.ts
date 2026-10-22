import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  page: { findUnique: vi.fn() },
  preset: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

import type { SessionPayload } from '@/lib/auth/session';
import { LINK_TOOLS } from './link-tools';

const tool = LINK_TOOLS[0]!;
const ctx = { session: {} as SessionPayload, origin: 'https://a.test' };
const run = (url: string, c = ctx) => (tool.run as (i: unknown, c: unknown) => Promise<Record<string, any>>)({ url }, c);

const node = (o: Record<string, unknown>) => ({ style: {}, effects: [], children: [], parentId: null, ...o });

const pageDoc = {
  schemaVersion: 2,
  rootId: 'root',
  nodes: {
    root: node({ id: 'root', type: 'Stack', children: ['sec'] }),
    sec: node({ id: 'sec', type: 'Section', name: 'Hero', parentId: 'root', children: ['txt', 'inst'] }),
    txt: node({ id: 'txt', type: 'Text', tag: 'h1', parentId: 'sec', content: [{ t: 'text', v: 'Xin chào' }] }),
    inst: node({ id: 'inst', type: 'Instance', name: 'Header', parentId: 'sec', componentId: 'c1', overrides: { logo: { alt: 'x' } } }),
  },
};
const presetTree = {
  rootId: 'croot',
  nodes: {
    croot: node({ id: 'croot', type: 'Stack', children: ['logo'] }),
    logo: node({ id: 'logo', type: 'Image', name: 'Logo', parentId: 'croot', alt: 'Logo' }),
  },
};

beforeEach(() => {
  db.page.findUnique.mockReset().mockResolvedValue({
    id: 'p1',
    slug: 'trang-chu',
    title: 'Trang chủ',
    draftVersion: { id: 'v9', seq: 7, doc: pageDoc },
  });
  db.preset.findUnique.mockReset().mockResolvedValue({
    id: 'c1',
    key: 'header',
    name: 'Header',
    builtin: false,
    tree: presetTree,
  });
});

describe('open_builder_link', () => {
  it('là tool ĐỌC và tên không đụng luật cấm', () => {
    expect(tool.readOnly).toBe(true);
    expect(tool.name).not.toMatch(/publish|rollback|release|delete/i);
  });

  it('page-node: node, tổ tiên, con, và howToEdit trỏ apply_ops', async () => {
    const r = await run('[Quilder] Trang chủ › Hero — https://a.test/builder/p1?node=sec');
    expect(r.kind).toBe('page-node');
    expect(r.page).toMatchObject({ id: 'p1', slug: 'trang-chu', draftSeq: 7, draftVersionId: 'v9' });
    expect(r.target.id).toBe('sec');
    expect(r.target.node.name).toBe('Hero');
    expect(r.target.ancestors).toEqual([{ id: 'root', type: 'Stack', label: 'Stack' }]);
    expect(r.target.children.map((c: { id: string }) => c.id)).toEqual(['txt', 'inst']);
    expect(r.howToEdit.tool).toBe('apply_ops');
    expect(r.howToEdit.args).toEqual({ pageId: 'p1', nodeId: 'sec', baseSeq: 7 });
    expect(r.warning).toBeUndefined();
  });

  it('chọn nguyên Instance: nhắc setOverride và componentId', async () => {
    const r = await run('https://a.test/builder/p1?node=inst');
    expect(r.howToEdit.notes.join(' ')).toMatch(/setOverride/);
    expect(r.howToEdit.notes.join(' ')).toMatch(/c1/);
  });

  it('instance-child: hai đường sửa với phạm vi khác nhau', async () => {
    const r = await run('https://a.test/builder/p1?node=inst&cn=logo');
    expect(r.kind).toBe('instance-child');
    expect(r.component).toMatchObject({ id: 'c1', name: 'Header' });
    expect(r.target.id).toBe('logo');
    expect(r.target.currentOverride).toEqual({ alt: 'x' });
    expect(r.howToEdit.contentOnThisPageOnly).toMatchObject({
      tool: 'apply_ops',
      op: 'setOverride',
      args: { pageId: 'p1', nodeId: 'inst', localId: 'logo' },
    });
    expect(r.howToEdit.structureOrStyleForAllPages).toMatchObject({
      tool: 'apply_component_ops',
      args: { componentId: 'c1', nodeId: 'logo' },
    });
    expect(r.howToEdit.structureOrStyleForAllPages.scope).toMatch(/MỌI TRANG/);
  });

  it('component-node: apply_component_ops, không cần trang', async () => {
    db.page.findUnique.mockResolvedValue(null);
    const r = await run('https://a.test/builder/p1?component=c1&node=logo');
    expect(r.kind).toBe('component-node');
    expect(r.howToEdit.tool).toBe('apply_component_ops');
    expect(r.howToEdit.args).toEqual({ componentId: 'c1', nodeId: 'logo' });
    expect(r.howToEdit.scope).toMatch(/MỌI TRANG/);
    expect(db.page.findUnique).not.toHaveBeenCalled();
  });

  it('locale khác mặc định: chữ đi qua set_translation', async () => {
    const r = await run('https://a.test/builder/p1?node=txt&locale=en');
    expect(r.howToEdit.translation).toMatchObject({
      tool: 'set_translation',
      args: { pageId: 'p1', locale: 'en', nodeId: 'txt' },
    });
    const c = await run('https://a.test/builder/p1?node=inst&cn=logo&locale=en');
    expect(c.howToEdit.translation.args.nodeId).toBe('inst/logo');
  });

  it('origin khác builder đang nối: có warning', async () => {
    const r = await run('https://khac.test/builder/p1?node=sec');
    expect(r.warning).toMatch(/khac\.test/);
    expect(r.warning).toMatch(/a\.test/);
  });

  it('lỗi tiếng Việt: link hỏng, trang không có, node không có, cn không có', async () => {
    expect((await run('không có link')).error).toMatch(/Không thấy link builder/);

    db.page.findUnique.mockResolvedValueOnce(null);
    expect((await run('https://a.test/builder/zz?node=sec')).error).toMatch(/Không tìm thấy bản nháp/);

    const noNode = await run('https://a.test/builder/p1?node=ghost');
    expect(noNode.error).toMatch(/không có node ghost/);
    expect(noNode.error).toMatch(/Copy link cho AI/);

    const noCn = await run('https://a.test/builder/p1?node=inst&cn=ghost');
    expect(noCn.error).toMatch(/không có phần tử ghost/);

    const notInstance = await run('https://a.test/builder/p1?node=sec&cn=logo');
    expect(notInstance.error).toMatch(/không phải Instance/);

    db.preset.findUnique.mockResolvedValueOnce(null);
    expect((await run('https://a.test/builder/p1?component=gone&node=x')).error).toMatch(/Không tìm thấy component/);
  });
});
