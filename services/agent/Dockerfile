FROM node:22-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/agent/package.json services/agent/package.json

RUN pnpm install --frozen-lockfile --filter @gymcoach/agent...

COPY packages/shared packages/shared
COPY services/agent services/agent

WORKDIR /app/services/agent

EXPOSE 8787
CMD ["pnpm", "start"]
