'use client';

/**
 * Mục `Ảnh` của pane trái: gắn ảnh vào node đang chọn, không rời màn sửa.
 *
 * ## Vì sao nó gắn vào node ĐANG CHỌN, không phải "chèn một node ảnh mới"
 *
 * Chèn node đã có đường riêng và nó tốt hơn đường này: `NodeActions` biết node nào
 * nhận được con, và validator từ chối chỗ sai. Dựng thêm một đường chèn ở đây là hai
 * đường cho một việc, và đường ít được nhớ tới sẽ trôi.
 *
 * Việc mà pane này làm mà chỗ khác không: **duyệt kho trong khi vẫn nhìn canvas**. Ô
 * chọn asset trong Inspector mở một dialog che màn; muốn thử ba ảnh thì phải mở dialog
 * ba lần. Ở đây bấm là thấy ngay trên canvas.
 *
 * ## Vì sao dùng `setProps`, không phải một op mới
 *
 * `assetId` là một prop của node như mọi prop khác, và `setProps` đã có validator.
 * Cùng lý do `NodeAssetPicker` dùng nó — xem docblock ở đó.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/builder/cn';
import { selectSaving, useEditor } from '@/lib/builder/store';
import { focusRing } from '@/lib/builder/ui';
import type { Doc } from '@/lib/doc/types';

import { ImageThumb } from './asset/AssetThumb';
import { ButtonLink } from './ui/Button';
import { Skeleton } from './ui/Skeleton';

interface Asset {
  id: string;
  url: string;
  kind: string;
  filename: string;
}

/** Node type nào nhận `assetId`. Ngoài chúng thì pane này không có việc gì để làm. */
const TAKES_ASSET = new Set(['Image', 'Video']);

export function AssetPane({ doc }: { doc: Doc }) {
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedId = useEditor((s) => s.selectedId);
  const dispatch = useEditor((s) => s.dispatch);
  const saving = useEditor(selectSaving);

  const node = selectedId ? doc.nodes[selectedId] : null;
  const target = node && TAKES_ASSET.has(node.type) ? node : null;

  useEffect(() => {
    let stale = false;
    void fetch('/api/assets')
      .then((r) => r.json())
      .then((j: { assets?: Asset[]; error?: string }) => {
        if (stale) return;
        if (j.assets) setAssets(j.assets);
        else setError(j.error ?? 'Không đọc được kho ảnh');
      })
      .catch((e) => {
        if (!stale) setError(String(e));
      });
    return () => {
      stale = true;
    };
  }, []);

  async function attach(assetId: string) {
    if (!target) return;
    await dispatch([{ op: 'setProps', nodeId: target.id, props: { assetId } }], {
      label: 'gắn ảnh',
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        Câu trạng thái đứng TRÊN lưới, luôn có mặt.

        Không có nó thì một lưới ảnh bấm không ăn là một lưới trông như hỏng. Nói ra
        điều kiện trước khi người dùng bấm là luật 3 của `3e`.
      */}
      <p
        className={cn(
          'mx-2.5 mb-2 shrink-0 rounded px-2.5 py-2 text-mini leading-relaxed',
          target ? 'bg-shell-accent-soft text-shell-ink' : 'bg-shell-raised text-shell-muted',
        )}
      >
        {target ? (
          <>
            Bấm một ảnh để gắn vào{' '}
            <strong className="font-semibold text-shell-ink">{target.name ?? target.type}</strong>.
          </>
        ) : node ? (
          <>
            Node đang chọn là <strong className="font-semibold text-shell-ink">{node.type}</strong> — nó
            không nhận ảnh. Chọn một node Ảnh hoặc Video.
          </>
        ) : (
          <>Chọn một node Ảnh hoặc Video ở cây bên trên, rồi bấm một ảnh ở đây.</>
        )}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {error && <p className="text-small text-shell-warn">{error}</p>}

        {assets === null && !error && (
          // Khung đúng hình lưới bên dưới (3 cột, ô vuông), không phải chữ "đang đọc kho".
          <div aria-busy="true" aria-label="Đang đọc kho ảnh" className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-sm" />
            ))}
          </div>
        )}

        {assets?.length === 0 && (
          <p className="text-small text-shell-muted">
            Kho ảnh trống.{' '}
            <Link href="/builder/assets" className="font-semibold text-shell-accent hover:underline">
              Tải ảnh lên
            </Link>
          </p>
        )}

        {assets && assets.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                disabled={!target || saving}
                onClick={() => void attach(a.id)}
                title={`${a.filename}${target ? '' : ' — chọn một node Ảnh trước'}`}
                className={cn(
                  'aspect-square overflow-hidden rounded-sm bg-shell-raised ring-1 ring-shell-line transition-shadow',
                  focusRing,
                  target
                    ? 'cursor-pointer hover:ring-2 hover:ring-shell-accent'
                    : 'cursor-not-allowed opacity-40',
                )}
              >
                {/* `ImageThumb` là `<img>` thường, không `next/image`: đây là chrome của
                    công cụ, và optimizer chỉ nhận host của CDN đã khai trong
                    `next.config`. Một ảnh 80px trong pane không đáng một vòng qua
                    `/_next/image`. Khung shimmer cho tới khi ảnh vẽ xong. */}
                <ImageThumb url={a.url} alt={a.filename} lazy className="size-full" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-shell-line p-2">
        <ButtonLink href="/builder/assets" variant="ghost" size="sm" iconRight="arrow-right" full>
          Mở thư viện đầy đủ
        </ButtonLink>
      </div>
    </div>
  );
}
