import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectSaving, useEditor, type HistoryEffect } from './store';

/**
 * Việc NGOÀI doc đi kèm một mục lịch sử (vd dời bản dịch theo ô của Form): chạy chiều xuôi
 * khi lưu và khi làm lại, chiều ngược khi hoàn tác. Không có nó, Ctrl+Z trả params về mà
 * bản dịch nằm lại trên ô khác.
 */

const DOC = { schemaVersion: 1, root: 'r', nodes: { r: { id: 'r', type: 'Section' } } };

let seq = 41;
function serverOk() {
  vi.stubGlobal('fetch', () => {
    seq += 1;
    // Mỗi lần trả một mảng undo MỚI — giống server thật (nghịch đảo tính lại mỗi lần).
    const body = { ok: true, doc: DOC, undo: [{ op: 'setText', nodeId: 'r', value: `u${seq}` }], seq };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  });
}

function recorder() {
  const calls: string[] = [];
  const savingDuring: boolean[] = [];
  const effect: HistoryEffect = {
    forward: async () => {
      savingDuring.push(selectSaving(useEditor.getState()));
      calls.push('forward');
    },
    backward: async () => {
      savingDuring.push(selectSaving(useEditor.getState()));
      calls.push('backward');
    },
  };
  return { calls, savingDuring, effect };
}

const op = [{ op: 'setText', nodeId: 'r', value: 'x' }] as never;

describe('store — việc kèm theo một mục lịch sử', () => {
  beforeEach(() => {
    seq = 41;
    useEditor.getState().init({ kind: 'page', id: 'p1' }, DOC as never, 41);
  });

  it('lưu chạy forward, hoàn tác chạy backward, làm lại chạy forward — mỗi lần đúng một lần', async () => {
    serverOk();
    const { calls, effect } = recorder();
    expect(await useEditor.getState().dispatch(op, { label: 'kéo ô', effect })).toBe(true);
    expect(calls).toEqual(['forward']);

    await useEditor.getState().undo();
    expect(calls).toEqual(['forward', 'backward']);

    await useEditor.getState().redo();
    expect(calls).toEqual(['forward', 'backward', 'forward']);

    await useEditor.getState().undo();
    expect(calls).toEqual(['forward', 'backward', 'forward', 'backward']);
  });

  it('trong lúc việc kèm chạy, store vẫn ở "đang lưu" — không bấm Hoàn tác chen vào được', async () => {
    serverOk();
    const { savingDuring, effect } = recorder();
    await useEditor.getState().dispatch(op, { effect });
    await useEditor.getState().undo();
    expect(savingDuring).toEqual([true, true]);
    expect(useEditor.getState().save.k).toBe('clean');
  });

  it('lưu trượt thì KHÔNG chạy forward', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 422, json: () => Promise.resolve({ error: 'x' }) } as Response),
    );
    const { calls, effect } = recorder();
    await useEditor.getState().dispatch(op, { effect });
    expect(calls).toEqual([]);
  });

  it('mục không có việc kèm (đặt sau) không chạy việc của mục khác', async () => {
    serverOk();
    const { calls, effect } = recorder();
    await useEditor.getState().dispatch(op, { effect });
    await useEditor.getState().dispatch(op);
    await useEditor.getState().undo();
    expect(calls).toEqual(['forward']);
    await useEditor.getState().undo();
    expect(calls).toEqual(['forward', 'backward']);
  });

  it('việc kèm ném lỗi thì store vẫn về clean, không kẹt "đang lưu"', async () => {
    serverOk();
    const effect: HistoryEffect = {
      forward: () => Promise.reject(new Error('mạng')),
      backward: () => Promise.reject(new Error('mạng')),
    };
    await useEditor.getState().dispatch(op, { effect });
    expect(useEditor.getState().save.k).toBe('clean');
    await useEditor.getState().undo();
    expect(useEditor.getState().save.k).toBe('clean');
  });
});
