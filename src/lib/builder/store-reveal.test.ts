import { beforeEach, describe, expect, it } from 'vitest';

import { useEditor } from './store';

/**
 * Yêu cầu cuộn tới node (`reveal`) — hợp đồng giữa bên chọn và `Canvas`.
 *
 * `Canvas` xử lý một yêu cầu khi `seq` của nó KHÁC `seq` lần trước đã xử lý. Nên hai
 * tính chất dưới đây là thứ chịu lực: mỗi lần xin là một `seq` mới (kể cả cùng node),
 * và `seq` không bao giờ quay lại một số đã dùng. Hỏng cái thứ hai thì lần bấm thứ
 * hai sau một cú bấm trong canvas bị bỏ qua im lặng.
 */
describe('store — select(id, { reveal })', () => {
  beforeEach(() => {
    useEditor.getState().reset();
  });

  it('chọn KHÔNG cờ (bấm trong canvas) thì không xin cuộn', () => {
    useEditor.getState().select('n1');
    expect(useEditor.getState().selectedId).toBe('n1');
    expect(useEditor.getState().reveal).toBeNull();
  });

  it('chọn có cờ thì vừa chọn vừa xin cuộn tới đúng node đó', () => {
    useEditor.getState().select('n2', { reveal: true });
    const { selectedId, reveal } = useEditor.getState();
    expect(selectedId).toBe('n2');
    expect(reveal?.id).toBe('n2');
  });

  it('xin lại ĐÚNG node đang chọn vẫn là một yêu cầu mới — đó là cách quay về sau khi đã cuộn đi', () => {
    useEditor.getState().select('n3', { reveal: true });
    const first = useEditor.getState().reveal!.seq;
    useEditor.getState().select('n3', { reveal: true });
    expect(useEditor.getState().reveal!.seq).toBeGreaterThan(first);
  });

  it('chọn không cờ huỷ yêu cầu còn treo — chọn mới thắng', () => {
    useEditor.getState().select('n4', { reveal: true });
    useEditor.getState().select('n5');
    expect(useEditor.getState().reveal).toBeNull();
  });

  it('seq KHÔNG đếm lại sau khi yêu cầu bị huỷ', () => {
    useEditor.getState().select('n6', { reveal: true });
    const before = useEditor.getState().reveal!.seq;
    useEditor.getState().select('n7');
    useEditor.getState().reset();
    useEditor.getState().select('n6', { reveal: true });
    expect(useEditor.getState().reveal!.seq).toBeGreaterThan(before);
  });

  it('bỏ chọn (null) thì không có gì để cuộn tới, kể cả khi có cờ', () => {
    useEditor.getState().select(null, { reveal: true });
    expect(useEditor.getState().selectedId).toBeNull();
    expect(useEditor.getState().reveal).toBeNull();
  });

  it('reset (rời editor) xoá yêu cầu — Canvas mount lại không được kéo tới node của lần trước', () => {
    useEditor.getState().select('n8', { reveal: true });
    useEditor.getState().reset();
    expect(useEditor.getState().reveal).toBeNull();
  });
});
