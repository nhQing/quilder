import { afterEach, describe, expect, it } from 'vitest';

import {
  holdSkeleton,
  isNavigating,
  linkTarget,
  pendingTarget,
  settleNavigation,
  startNavigation,
  subscribeNavigation,
  type LinkClick,
} from './nav-pending';

/**
 * Kho "đang chuyển trang" của vỏ builder.
 *
 * Tính chất chịu lực:
 *  1. Chỉ cú bấm mà ROUTER sẽ xử lý mới bật thanh. Bật cho Ctrl+click (tab mới) hay link tải
 *     file là một thanh không bao giờ tắt — trang này không rời đi đâu cả.
 *  2. Khung đang tải giữ thanh độc lập với cú bấm: URL đã đổi (tắt `target`) mà trang thật
 *     chưa tới thì thanh vẫn phải chạy.
 *  3. Nhả hai lần không làm bộ đếm âm (Strict Mode chạy effect hai lượt).
 */

const HERE = 'http://localhost:3000/builder/text?page=a';

const click = (href: string, over: Partial<LinkClick> = {}): LinkClick => ({
  button: 0,
  modified: false,
  href,
  target: null,
  download: false,
  ...over,
});

afterEach(() => settleNavigation());

describe('linkTarget', () => {
  it('link nội bộ builder → pathname + search, bỏ #hash', () => {
    expect(linkTarget(click('http://localhost:3000/builder/assets?folder=a#x'), HERE)).toBe(
      '/builder/assets?folder=a',
    );
    expect(linkTarget(click('/builder'), HERE)).toBe('/builder');
  });

  it('trả về cả khi trùng chỗ đang đứng — bên gọi tự quyết', () => {
    expect(linkTarget(click(HERE), HERE)).toBe('/builder/text?page=a');
  });

  it('bỏ qua mọi thứ trình duyệt tự lo', () => {
    expect(linkTarget(click('/builder/assets', { modified: true }), HERE)).toBeNull();
    expect(linkTarget(click('/builder/assets', { button: 1 }), HERE)).toBeNull();
    expect(linkTarget(click('/builder/assets', { target: '_blank' }), HERE)).toBeNull();
    expect(linkTarget(click('/builder/assets', { download: true }), HERE)).toBeNull();
  });

  it('`target="_self"` vẫn là cùng tab', () => {
    expect(linkTarget(click('/builder/assets', { target: '_self' }), HERE)).toBe('/builder/assets');
  });

  it('ngoài /builder và khác origin → null', () => {
    expect(linkTarget(click('https://example.com/builder'), HERE)).toBeNull();
    expect(linkTarget(click('/preview/abc'), HERE)).toBeNull();
    expect(linkTarget(click('/api/tokens/client'), HERE)).toBeNull();
    // Tiền tố theo ĐOẠN: `/builderX` không phải builder.
    expect(linkTarget(click('/builderX'), HERE)).toBeNull();
  });
});

describe('kho trạng thái', () => {
  it('bấm → đang chuyển; URL đổi → hết', () => {
    expect(isNavigating()).toBe(false);
    startNavigation('/builder/assets');
    expect(isNavigating()).toBe(true);
    expect(pendingTarget()).toBe('/builder/assets');
    settleNavigation();
    expect(isNavigating()).toBe(false);
    expect(pendingTarget()).toBeNull();
  });

  it('khung đang tải giữ thanh sau khi URL đã đổi', () => {
    startNavigation('/builder/assets');
    const release = holdSkeleton();
    settleNavigation();
    expect(isNavigating()).toBe(true);
    release();
    expect(isNavigating()).toBe(false);
  });

  it('nhả hai lần chỉ tính một', () => {
    const a = holdSkeleton();
    const b = holdSkeleton();
    a();
    a();
    expect(isNavigating()).toBe(true);
    b();
    expect(isNavigating()).toBe(false);
  });

  it('báo cho người nghe mỗi lần đổi, không báo khi không đổi gì', () => {
    let calls = 0;
    const off = subscribeNavigation(() => {
      calls += 1;
    });
    startNavigation('/builder/text');
    startNavigation('/builder/text');
    settleNavigation();
    settleNavigation();
    off();
    startNavigation('/builder/assets');
    expect(calls).toBe(2);
  });
});
