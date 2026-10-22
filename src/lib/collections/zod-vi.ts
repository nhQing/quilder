/**
 * Zod issue → câu tiếng Việt.
 *
 * ## Vì sao một chỗ, không phải `message` trên từng validator
 *
 * Thông báo của zod đi thẳng ra người dùng qua `validateCollectionSchema` và
 * `validateEntryData`. Rắc `message` lên từng `.min()`/`.max()` là hai chục chỗ
 * phải nhớ, và chỗ bị quên sẽ là chỗ người dùng gặp — im lặng, vì một câu tiếng
 * Anh vẫn là một câu, không phải một lỗi.
 *
 * ## Vì sao KHÔNG dùng `z.setErrorMap`
 *
 * Nó là toàn cục: đổi luôn thông báo của `doc/schema.ts`, vốn đang phục vụ
 * validator op và tool AI với thông báo đã được viết riêng. Một thay đổi rộng như
 * vậy để chữa một chỗ hẹp là đổi lấy rủi ro không cần thiết.
 *
 * Thuần, không `server-only`: form admin (client) cũng đọc lỗi qua đường này.
 */

import type { z } from 'zod';

/** Nhãn tiếng Việt cho kiểu dữ liệu, để câu đọc được thay vì nói "string". */
const KIND: Record<string, string> = {
  string: 'chữ',
  number: 'số',
  boolean: 'giá trị đúng/sai',
  array: 'danh sách',
  object: 'đối tượng',
  integer: 'số nguyên',
  float: 'số thập phân',
};

export function viMessage(issue: z.ZodIssue | undefined): string {
  if (!issue) return 'Dữ liệu không hợp lệ';

  switch (issue.code) {
    // Thông báo của CHÍNH TA (`.regex(…, 'Khoá field chỉ gồm…')`, `.refine`) đã là
    // tiếng Việt — trả nguyên, đừng dịch lại.
    case 'custom':
      return issue.message;

    case 'invalid_type':
      return issue.received === 'undefined'
        ? 'Thiếu giá trị bắt buộc'
        : `Phải là ${KIND[issue.expected] ?? issue.expected}, không phải ${KIND[issue.received] ?? issue.received}`;

    case 'too_small': {
      const n = issue.minimum;
      if (issue.type === 'string') return n === 1 ? 'Không được để trống' : `Phải dài ít nhất ${n} ký tự`;
      if (issue.type === 'array') return n === 1 ? 'Phải có ít nhất một mục' : `Phải có ít nhất ${n} mục`;
      return `Phải lớn hơn hoặc bằng ${n}`;
    }

    case 'too_big': {
      const n = issue.maximum;
      if (issue.type === 'string') return `Dài quá ${n} ký tự`;
      if (issue.type === 'array') return `Nhiều quá ${n} mục`;
      return `Phải nhỏ hơn hoặc bằng ${n}`;
    }

    case 'invalid_enum_value':
      return `Giá trị không nằm trong danh sách cho phép: ${issue.options.join(', ')}`;

    case 'invalid_union_discriminator':
      return `Kiểu không hợp lệ. Kiểu cho phép: ${issue.options.join(', ')}`;

    case 'unrecognized_keys':
      // Đây là `.strict()` bắt được một khoá gõ sai — nói ra TÊN khoá, vì đó là
      // thông tin duy nhất giúp người sửa tìm ra chỗ sai.
      return `Khoá không hợp lệ: ${issue.keys.join(', ')}`;

    case 'invalid_string':
      // Nếu là thông báo tùy chỉnh (ví dụ từ regex validator), hãy trả về nó.
      // Regex validators trong zod có thể trả về invalid_string code nhưng với custom message.
      if (issue.message && !issue.message.startsWith('Invalid')) {
        return issue.message;
      }
      return 'Chuỗi không đúng định dạng';

    default:
      // Không dịch được thì trả nguyên văn của zod, KHÔNG trả một câu chung chung:
      // một câu tiếng Anh cụ thể còn dùng được, còn "Dữ liệu không hợp lệ" thì không.
      return issue.message;
  }
}

/** Đường dẫn tới field bị lỗi, dạng đọc được. Rỗng thì trả 'dữ liệu'. */
export function viPath(issue: z.ZodIssue | undefined): string {
  const path = issue?.path ?? [];
  return path.length ? path.join('.') : 'dữ liệu';
}
