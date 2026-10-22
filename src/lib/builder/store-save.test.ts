import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectSaving, useEditor } from './store';

/**
 * Trạng thái lưu của store — ba nhánh, và cái quan trọng nhất là chúng LOẠI TRỪ NHAU.
 *
 * Test đắt giá nhất ở đây là "lưu trượt thì KHÔNG được báo đã lưu". Đó là lỗi đã
 * từng tồn tại ở đường publish (`EditorShell.tsx` ghi lại), và nguyên nhân là hai
 * biến rời cho hai kết cục. Nếu ai đó sau này gộp `save` về lại `saving: boolean`
 * cộng `lastError`, test này là chỗ nó vỡ.
 */

const DOC = { schemaVersion: 1, root: 'r', nodes: { r: { id: 'r', type: 'Section' } } };

function ok(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}
function bad(body: unknown) {
  return Promise.resolve({ ok: false, json: () => Promise.resolve(body) } as Response);
}

describe('store — trạng thái lưu', () => {
  beforeEach(() => {
    useEditor.getState().init({ kind: 'page', id: 'p1' }, DOC as never, 41);
  });

  it('init đặt trạng thái clean kèm seq của server', () => {
    expect(useEditor.getState().save).toEqual({ k: 'clean', seq: 41 });
    expect(selectSaving(useEditor.getState())).toBe(false);
  });

  it('lưu xong thì clean, và seq đi theo response — không phải seq lúc init', async () => {
    vi.stubGlobal('fetch', () => ok({ ok: true, doc: DOC, undo: [], seq: 42 }));
    await useEditor.getState().dispatch([{ op: 'setText', nodeId: 'r', value: 'x' }] as never);
    expect(useEditor.getState().save).toEqual({ k: 'clean', seq: 42 });
  });

  it('lưu TRƯỢT thì trạng thái là error — KHÔNG phải clean, và seq cũ không được hiện như vừa lưu', async () => {
    vi.stubGlobal('fetch', () => bad({ error: 'Không lưu được' }));
    const ops = [{ op: 'setText', nodeId: 'r', value: 'x' }] as never;
    await useEditor.getState().dispatch(ops);

    const { save } = useEditor.getState();
    expect(save.k).toBe('error');
    // Đây là câu chịu lực của cả file: không có nhánh nào vừa lỗi vừa clean.
    expect(save.k === 'clean').toBe(false);
  });

  it('lưu trượt thì GIỮ batch op để thử lại — không có nó nút "thử lại" không gửi được gì', async () => {
    vi.stubGlobal('fetch', () => bad({ error: 'Không lưu được' }));
    const ops = [{ op: 'setText', nodeId: 'r', value: 'x' }] as never;
    await useEditor.getState().dispatch(ops);

    const { save } = useEditor.getState();
    expect(save.k === 'error' && save.retry).toEqual(ops);
  });

  it('thử lại gửi đúng batch cũ, và thành công thì về clean', async () => {
    vi.stubGlobal('fetch', () => bad({ error: 'Không lưu được' }));
    await useEditor.getState().dispatch([{ op: 'setText', nodeId: 'r', value: 'x' }] as never);
    expect(useEditor.getState().save.k).toBe('error');

    vi.stubGlobal('fetch', () => ok({ ok: true, doc: DOC, undo: [], seq: 43 }));
    await useEditor.getState().retrySave();
    expect(useEditor.getState().save).toEqual({ k: 'clean', seq: 43 });
  });

  it('gửi kèm baseSeq = bản nháp đang dựa vào, và cập nhật nó theo response', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return ok({ ok: true, doc: DOC, undo: [], seq: 42 });
    });
    await useEditor.getState().dispatch([{ op: 'setText', nodeId: 'r', value: 'x' }] as never);
    await useEditor.getState().dispatch([{ op: 'setText', nodeId: 'r', value: 'y' }] as never);
    expect(bodies.map((b) => b.baseSeq)).toEqual([41, 42]);
    // `actor` không còn do client quyết — server suy ra từ phiên.
    expect(bodies.every((b) => !('actor' in b))).toBe(true);
  });

  it('409 thì áp lại MỘT lần lên bản mới nhất, và nói ra là đã gộp', async () => {
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: 'Bản nháp đã đổi', conflict: true, currentSeq: 47 }),
        } as Response);
      }
      return ok({ ok: true, doc: DOC, undo: [], seq: 48 });
    });

    await useEditor.getState().dispatch([{ op: 'setText', nodeId: 'r', value: 'x' }] as never);

    expect(bodies.map((b) => b.baseSeq)).toEqual([41, 47]);
    expect(useEditor.getState().save).toEqual({ k: 'clean', seq: 48, rebased: true });
    expect(useEditor.getState().draftSeq).toBe(48);
  });

  it('409 hai lần liền thì là lỗi — không đuổi nhau mãi', async () => {
    let call = 0;
    vi.stubGlobal('fetch', () => {
      call += 1;
      return Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'Bản nháp đã đổi', conflict: true, currentSeq: 50 + call }),
      } as Response);
    });
    await useEditor.getState().dispatch([{ op: 'setText', nodeId: 'r', value: 'x' }] as never);
    expect(call).toBe(2);
    expect(useEditor.getState().save.k).toBe('error');
  });

  it('component mode: response không có seq → clean với seq null, không phải NaN', async () => {
    useEditor.getState().init({ kind: 'component', id: 'c1', name: 'x' }, DOC as never, null);
    vi.stubGlobal('fetch', () => ok({ ok: true, tree: { ...DOC }, undo: [] }));
    await useEditor.getState().dispatch([{ op: 'setText', nodeId: 'r', value: 'x' }] as never);
    expect(useEditor.getState().save).toEqual({ k: 'clean', seq: null });
  });

  it('selectSaving đúng trong lúc đang bay, và trả boolean nên không gây re-render thừa', () => {
    useEditor.setState({ save: { k: 'saving' } });
    expect(selectSaving(useEditor.getState())).toBe(true);
    // Hai lần đọc cùng một trạng thái phải bằng nhau theo tham chiếu — `LayerTree.tsx:74`
    // ghi rằng biến này làm cả 159 hàng re-render, nên nó không được trả object mới.
    expect(selectSaving(useEditor.getState())).toBe(selectSaving(useEditor.getState()));
  });
});
