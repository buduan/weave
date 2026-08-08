FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY app/backend/package.json ./app/backend/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/utils/package.json ./packages/utils/package.json

RUN pnpm install --frozen-lockfile

COPY app/backend ./app/backend
COPY packages ./packages
COPY tsconfig.base.json ./

RUN pnpm --filter @weave/backend... run build \
  && pnpm --filter @weave/backend deploy --prod --legacy /production

FROM node:22-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /production ./
COPY --from=builder /workspace/app/backend/prisma ./prisma

RUN node_modules/.bin/prisma generate --schema prisma/schema.prisma

EXPOSE 6770

CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node dist/main.js"]
