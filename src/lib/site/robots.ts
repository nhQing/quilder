/**
 * robots.txt: nội dung tự sinh, và luật kiểm nội dung tự soạn.
 *
 * Hàm THUẦN — route `robots.txt` và màn Cài đặt (nút "Về mặc định", kiểm trước khi
 * lưu) dùng chung, nên thứ người dùng thấy trong ô soạn đúng là thứ site đang phát.
 */

/** Trần nội dung tự soạn. Google chỉ đọc 500 KiB đầu; 32 KB đã là quá đủ cho người gõ tay. */
export const MAX_ROBOTS_BYTES = 32 * 1024;

/** Nội dung staging (`SITE_NOINDEX=true`): chặn tất, không khai sitemap. */
export const NOINDEX_ROBOTS_TXT = 'User-Agent: *\nDisallow: /\n';

/**
 * Nội dung tự sinh — ĐÚNG từng byte với thứ `MetadataRoute.Robots` của Next sinh
 * trước ngày 20/10/2026 (fixture trong test). Đổi route sang text mà đổi luôn nội
 * dung là một thay đổi SEO lẫn vào một thay đổi kỹ thuật.
 *
 * Builder và preview cũng đã có header `X-Robots-Tag: noindex` từ middleware. Chặn ở
 * đây là lớp thứ hai: robots.txt ngăn crawl, header ngăn index kể cả khi có ai đó
 * link thẳng vào.
 */
export function defaultRobotsTxt(origin: string): string {
  return [
    'User-Agent: *',
    'Allow: /',
    'Disallow: /builder',
    'Disallow: /builder/',
    'Disallow: /preview/',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

export interface RobotsLint {
  /** Không lưu được. */
  errors: string[];
  /** Lưu được, nhưng người dùng phải xác nhận. */
  warnings: string[];
}

const FIELD_LINE = /^([A-Za-z-]+)\s*:\s*(.*)$/;

/**
 * Kiểm nội dung tự soạn.
 *
 * Lỗi chỉ là thứ chắc chắn sai về hình thức. Mọi thứ còn lại là CẢNH BÁO: robots.txt
 * có nhiều cách dùng hợp lệ mà luật nào đoán trước được, nhưng "chặn cả site" là thứ
 * một lần gõ nhầm có thể làm site biến khỏi Google — nên phải hỏi lại.
 */
export function lintRobotsTxt(text: string, origin: string): RobotsLint {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (new TextEncoder().encode(text).length > MAX_ROBOTS_BYTES) {
    errors.push(`Nội dung dài quá ${MAX_ROBOTS_BYTES / 1024} KB.`);
  }

  // Theo nhóm: các dòng `User-agent` liền nhau mở một nhóm, các luật sau đó thuộc nhóm.
  let agents: string[] = [];
  let inRules = false;
  let blocksAll = false;
  const sitemaps: string[] = [];

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const m = FIELD_LINE.exec(line);
    if (!m) {
      errors.push(`Dòng ${i + 1} không có dạng "Tên: giá trị": ${raw.trim()}`);
      return;
    }
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === 'user-agent') {
      if (inRules) agents = [];
      inRules = false;
      agents.push(value);
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    } else {
      inRules = true;
      if (field === 'disallow' && value === '/' && agents.includes('*')) blocksAll = true;
    }
  });

  if (blocksAll) {
    warnings.push('Có "Disallow: /" cho mọi bot (User-agent: *) — cả site sẽ bị chặn khỏi công cụ tìm kiếm.');
  }
  if (!sitemaps.length) {
    warnings.push('Không có dòng "Sitemap:" — công cụ tìm kiếm sẽ khó tìm sitemap.xml.');
  }
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    // origin hỏng thì bỏ qua phép so host.
  }
  for (const s of sitemaps) {
    let host: string | null = null;
    try {
      host = new URL(s).host;
    } catch {
      warnings.push(`Dòng Sitemap không phải URL đầy đủ: ${s}`);
      continue;
    }
    if (originHost && host !== originHost) {
      warnings.push(`Dòng Sitemap trỏ tới tên miền khác (${host}), không phải ${originHost}.`);
    }
  }

  return { errors, warnings };
}
