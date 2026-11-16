/** Gói rỗng: không có bộ nhận form nào. Gói thật export `Record<string, FormHandler>` ở projects/<tên>/forms.ts. */
import type { FormHandler } from '@/lib/project/forms';

const forms: Record<string, FormHandler> = {};
export default forms;
