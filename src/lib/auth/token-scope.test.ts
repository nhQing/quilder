import { describe, expect, it } from 'vitest';

import { isMachine, mayMintFor, mayTouchToken, tokenOwnerWhere } from './token-scope';

const admin = { sub: 'a1', role: 'admin' };
const editor = { sub: 'e1', role: 'editor' };

describe('tokenOwnerWhere', () => {
  it('admin xem mọi token, trừ khi xin "của tôi"', () => {
    expect(tokenOwnerWhere(admin, false)).toEqual({});
    expect(tokenOwnerWhere(admin, true)).toEqual({ userId: 'a1' });
  });

  it('editor chỉ bao giờ thấy token của mình — kể cả khi không xin', () => {
    expect(tokenOwnerWhere(editor, false)).toEqual({ userId: 'e1' });
    expect(tokenOwnerWhere(editor, true)).toEqual({ userId: 'e1' });
  });
});

describe('mayTouchToken', () => {
  it('chủ token và admin thu hồi được; người khác thì không', () => {
    expect(mayTouchToken(editor, 'e1')).toBe(true);
    expect(mayTouchToken(admin, 'e1')).toBe(true);
    expect(mayTouchToken(editor, 'a1')).toBe(false);
  });
});

describe('mayMintFor', () => {
  it('ai cũng cấp được cho chính mình', () => {
    expect(mayMintFor(editor, undefined)).toBe(true);
    expect(mayMintFor(editor, 'e1')).toBe(true);
  });

  it('chỉ admin cấp được token đứng tên người khác', () => {
    expect(mayMintFor(editor, 'a1')).toBe(false);
    expect(mayMintFor(admin, 'e1')).toBe(true);
  });
});

describe('isMachine', () => {
  it('phiên của token service là máy; phiên trình duyệt thì không', () => {
    expect(isMachine({ ...editor, kind: 'service' })).toBe(true);
    expect(isMachine({ ...editor, kind: 'user' })).toBe(false);
    expect(isMachine(editor)).toBe(false);
  });
});
