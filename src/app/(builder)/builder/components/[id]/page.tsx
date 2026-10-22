import Link from 'next/link';
import { notFound } from 'next/navigation';

/**
 * Một component: xem trước, hợp đồng ghi đè, cây node, lịch sử.
 *
 * ## Vì sao xem trước đứng TRƯỚC cây node
 *
 * Bản đầu mở ra là 30 dòng `ST hero__inner` / `TE hero_title` / `IM Image`.
 * Đúng dữ liệu, sai câu hỏi: không ai đọc danh sách id rồi dựng lại được trong
 * đầu component đó trông ra sao. Hình trả lời "cái này là cái gì" trong một
 * giây; cây node trả lời "sửa vào đâu" — và câu thứ hai chỉ có nghĩa sau câu
 * thứ nhất.
 *
 * ## Vì sao có mục "Trang cha ghi đè được gì"
 *
 * Instance chỉ cho ghi đè NỘI DUNG (`ContentOverride`), còn cấu trúc và style
 * thuộc về component. Luật đó được `schema.ts` giữ bằng `.strict()`, nhưng
 * trước đây không hiện ở đâu cả. Không thấy nó thì người dùng hoặc tưởng sửa gì
 * cũng được — rồi ngạc nhiên vì cỡ chữ không đổi theo trang — hoặc tưởng không
 * sửa được gì, rồi nhân bản component ra năm bản chỉ vì khác một dòng chữ.
 *
 * ## Sửa ở đâu
 *
 * Nút "Mở canvas" đi tới `/builder/components/<id>/edit` — một route riêng, không
 * cần trang nào đang dùng component. Trước đây nó trỏ vào
 * `/builder/<trang>?component=<id>`, nên component chưa được chèn ở đâu thì không
 * mở ra sửa được, và link luôn phải kèm một trang tuỳ ý.
 *
 * Chế độ trong trang VẪN CÒN và vẫn là đường nhanh: pane Component của editor có
 * nút "Sửa" cho nó. Hai đường phục vụ hai việc — sửa một chi tiết rồi quay ra ngay
 * (giữ mức phóng và node đang chọn của trang), so với mở đúng một component.
 *
 * Cảnh báo cũ ở đây — "dựng canvas thứ hai nghĩa là hai bản của Canvas, Inspector,
 * undo và click-to-select" — vẫn đúng, và route mới KHÔNG vi phạm nó:
 * `ComponentEditorShell` ghép lại chính những component đó, không cài lại cái nào.
 */

import { prisma } from '@/lib/db';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import { plainText } from '@/lib/render/richtext';
import { listPages } from '@/lib/builder/queries';
import { componentUsage, overrideSlots } from '@/lib/builder/component-detail';
import { Badge } from '@/components/builder/ui/Badge';
import { ButtonLink } from '@/components/builder/ui/Button';
import { Icon } from '@/components/builder/ui/Icon';
import { PageHeader, PageShell, Section } from '@/components/builder/ui/Page';
import { ComponentActions, ComponentMetaForm } from '@/components/builder/ComponentActions';
import { ComponentPreview } from '@/components/builder/ComponentPreview';
import type { PresetTree } from '@/lib/doc/preset';
import type { Node } from '@/lib/doc/types';

export const dynamic = 'force-dynamic';

interface Row {
  node: Node;
  depth: number;
}

/** Cây → danh sách phẳng, cha trước con, có trần để doc hỏng không treo. */
function flatten(tree: PresetTree): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (seen.has(id) || depth > 32) return;
    seen.add(id);
    const node = tree.nodes[id];
    if (!node) return;
    rows.push({ node, depth });
    for (const child of node.children) walk(child, depth + 1);
  };

  walk(tree.rootId, 0);
  return rows;
}

function textOf(node: Node): string {
  if (node.type === 'Text') return plainText(node.content);
  if (node.type === 'Button') return plainText(node.label);
  if (node.type === 'Image') return node.alt;
  return '';
}

function relTime(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.round(hours / 24)} ngày trước`;
}

/** Chip mono cho giá trị máy đọc: tag, loại chỗ ghi đè, part, effect. */
const CODE_CHIP = 'shrink-0 rounded-sm px-1.5 font-shell-mono text-mini';

const TH = cn(ui.eyebrow, 'border-b border-shell-line px-3 py-2.5 text-left whitespace-nowrap first:pl-5 last:pr-5');
const TD = 'border-b border-shell-line px-3 py-2.5 align-top first:pl-5 last:pr-5';

/** Thẻ ở cột phải: tiêu đề nhóm viết hoa, nội dung xếp dọc. */
function SideCard({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={cn(ui.card, 'flex min-w-0 flex-col gap-3 p-5')}>
      <h2 className={ui.eyebrow}>
        {title}
        {count !== undefined && <span className="ml-1.5 font-medium">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

export default async function ComponentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [preset, usage, pages] = await Promise.all([
    prisma.preset.findUnique({
      where: { id },
      select: {
        id: true, key: true, name: true, category: true, aiDescription: true,
        builtin: true, tree: true, updatedAt: true,
        versions: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: { id: true, label: true, prompt: true, createdBy: true, createdAt: true },
        },
      },
    }),
    componentUsage(id),
    listPages(),
  ]);
  if (!preset) notFound();

  const tree = preset.tree as unknown as PresetTree;
  const rows = flatten(tree);
  const slots = overrideSlots(tree);

  // Canvas phải đứng trên một trang. Ưu tiên trang đang nhúng component này —
  // sửa xong là thấy ngay nó nằm trong bối cảnh thật; nếu chưa trang nào nhúng
  // thì lấy trang đầu, vì cây component không phụ thuộc trang nào cả.
  const hostPageId = usage[0]?.pageId ?? pages[0]?.id ?? null;

  return (
    <PageShell>
      <PageHeader
        crumbs={[{ label: 'Component', href: '/builder/components' }]}
        title={preset.name}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-shell-mono text-small">{preset.key}</span>
            <span aria-hidden>·</span>
            <span>Nhóm {preset.category}</span>
            <span aria-hidden>·</span>
            <span>Sửa {relTime(preset.updatedAt)}</span>
            <Badge tone={preset.builtin ? 'neutral' : 'accent'}>
              {preset.builtin ? 'Có sẵn' : 'Tự tạo'}
            </Badge>
          </span>
        }
        actions={
          <>
            {/* Đường phụ: sửa NGAY TRONG một trang đang dùng nó, để thấy component
                trong bối cảnh thật. Chỉ hiện khi có trang như vậy. */}
            {hostPageId && (
              <ButtonLink href={`/builder/${hostPageId}?component=${preset.id}`} variant="secondary">
                Sửa trong trang
              </ButtonLink>
            )}
            <ButtonLink href={`/builder/components/${preset.id}/edit`} variant="primary" icon="edit">
              Mở canvas
            </ButtonLink>
          </>
        }
      />

      {preset.builtin && (
        <div
          role="note"
          className="flex items-start gap-3 rounded-md bg-shell-warn-soft px-4 py-3 text-small leading-relaxed text-shell-ink"
        >
          <Icon name="info" size={18} className="mt-0.5 shrink-0 text-shell-warn" />
          <p>
            Component này được <strong className="font-semibold">trích tự động</strong> từ trang
            thật. Chạy lại <code className="font-shell-mono">extract-presets.ts</code> sẽ ghi đè
            mọi chỉnh sửa ở đây. Muốn giữ thay đổi thì{' '}
            <strong className="font-semibold">Nhân bản</strong> rồi sửa bản sao.
          </p>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* ── Xem trước ──────────────────────────────────────────── */}
          <Section id="xem-truoc" title="Xem trước" className={cn(ui.card, 'p-5')}>
            <ComponentPreview componentId={preset.id} />
          </Section>

          {/* ── Hợp đồng ghi đè ────────────────────────────────────── */}
          <Section
            id="ghi-de"
            title="Trang cha ghi đè được gì"
            count={slots.length}
            className={cn(ui.card, 'p-5')}
          >
            <p className="max-w-3xl text-small leading-relaxed text-shell-muted">
              Khi một trang nhúng component này, nó nhúng bằng{' '}
              <strong className="font-semibold text-shell-ink">instance</strong> — cấu trúc, style và
              hiệu ứng vẫn thuộc về component, nên sửa ở đây là đổi{' '}
              <strong className="font-semibold text-shell-ink">mọi trang</strong> đang dùng. Riêng những
              chỗ dưới đây thì mỗi trang đặt được giá trị riêng, để rỗng là quay về giá trị
              của component. Đặt ở bảng thuộc tính của trang, sau khi chọn instance.
            </p>

            {slots.length ? (
              // Bảng tràn sát mép thẻ và cuộn ngang trong khung riêng: trang không cuộn ngang.
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full min-w-[40rem] border-collapse text-small">
                  <thead>
                    <tr>
                      <th className={TH}>Chỗ</th>
                      <th className={TH}>Trường</th>
                      <th className={TH}>Mặc định của component</th>
                      <th className={TH}>Vị trí</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((s) => (
                      <tr
                        key={`${s.nodeId}:${s.field}`}
                        className="hover:bg-shell-raised [&:last-child>td]:border-b-0"
                      >
                        <td className={TD}>
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <span className={cn(CODE_CHIP, 'bg-shell-raised text-shell-muted')}>
                              {s.kind}
                            </span>
                            {s.locked && (
                              <Badge
                                tone="warn"
                                size="sm"
                                title="Node bị khoá — cả AI lẫn bảng Văn bản đều không sửa được"
                              >
                                khoá
                              </Badge>
                            )}
                          </span>
                        </td>
                        <td className={TD}>
                          <code className="font-shell-mono text-shell-accent">{s.field}</code>
                        </td>
                        <td className={TD}>
                          <span className="line-clamp-2" title={s.fallback}>
                            {s.fallback || <span className="text-shell-muted">(rỗng)</span>}
                          </span>
                        </td>
                        <td className={cn(TD, 'text-shell-muted')}>
                          <code className="font-shell-mono text-mini break-all">
                            {s.path || '(gốc)'}
                          </code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-small leading-relaxed text-shell-muted">
                Không có chỗ nào. Component này thuần bố cục — không chứa chữ, nhãn nút hay
                ảnh, nên trang nhúng nó sẽ dùng nguyên bản và không đặt riêng được gì.
              </p>
            )}
          </Section>

          {/* ── Cây node ───────────────────────────────────────────── */}
          <Section
            id="cay-node"
            title="Cây node"
            count={rows.length}
            actions={
              <span className="text-small text-shell-muted">
                chỉ đọc ở đây — sửa bằng nút “Mở canvas”
              </span>
            }
            className={cn(ui.card, 'p-5')}
          >
            <ul aria-label="Cây node" className="-mx-5 -mb-5 border-t border-shell-line">
              {rows.map(({ node, depth }) => {
                const text = textOf(node);
                return (
                  <li
                    key={node.id}
                    className="flex min-h-9 items-center gap-2 border-b border-shell-line py-1.5 pr-5 last:border-0 hover:bg-shell-raised"
                    // Thụt lề chặn ở 8 cấp: sâu hơn thì cột chữ không còn chỗ, và
                    // cây component không sâu tới mức đó.
                    style={{ paddingInlineStart: `${1.25 + Math.min(depth, 8) * 0.875}rem` }}
                  >
                    <span className={cn(CODE_CHIP, 'bg-shell-raised text-shell-muted')}>
                      {'tag' in node && node.tag ? node.tag : node.type}
                    </span>
                    {node.name && (
                      <span className="truncate text-small text-shell-muted" title={node.name}>
                        {node.name}
                      </span>
                    )}
                    {text && (
                      <span className="truncate text-small" title={text}>
                        {text}
                      </span>
                    )}
                    {node.part && (
                      <span className={cn(CODE_CHIP, 'bg-shell-accent-soft text-shell-accent')}>
                        {node.part}
                      </span>
                    )}
                    {node.effects.length > 0 && (
                      <span className={cn(CODE_CHIP, 'text-shell-muted ring-1 ring-shell-line ring-inset')}>
                        {node.effects.map((e) => e.effect).join(' ')}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-shell-mono text-micro text-shell-muted">
                      {node.id}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>

        {/* ── Cột phải ─────────────────────────────────────────────── */}
        <aside aria-label="Thuộc tính component" className="flex min-w-0 flex-col gap-5">
          <SideCard title="Đang dùng ở" count={usage.length}>
            {usage.length ? (
              <ul className="flex flex-col gap-2.5">
                {usage.map((u) => (
                  <li key={u.pageId} className="min-w-0">
                    <Link
                      href={`/builder/${u.pageId}`}
                      className="block truncate text-ui font-medium hover:text-shell-accent"
                      title={u.title}
                    >
                      {u.title}
                    </Link>
                    <p className="text-mini text-shell-muted">
                      <span className="font-shell-mono">/{u.slug}</span> · {u.count} chỗ
                      {u.overridden > 0 && <> · {u.overridden} ghi đè</>}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              // Trang nhúng bằng "chèn" (sao chép cây node) KHÔNG tính là dùng —
              // bản sao đó rời khỏi component ngay lúc chèn. Nói ra, nếu không
              // "0 trang" sẽ đọc như "xoá vô hại".
              <p className="text-small leading-relaxed text-shell-muted">
                Chưa trang nào nhúng bằng instance. Trang đã <em>chèn</em> component này thì
                giữ một bản sao riêng và không đổi theo — chúng không hiện ở đây.
              </p>
            )}
          </SideCard>

          <SideCard title="Thông tin">
            <ComponentMetaForm
              id={preset.id}
              name={preset.name}
              category={preset.category}
              about={preset.aiDescription}
            />
          </SideCard>

          <SideCard title="Thao tác">
            <ComponentActions id={preset.id} name={preset.name} builtin={preset.builtin} />
          </SideCard>

          <SideCard title="Lịch sử" count={preset.versions.length}>
            {preset.versions.length ? (
              <ul aria-label="Lịch sử sửa" className="flex flex-col">
                {preset.versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex min-w-0 flex-col gap-0.5 border-b border-shell-line py-2.5 first:pt-0 last:border-0 last:pb-0"
                  >
                    <p className="truncate text-small font-medium" title={v.label ?? ''}>
                      {v.label ?? 'sửa'}
                    </p>
                    <p className="truncate text-mini text-shell-muted">
                      {relTime(v.createdAt)} · <span className="font-shell-mono">{v.createdBy}</span>
                    </p>
                    {v.prompt && (
                      <p
                        className="line-clamp-2 text-mini leading-snug text-shell-muted"
                        title={v.prompt}
                      >
                        “{v.prompt}”
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-shell-muted">
                Chưa có lần sửa nào kể từ khi trích xuất.
              </p>
            )}
          </SideCard>
        </aside>
      </div>
    </PageShell>
  );
}
