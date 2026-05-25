# Stage 1: Build & Generate Prisma Client
FROM oven/bun:latest AS builder

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY prisma ./prisma

RUN bun run prisma:generate

COPY . .

# Stage 2: Runtime Stage
FROM oven/bun:latest AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY --from=builder /app/node_modules ./node_modules

COPY src ./src
COPY tsconfig.json ./
COPY prisma ./prisma
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]