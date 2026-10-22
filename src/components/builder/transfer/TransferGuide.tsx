'use client';

/**
 * Một lỗi / việc cần làm của xuất–nhập trang, kèm hướng dẫn từng bước — hiện ngay tại chỗ.
 * Nội dung lấy từ `GUIDES` (`lib/transfer/guides.ts`), không viết chữ hướng dẫn ở component.
 */

import { renderGuide, type TransferIssue } from '@/lib/transfer/guides';
import { cn } from '@/lib/builder/cn';

const TONE = {
  block: 'border-shell-danger/40 bg-shell-danger/5',
  warn: 'border-shell-warn/40 bg-shell-warn/5',
  todo: 'border-shell-line bg-shell-raised',
} as const;

export function TransferGuide({ issue }: { issue: TransferIssue }) {
  const g = renderGuide(issue);
  return (
    <section
      data-transfer-issue={issue.code}
      role={issue.level === 'block' ? 'alert' : undefined}
      className={cn('flex flex-col gap-2 rounded-lg border p-3 text-small', TONE[issue.level])}
    >
      <h3 className="font-semibold text-ui">
        <span className="mr-2 font-mono text-mini text-shell-muted">{g.tag}</span>
        {g.title}
      </h3>
      <p className="text-shell-muted">{issue.detail ?? g.why}</p>
      {issue.items?.length ? (
        <ul className="flex max-h-40 flex-col gap-1 overflow-auto">
          {issue.items.map((it, i) => (
            <li key={i}>
              {it.href ? <a className="underline" href={it.href} target="_blank" rel="noreferrer">{it.label}</a> : it.label}
            </li>
          ))}
        </ul>
      ) : null}
      <ol className="list-decimal pl-5" data-transfer-steps>
        {g.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </section>
  );
}

export function TransferIssues({ issues }: { issues: TransferIssue[] }) {
  const order = { block: 0, warn: 1, todo: 2 } as const;
  return (
    <div className="flex flex-col gap-2">
      {[...issues].sort((a, b) => order[a.level] - order[b.level]).map((i, k) => <TransferGuide key={`${i.code}-${k}`} issue={i} />)}
    </div>
  );
}
