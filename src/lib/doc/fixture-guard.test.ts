import { describe, expect, it } from 'vitest';

import { fixtureRejection } from './fixture-guard';

/**
 * Luật này tồn tại vì nó đã bị vi phạm hai lần — HANDOFF §3.35, rồi lại
 * 21/08/2026 khi 47 node nội dung "Về chúng tôi" được dựng lên `/gioi-thieu` và
 * làm đỏ 3 spec. Nên nó đáng có test hơn hầu hết luật khác trong repo.
 */

describe('fixtureRejection', () => {
  it('chặn AI ghi vào trang đồ gá', () => {
    const r = fixtureRejection({ slug: 'gioi-thieu', fixture: true }, 'ai');
    expect(r?.status).toBe(403);
    // Thông điệp phải nêu ĐƯỜNG DẪN: Agent thường giữ nhiều pageId trong đầu, và
    // một lỗi không nói trang nào thì nó sẽ thử lại trang khác một cách mù.
    expect(r?.error).toContain('/gioi-thieu');
    // …và phải nói việc CẦN LÀM, không chỉ việc bị cấm.
    expect(r?.error).toMatch(/trang khác|hỏi người dùng/);
  });

  it('cho người ghi vào trang đồ gá', () => {
    // Dọn lại đồ gá là việc bình thường của người: `pnpm seed:second`.
    expect(fixtureRejection({ slug: 'gioi-thieu', fixture: true }, 'human')).toBeNull();
  });

  it('cho AI ghi vào trang thường', () => {
    expect(fixtureRejection({ slug: 'tin-tuc', fixture: false }, 'ai')).toBeNull();
  });

  it('trang thường thì actor nào cũng qua', () => {
    expect(fixtureRejection({ slug: '', fixture: false }, 'human')).toBeNull();
    expect(fixtureRejection({ slug: 've-chung-toi', fixture: false }, 'ai')).toBeNull();
  });
});
