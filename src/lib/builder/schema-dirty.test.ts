import { describe, expect, it } from 'vitest';

import { leaveNeedsConfirm, schemaKey } from './schema-dirty';

/**
 * Màn Cấu trúc / Nhóm field: rời màn khi còn thay đổi chưa lưu phải hỏi trước (19/11/2026 —
 * bấm quay lại là mất hết field vừa thêm, không một lời báo).
 */
describe('schemaKey — nhận ra thay đổi chưa lưu', () => {
  const saved = { fields: [{ t: 'text', key: 'title', label: 'Tiêu đề' }], titleField: 'title' };

  it('chưa sửa gì thì trùng khoá', () => {
    expect(schemaKey(structuredClone(saved))).toBe(schemaKey(saved));
  });

  it('thêm field, sửa nhãn, đổi field tiêu đề đều là thay đổi', () => {
    expect(schemaKey({ ...saved, fields: [...saved.fields, { t: 'image', key: 'cover', label: 'Ảnh' }] })).not.toBe(
      schemaKey(saved),
    );
    expect(schemaKey({ ...saved, fields: [{ ...saved.fields[0]!, label: 'Tên' }] })).not.toBe(schemaKey(saved));
    expect(schemaKey({ ...saved, titleField: '' })).not.toBe(schemaKey(saved));
  });

  it('sửa rồi sửa lại như cũ thì không còn là thay đổi, kể cả khi thứ tự khoá trong object khác', () => {
    expect(schemaKey({ fields: [{ label: 'Tiêu đề', key: 'title', t: 'text' }], titleField: 'title' })).toBe(
      schemaKey(saved),
    );
  });
});

describe('leaveNeedsConfirm — khi nào chặn cú bấm rời màn', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it('có thay đổi chưa lưu + bấm thường: hỏi trước', () => {
    expect(leaveNeedsConfirm(true, click)).toBe(true);
  });

  it('không có thay đổi: đi luôn', () => {
    expect(leaveNeedsConfirm(false, click)).toBe(false);
  });

  it('mở tab mới (Ctrl/Cmd/Shift/chuột giữa) không rời màn này nên không hỏi', () => {
    expect(leaveNeedsConfirm(true, { ...click, ctrlKey: true })).toBe(false);
    expect(leaveNeedsConfirm(true, { ...click, metaKey: true })).toBe(false);
    expect(leaveNeedsConfirm(true, { ...click, shiftKey: true })).toBe(false);
    expect(leaveNeedsConfirm(true, { ...click, button: 1 })).toBe(false);
  });
});
