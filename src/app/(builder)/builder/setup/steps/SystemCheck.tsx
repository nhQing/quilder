'use client';

import { useState } from 'react';

import { copyText } from '@/lib/builder/clipboard';
import { cn } from '@/lib/builder/cn';
import { ui } from '@/lib/builder/ui';
import type { SetupStatus } from '@/lib/setup/status';
import { Button } from '@/components/builder/ui/Button';
import { Icon } from '@/components/builder/ui/Icon';
import { Consequence } from '@/components/builder/ui/Overlay';

/**
 * Bước 1 — kiểm hệ thống. Không nhập gì: DB và env thuộc về máy chủ, không thuộc về
 * trình duyệt (xem spec D1). Việc của bước này là NÓI RÕ cái gì hỏng và lệnh nào sửa
 * được nó, rồi cho kiểm lại.
 */

export function systemReady(s: SetupStatus): boolean {
  return s.db === 'ok' && s.env.authSecret;
}

interface Fix {
  title: string;
  body: string;
  commands: string[];
}

function fixesFor(s: SetupStatus): Fix[] {
  const out: Fix[] = [];
  if (s.db === 'unreachable') {
    out.push(
      s.dev
        ? {
            title: 'Không nối được database',
            body: 'Bật Postgres của máy dev, rồi kiểm DATABASE_URL trong .env (mặc định trỏ localhost:5433).',
            commands: ['pnpm db:up'],
          }
        : {
            title: 'Không nối được database',
            body: 'Kiểm DATABASE_URL (hoặc DB_HOST, DB_PORT, POSTGRES_*) của container app, và database có đang chạy không. Chi tiết lỗi nằm trong log của app.',
            commands: ['docker compose -f docker-compose.prod.yaml logs app --tail 50'],
          },
    );
  }
  if (s.db === 'needs-migration') {
    out.push(
      s.dev
        ? {
            title: 'Database chưa áp đủ migration',
            body: 'Tắt dev server trước khi chạy, rồi bật lại.',
            commands: ['pnpm db:migrate'],
          }
        : {
            title: 'Database chưa áp đủ migration',
            body: 'Migration chạy ở service bootstrap, không chạy trong app.',
            commands: ['docker compose -f docker-compose.prod.yaml up -d bootstrap', 'docker compose -f docker-compose.prod.yaml logs bootstrap'],
          },
    );
  }
  if (!s.env.authSecret) {
    out.push({
      title: 'Thiếu AUTH_SECRET',
      body: 'Đặt AUTH_SECRET (tối thiểu 32 ký tự) trong biến môi trường rồi khởi động lại server. Lệnh dưới sinh một chuỗi ngẫu nhiên.',
      commands: ['openssl rand -base64 48'],
    });
  }
  return out;
}

function Row({ ok, warn, label, detail }: { ok: boolean; warn?: boolean; label: string; detail: string }) {
  const tone = ok ? ui.tone.ok : warn ? ui.tone.warn : ui.tone.danger;
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={cn(ui.chip, tone, 'mt-0.5 px-1.5')} aria-hidden>
        <Icon name={ok ? 'check' : warn ? 'alert' : 'x'} size={12} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-medium">{label}</span>
        <span className="block text-small text-shell-muted">{detail}</span>
      </span>
    </li>
  );
}

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn(ui.inset, 'flex items-center gap-2 py-1.5 pr-1.5 pl-3')}>
      <code className="min-w-0 flex-1 overflow-x-auto font-shell-mono text-small whitespace-nowrap">{text}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={copied ? 'check' : 'copy'}
        onClick={async () => {
          try {
            await copyText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // Không chép được thì lệnh vẫn nằm đó để bôi đen chép tay.
          }
        }}
      >
        {copied ? 'Đã chép' : 'Chép'}
      </Button>
    </div>
  );
}

export function SystemCheck({
  status,
  checking,
  onRecheck,
}: {
  status: SetupStatus;
  checking: boolean;
  onRecheck: () => void;
}) {
  const fixes = fixesFor(status);
  const dbDetail =
    status.db === 'ok' ? 'Đã nối được và đủ migration.' : status.db === 'needs-migration' ? 'Nối được, nhưng chưa áp đủ migration.' : 'Không nối được.';

  return (
    <div className="flex flex-col gap-4">
      <ul className="divide-y divide-shell-line" aria-live="polite">
        <Row ok={status.db === 'ok'} label="Database" detail={dbDetail} />
        <Row
          ok={status.env.authSecret}
          label="Khoá phiên đăng nhập (AUTH_SECRET)"
          detail={status.env.authSecret ? 'Đã đặt.' : 'Chưa đặt hoặc ngắn hơn 32 ký tự.'}
        />
        <Row
          ok={status.env.s3}
          warn
          label="Kho file (S3)"
          detail={
            status.env.s3
              ? 'Đã cấu hình.'
              : 'Chưa cấu hình — cài đặt vẫn chạy, nhưng tải ảnh, favicon sẽ lỗi cho tới khi đặt các biến S3_*.'
          }
        />
        <Row
          ok
          label="Chế độ"
          detail={
            status.dev
              ? 'Môi trường dev — không cần mã cài đặt.'
              : 'Production — bước cuối cần mã cài đặt từ log của container bootstrap.'
          }
        />
      </ul>

      {fixes.map((f) => (
        <div key={f.title} className="flex flex-col gap-2">
          <Consequence>{f.title}</Consequence>
          <p className="text-small text-shell-muted">{f.body}</p>
          {f.commands.map((c) => (
            <Command key={c} text={c} />
          ))}
        </div>
      ))}

      {fixes.length > 0 && (
        <div>
          <Button variant="primary" icon="refresh" loading={checking} onClick={onRecheck}>
            Kiểm tra lại
          </Button>
        </div>
      )}
    </div>
  );
}
