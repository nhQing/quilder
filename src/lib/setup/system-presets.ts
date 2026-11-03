/**
 * Component HỆ THỐNG — mẫu mà builder tự gieo, người dùng chỉ NHÂN BẢN rồi sửa bản sao.
 *
 * ## Vì sao khoá cứng thay vì để sửa tự do
 *
 * Mẫu là điểm xuất phát cho mọi form mới. Nếu sửa được thì sau vài tháng mỗi site có
 * một "mẫu" khác nhau mà không ai nhớ đã đổi gì, và mẫu gốc không còn là thứ để so.
 * Đường duy nhất là nhân bản (`POST /api/presets {from}`) — bản sao có `system: null`.
 *
 * ## Vì sao không có Instance
 *
 * Instance chỉ ghi đè được chữ/ảnh, không sửa được tham số Form (trường, nơi nhận) hay
 * style từng phần. Chèn Instance của mẫu vào trang tạo ra một form không chỉnh được, nên
 * `apply-to-page` từ chối Instance MỚI trỏ tới preset `system`.
 *
 * Mẫu phải TRUNG TÍNH: không URL, không chữ riêng của dự án nào. Gieo bằng
 * `ensureSiteDefaults` — mỗi khoá `system` đúng một lần, không ghi đè bản đã có.
 */

import { CURRENT_SCHEMA_VERSION, type Node } from '@/lib/doc/types';
import type { PresetTree } from '@/lib/doc/preset';

export const SYSTEM_PRESET_REFUSAL = 'Mẫu hệ thống — nhân bản rồi sửa bản sao.';
export const SYSTEM_PRESET_INSTANCE_REFUSAL =
  'Mẫu hệ thống chỉ chèn dạng bản sao — Instance của nó không sửa được form.';

export interface SystemPresetSeed {
  system: 'form';
  key: 'mau-form';
  name: 'Form';
  category: 'form';
  aiDescription: string;
  tree: PresetTree;
}

const base = { children: [] as string[], effects: [], style: { base: {} } };

function formTree(): PresetTree {
  const nodes = {
    f1: {
      ...base,
      id: 'f1',
      parentId: null,
      // Node slot là CON THẬT của form: `slots` chỉ định tuyến. Thiếu dòng này thì cây hỏng
      // bất biến cấu trúc và mọi op trên bản sao của mẫu bị 422 (not-in-parent).
      children: ['f2', 'f3'],
      type: 'Composite',
      composite: 'Form',
      name: 'Form',
      params: {
        // Rỗng = chưa có nơi nhận: người dùng chọn/tạo ở thanh bên sau khi nhân bản.
        endpointKey: '',
        fields: [
          { name: 'email', kind: 'email', label: 'Email', required: true, autocomplete: 'email' },
        ],
        submitLabel: 'Gửi',
        successMessage: 'Đã nhận. Cảm ơn bạn.',
        errorMessage: 'Chưa gửi được. Bạn thử lại giúp.',
        afterSubmit: 'inline',
      },
      slots: { heading: ['f2', 'f3'] },
    },
    f2: {
      ...base, id: 'f2', parentId: 'f1', type: 'Text', tag: 'h3', name: 'Tiêu đề',
      content: [{ t: 'text', v: 'Tiêu đề form' }],
    },
    f3: {
      ...base, id: 'f3', parentId: 'f1', type: 'Text', tag: 'p', name: 'Mô tả',
      content: [{ t: 'text', v: 'Mô tả ngắn cho form.' }],
    },
  } as unknown as Record<string, Node>;
  return { schemaVersion: CURRENT_SCHEMA_VERSION, rootId: 'f1', nodes };
}

export const SYSTEM_PRESETS: SystemPresetSeed[] = [
  {
    system: 'form',
    key: 'mau-form',
    name: 'Form',
    category: 'form',
    aiDescription:
      'Mẫu form hệ thống: một ô email, nút gửi, thông báo sau khi gửi. Không sửa trực tiếp — '
      + 'nhân bản rồi chỉnh trường, nơi nhận và giao diện trên bản sao.',
    tree: formTree(),
  },
];
