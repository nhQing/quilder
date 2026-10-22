import { describe, expect, it } from 'vitest';

import { issuesOf, scanQuality } from './quality';
import { CURRENT_SCHEMA_VERSION, type Doc, type Node } from '@/lib/doc/types';

const base = { parentId: null, children: [] as string[], effects: [], style: { base: {} } };
const n = (o: Record<string, unknown>) => ({ ...base, ...o }) as unknown as Node;

const img = (o: Record<string, unknown> = {}) =>
  n({ id: 'i1', type: 'Image', assetId: 'a1', alt: 'Một con mèo', fit: 'cover', ...o });

const btn = (o: Record<string, unknown> = {}) =>
  n({
    id: 'b1', type: 'Button', variant: 'primary',
    label: [{ t: 'text', v: 'Xem thêm' }],
    action: { kind: 'link', href: '/tin-tuc' },
    ...o,
  });

const txt = (o: Record<string, unknown> = {}) =>
  n({ id: 't1', type: 'Text', tag: 'p', content: [{ t: 'text', v: 'Xin chào' }], ...o });

describe('ảnh', () => {
  it('ảnh có alt thì không cảnh báo', () => {
    expect(issuesOf(img())).toEqual([]);
  });

  it('ảnh có asset mà alt rỗng thì cảnh báo', () => {
    expect(issuesOf(img({ alt: '' }))).toEqual(['image-alt']);
    expect(issuesOf(img({ alt: '   ' }))).toEqual(['image-alt']);
  });

  it('`decorative: true` KHÔNG cảnh báo — đó là một lời khai đúng', () => {
    /*
     * "Ảnh này không mang thông tin, trình đọc màn hình nên bỏ qua" là một lựa chọn
     * hợp lệ. Cảnh báo nó là biến lựa chọn đúng thành tiếng ồn, và tiếng ồn thì người
     * ta học cách phớt lờ CẢ danh sách.
     */
    expect(issuesOf(img({ alt: '', decorative: true }))).toEqual([]);
  });

  it('ảnh CHƯA CHỌN asset thì không cảnh báo alt', () => {
    // Nó đã hiện rõ là một ô trống trên canvas; "thiếu alt" không phải điều cần nói
    // về nó, và nói thì danh sách có hai dòng cho một việc.
    expect(issuesOf(img({ assetId: null, alt: '' }))).toEqual([]);
  });
});

describe('nút', () => {
  it('nút đủ chữ và đủ địa chỉ thì không cảnh báo', () => {
    expect(issuesOf(btn())).toEqual([]);
  });

  it('nút không có chữ thì cảnh báo', () => {
    expect(issuesOf(btn({ label: [] }))).toEqual(['button-empty']);
    expect(issuesOf(btn({ label: [{ t: 'text', v: '  ' }] }))).toEqual(['button-empty']);
  });

  it('nút link mà href rỗng thì cảnh báo', () => {
    expect(issuesOf(btn({ action: { kind: 'link', href: '' } }))).toEqual(['button-href']);
  });

  it('nút anchor KHÔNG bị đòi href — nó không có href', () => {
    expect(issuesOf(btn({ action: { kind: 'anchor', toNodeId: 'x' } }))).toEqual([]);
  });

  it('một node có thể mang HAI cảnh báo', () => {
    const bad = btn({ label: [], action: { kind: 'link', href: '' } });
    expect(issuesOf(bad)).toEqual(['button-empty', 'button-href']);
  });
});

describe('khối chữ', () => {
  it('có chữ thì không cảnh báo', () => {
    expect(issuesOf(txt())).toEqual([]);
  });

  it('rỗng thì cảnh báo', () => {
    expect(issuesOf(txt({ content: [] }))).toEqual(['text-empty']);
  });
});

describe('scanQuality', () => {
  it('gom cảnh báo của cả doc, kèm tên node và câu nói HẬU QUẢ', () => {
    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rootId: 'root',
      nodes: {
        root: n({ id: 'root', type: 'Section', tag: 'main', children: ['i1', 'b1'] }),
        i1: img({ alt: '', name: 'Ảnh bìa' }),
        b1: btn({ label: [] }),
      },
    } as unknown as Doc;

    const issues = scanQuality(doc);
    expect(issues.map((i) => i.kind)).toEqual(['image-alt', 'button-empty']);

    // Tên node lấy đúng phép gọi tên của cây bên trái — hai chỗ gọi một node bằng hai
    // tên là hai lần người dùng phải tự ánh xạ.
    expect(issues[0]!.label).toBe('Ảnh bìa');

    // Câu phải nói ĐIỀU XẢY RA, không phải tên luật. "Thiếu alt" là tên luật.
    expect(issues[0]!.message).toMatch(/trình đọc màn hình/i);
    expect(issues[0]!.message).not.toMatch(/^thiếu alt$/i);
  });

  it('doc sạch thì trả rỗng', () => {
    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rootId: 'root',
      nodes: { root: n({ id: 'root', type: 'Section', tag: 'main', children: ['i1'] }), i1: img() },
    } as unknown as Doc;
    expect(scanQuality(doc)).toEqual([]);
  });

  it('node type không có luật nào thì đi qua, không ném', () => {
    const doc = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rootId: 'root',
      nodes: { root: n({ id: 'root', type: 'Stack', children: [] }) },
    } as unknown as Doc;
    expect(scanQuality(doc)).toEqual([]);
  });
});
