# Multi-stage, tự chứa.
#
# KHÔNG kéo node_modules từ một image cache của registry riêng (kiểu
#   COPY --from=<registry>/<app>:cache … node_modules)
# tức nó không build được nếu chưa có cache image đẩy lên registry trước. Ở đây
# node_modules được cài trong chính build, nên `docker build .` chạy được ngay từ
# lần đầu, trên máy bất kỳ. Cache layer của Docker vẫn giữ được tốc độ vì
# lockfile được copy trước source.
#
# Prisma: `prisma generate` phải chạy TRƯỚC `next build`, và query engine phải có
# mặt trong image runtime — đây là chỗ hay hỏng nhất khi container hoá Prisma.

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable pnpm

# ── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma client sinh trước khi Next build — code import @prisma/client lúc build.
RUN pnpm exec prisma generate

# DATABASE_URL giả lúc build: Next chỉ cần type và bundle, không kết nối thật.
# Giá trị thật được inject lúc container start.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true
# Host kho ảnh — THÔNG SỐ LÚC BUILD, đóng vào `images.remotePatterns` (next.config.mjs).
# `.env` bị .dockerignore loại nên phải truyền: --build-arg ASSET_HOSTS=https://cdn.ten-mien.vn
# Thiếu thì `next build` dừng kèm hướng dẫn (scripts/asset-hosts.mjs).
ARG ASSET_HOSTS=""
ENV ASSET_HOSTS=$ASSET_HOSTS
# Gói dự án (projects/<tên>/, clone sẵn vào context build). Trống = Quilder thuần.
# Sai tên gói thì `next build` dừng (scripts/project-dir.mjs).
ARG QUILDER_PROJECT=""
ENV QUILDER_PROJECT=$QUILDER_PROJECT
RUN pnpm run build

# ── migrate ───────────────────────────────────────────────────────────────
# Stage riêng, chứa Prisma CLI, dùng để áp migration đúng MỘT lần khi deploy.
# Tách khỏi runner có chủ đích: runner không cần CLI (đỡ hàng chục MB), và
# migration không được chạy đồng thời từ nhiều replica.
#
#   docker build --target migrate -t quilder:migrate .
#   docker run --rm --network <net> -e DATABASE_URL=... quilder:migrate
#
# KHÔNG còn được publish lên registry từ 26/08/2026 — `bootstrap` bên dưới là tập
# cha của nó và làm đúng việc này cộng seed. Stage vẫn ở lại vì `bootstrap` kế
# thừa từ đây, và vì `pnpm docker:up` (máy dev) vẫn build nó tại chỗ.
FROM base AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml ./
COPY prisma ./prisma

# Prisma Client PHẢI sinh ở stage này, không chỉ ở `builder`.
#
# `deps` chỉ chạy `pnpm install`, và cài @prisma/client KHÔNG sinh ra client — nó
# để lại một stub ném đúng câu "did not initialize yet". `migrate deploy` không cần
# client nên stage này chạy tốt suốt, và lỗi chỉ lộ ra ở `bootstrap` (kế thừa từ
# đây), tại bước ĐẦU TIÊN dùng tsx + PrismaClient.
#
# Đo trên staging 28/08/2026: migration áp xong sạch, rồi `sync-effects.ts` chết với
#
#     Error: @prisma/client did not initialize yet. Please run "prisma generate"
#       at new PrismaClient (…/.prisma/client/default.js:43:11)
#
# Sinh ở đây thay vì COPY từ `builder`: giữ được việc `--target migrate` chỉ phụ
# thuộc `deps`, nên build stage này không phải chờ `next build`.
RUN pnpm exec prisma generate --schema ./prisma/schema.prisma

ENTRYPOINT ["./node_modules/.bin/prisma", "migrate", "deploy", "--schema", "./prisma/schema.prisma"]

# ── bootstrap ─────────────────────────────────────────────────────────────
# `migrate` cộng thêm khả năng SEED, để một stack mới lên là đã có trang chủ.
#
# ## Vì sao là một stage riêng chứ không nhét vào entrypoint của app
#
# `entrypoint.sh` cố ý không migrate, vì hai lý do vẫn còn nguyên giá trị: Prisma
# CLI không nằm trong output standalone của Next (copy vào là phình runner hàng
# chục MB, mà runner chạy 24/7 còn migration chạy vài giây mỗi lần deploy), và
# nhiều replica cùng migrate lúc start là một race condition thật.
#
# Stage này giữ cả hai lý do đó nguyên vẹn mà vẫn bỏ được bước gõ tay: compose
# chạy nó như một service chạy-rồi-thoát, và `app` chờ nó bằng
# `depends_on: condition: service_completed_successfully`. Một lệnh
# `docker compose up -d` làm đủ ba việc, đúng thứ tự, đúng MỘT lần.
#
# ## Vì sao cần `src`
#
# `prisma/seed.ts` import kiểu từ `src/lib/doc/types` (tsx bỏ import kiểu, nhưng
# đường dẫn vẫn phải phân giải được), và `scripts/create-user.ts` import
# `hashPassword` từ `src/lib/auth/password` — cái này là RUNTIME, không phải kiểu.
FROM migrate AS bootstrap
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY --chmod=0755 scripts/bootstrap.sh ./bootstrap.sh
ENTRYPOINT ["sh", "./bootstrap.sh"]

# ── runner ────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
RUN mkdir .next && chown nextjs:nodejs .next

# output: 'standalone' gom sẵn server + node_modules tối thiểu.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma cần schema và query engine lúc chạy. standalone KHÔNG tự gom chúng —
# thiếu bước này thì container start được nhưng mọi query đều lỗi.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.pnpm/@prisma+client*/node_modules/.prisma ./node_modules/.prisma

# CSS tĩnh của site, ĐỌC LÚC CHẠY — không phải nguồn để build.
#
# `compileStaticCss` gộp `src/styles/site.css` cùng các `@import` của nó rồi băm ra
# `StyleBundle.hash`. Việc đó xảy ra lúc PUBLISH (để đóng bó vào release) và lúc PHỤC
# VỤ `/mm-css/<hash>.css`, tức trong tiến trình đang chạy — nên `src/styles` phải có
# trong image runtime. `output: 'standalone'` không gom nó: với Next thì CSS đã được
# biên dịch vào bundle, còn việc ta đọc lại chính file nguồn là chuyện Next không biết.
#
# Thiếu dòng này thì container start bình thường, trang HTML trả 200, nhưng
# `/mm-css/<hash>.css` trả 500 và SITE HIỆN RA KHÔNG CÓ CSS NÀO — còn Publish thì
# 500 luôn. Đo được ngày 19/08/2026 khi chạy image thật lần đầu:
#
#     Error: ENOENT: no such file or directory, open 'src/styles/site.css'
#
# Không copy cả `src/`: chỉ thư mục thật sự được đọc lúc chạy. Copy cả src là mời
# người sau tưởng rằng runtime có thể đọc bất cứ file nguồn nào.
COPY --from=builder --chown=nextjs:nodejs /app/src/styles ./src/styles

# Gói dự án: CSS (`styles/`) và tài nguyên (`public/`, phục vụ ở /p/**) cũng được ĐỌC
# lúc chạy, cùng lý do với `src/styles` ngay trên. Chép cả thư mục `projects/` — trong
# thực tế chỉ có gói mẫu và gói đang build.
COPY --from=builder --chown=nextjs:nodejs /app/projects ./projects
# Gói đang chạy — cùng giá trị với lúc build (ARG ở stage builder).
ARG QUILDER_PROJECT=""
ENV QUILDER_PROJECT=$QUILDER_PROJECT

COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
COPY --chown=nextjs:nodejs scripts/check-schema.mjs ./scripts/check-schema.mjs
RUN sed -i 's/\r$//' ./entrypoint.sh && chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

ENTRYPOINT ["sh", "./entrypoint.sh"]
