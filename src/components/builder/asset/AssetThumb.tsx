'use client';

/**
 * Ô xem trước một file trong kho — dùng ở MỌI chỗ hiện một asset nhỏ.
 *
 * Ảnh thì vẽ ảnh; còn lại vẽ "tờ giấy" của design system: tô `kind-*` theo đuôi file,
 * in nhãn đuôi. Luật phân hạng nằm ở `lib/assets/kind.ts`, không nằm ở đây: hai bản
 * của cùng một luật sẽ trôi khỏi nhau, và bản thứ hai là bản không ai nhớ sửa.
 *
 * Vì sao là component riêng chứ không copy vài dòng: có BỐN chỗ hiện một asset nhỏ
 * (lưới Thư viện, ô ảnh trong form entry, bộ chọn của inspector, dialog favicon), và
 * trước đó mỗi chỗ tự quyết định "không phải ảnh thì hiện gì" theo một cách khác —
 * một chỗ hiện `a.mime` trần, một chỗ hiện `?×?`, một chỗ vẽ `<img>` vào file PDF.
 */

import { useEffect, useRef, useState } from 'react';

import { assetKind, extOf } from '@/lib/assets/kind';
import { cn } from '@/lib/builder/cn';

import { Skeleton } from '../ui/Skeleton';
import { extLabel, kindBg } from './types';

/** Tờ giấy gấp góc, tô theo đuôi file. Không có đuôi thì không in nhãn. */
export function FileSheet({ ext, size = 'md', className }: { ext: string; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid shrink-0 items-end justify-items-center [clip-path:polygon(0_0,70%_0,100%_22%,100%_100%,0_100%)]',
        size === 'md' ? 'h-16 w-13 rounded-[7px] pb-2.5' : 'h-11 w-9 rounded-[5px] pb-1.5',
        kindBg(ext),
        className,
      )}
    >
      <span className="absolute top-0 right-0 h-[22%] w-[30%] rounded-bl-[5px] bg-kind-label/45" />
      {ext && (
        <b className={cn('font-bold tracking-[0.04em] text-kind-label', size === 'md' ? 'text-micro' : 'text-[0.5625rem]')}>
          {extLabel(ext)}
        </b>
      )}
    </span>
  );
}

export function AssetThumb({
  mime,
  assetKey,
  url,
  className,
  lazy,
  sheet = 'md',
}: {
  mime: string;
  /** `Asset.key`, dùng để lấy đuôi file khi mime không nói đủ. */
  assetKey: string;
  url: string;
  className?: string;
  /** Lưới dài: chỉ tải ảnh khi cuộn tới. */
  lazy?: boolean;
  /** Cỡ tờ giấy cho file không phải ảnh. */
  sheet?: 'sm' | 'md';
}) {
  const info = assetKind(mime, assetKey);
  const ext = extOf(assetKey);

  if (info.previewable) {
    return <ImageThumb url={url} lazy={lazy} className={className} />;
  }

  return (
    <span className={cn('flex items-center justify-center', className)} title={info.label}>
      <FileSheet ext={ext} size={sheet} />
    </span>
  );
}

/**
 * Ảnh trong một khung có shimmer cho tới khi ảnh vẽ xong, rồi ảnh hiện dần lên.
 *
 * `className` áp lên KHUNG, không lên `<img>`: bên gọi đặt chỗ đứng và kích thước
 * (`size-full`, `absolute inset-0`), còn ảnh vừa khung theo `fit`.
 *
 * `fit` mặc định `contain` — chốt 13/10/2026, thay cho `cover` cố định trước đó:
 * xem trước là để biết mình chọn ĐÚNG file, và ảnh bị cắt mép (logo mất nửa, ảnh
 * chia sẻ mất chữ) không trả lời được câu đó. `cover` chỉ còn cho chỗ cố ý mô
 * phỏng cách nền tảng khác cắt ảnh — thẻ chia sẻ link ở `PageSeoPanel`.
 *
 * Lớp shimmer bị gỡ khi ảnh tải xong HOẶC lỗi — một khung chạy shimmer mãi vì ảnh
 * hỏng là nói dối "sắp có". PNG trong suốt cũng nhờ thế mà không lộ dải sáng phía sau.
 */
export function ImageThumb({
  url,
  lazy,
  alt = '',
  fit = 'contain',
  className,
}: {
  url: string;
  lazy?: boolean;
  /** Mặc định rỗng: ở hầu hết chỗ tên file đã nằm ngay cạnh khung. */
  alt?: string;
  /** Xem docblock: `contain` ở mọi chỗ xem trước, `cover` chỉ khi mô phỏng một khung cắt. */
  fit?: 'contain' | 'cover';
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  // Đổi file thì chờ lại từ đầu — TRỪ khi ảnh đã xong sẵn. Ảnh nằm trong cache có thể
  // xong trước khi React gắn `onLoad` (ô vừa mount lại, hoặc HTML từ server): khi đó
  // không còn sự kiện nào bắn nữa và khung sẽ kẹt shimmer mãi.
  useEffect(() => {
    setDone(Boolean(img.current?.complete));
  }, [url]);

  return (
    <span className={cn('relative block overflow-hidden', className)}>
      {!done && <Skeleton className="absolute inset-0 rounded-none" />}
      {/* Thẻ img thuần, không `next/image`: đây là vỏ builder, không phải ảnh của site
          — không cần srcset, và `next/image` chỉ thêm một vòng qua server cho mỗi ô.
          `draggable={false}`: kéo trên thẻ Thư viện là kéo CẢ THẺ (dời ảnh), không
          phải kéo riêng tấm ảnh ra khỏi trang. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src={url}
        alt={alt}
        draggable={false}
        loading={lazy ? 'lazy' : undefined}
        onLoad={() => setDone(true)}
        onError={() => setDone(true)}
        className={cn(
          'relative size-full transition-opacity duration-300',
          fit === 'cover' ? 'object-cover' : 'object-contain',
          done ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  );
}
