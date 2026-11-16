/**
 * `sizes` mặc định cho ảnh raster của node Image khi tác giả chưa đặt `node.sizes`.
 *
 * ## Vì sao cần (16/11/2026)
 *
 * `next/image` có `width`/`height` mà KHÔNG có `sizes` thì phát srcset theo mật độ điểm
 * ảnh (`1x`, `2x`) tính từ `width` — mà `width` ở đây là số đo GỐC của file trong kho.
 * Ảnh điện thoại ở hero /maigreen rộng 2811px nên cả `1x` lẫn `2x` đều thành `w=3840`:
 * trình duyệt tải bản 3840px để vẽ vào khung 937px. Mọi ảnh chưa có `sizes` đều thế.
 *
 * Mặc định ở đây là "rộng tối đa bằng khung nhìn, nhưng không quá cỡ gốc": trình duyệt
 * chọn trong dải deviceSizes theo bề rộng màn × DPR (1920 ở màn 1920), và ảnh nhỏ (avatar
 * 426px) không bị kéo lên cỡ màn hình. Vẫn dư so với khung thật — node nào biết chính xác
 * bề rộng hiển thị thì đặt `sizes` riêng (setProps), nó luôn thắng mặc định.
 */

export function defaultImageSizes(nodeSizes: string | undefined, width: number | null | undefined): string {
  if (nodeSizes?.trim()) return nodeSizes;
  if (!width || width <= 0) return '100vw';
  const w = Math.round(width);
  return `(max-width: ${w}px) 100vw, ${w}px`;
}
