/**
 * Bản này có được phép lên Google không.
 *
 * ## Vì sao cần một công tắc, không phải suy ra
 *
 * Suy từ `SITE_URL` (kiểu "có chữ stg thì là staging") là loại thông minh sai
 * chỗ: một ngày nào đó domain thật chứa chữ đó, hoặc staging đổi tên, và site
 * thật lặng lẽ biến mất khỏi Google. Một biến khai tường minh thì đọc là biết.
 *
 * ## Vì sao mặc định là CHO PHÉP index
 *
 * Mặc định phải là hành vi của site thật. Nếu mặc định là noindex thì một lần
 * quên biến trên production là mất toàn bộ thứ hạng tìm kiếm — và nó hỏng im
 * lặng, không ai phát hiện trong nhiều tuần. Quên biến trên staging thì hậu quả
 * nhỏ hơn nhiều và sửa được ngay.
 *
 * ## Vì sao `=== 'true'` chứ không phải `Boolean(...)`
 *
 * Biến môi trường luôn là chuỗi, và `Boolean('false')` là `true`. Đây là cái bẫy
 * cổ điển, và ở đây nó nghĩa là gõ `SITE_NOINDEX=false` sẽ BẬT noindex.
 */
export function isNoindexSite(): boolean {
  return process.env.SITE_NOINDEX?.trim().toLowerCase() === 'true';
}
