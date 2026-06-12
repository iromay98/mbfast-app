# mbFAST アプリ本番イメージ（Next.js 16 + Prisma 7 driver adapter）
FROM node:22-slim AS base
WORKDIR /app
# Prisma / pg が必要とする OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 依存インストール
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ビルド（Prisma クライアント生成 → Next ビルド）
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# generate/build は DB に接続しないが、prisma.config.ts が DATABASE_URL を必須にしているため
# ビルド段階のみダミーを与える（この ENV は run ステージへは引き継がれない）。
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN npx prisma generate
RUN npm run build

# 実行
FROM base AS run
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app ./
RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
