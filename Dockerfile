# Stage 1: Build & Generate Prisma Client
FROM oven/bun:latest AS builder

WORKDIR /app

# Copy dependency definitions
COPY package.json bun.lock ./

# Install all dependencies (including devDependencies to get prisma CLI)
RUN bun install --frozen-lockfile

# Copy prisma directory and generate client
COPY prisma ./prisma
RUN bun run prisma:generate

# Stage 2: Runtime Stage
FROM oven/bun:latest AS runner

WORKDIR /app

# Set default environment variables
ENV NODE_ENV=production
ENV PORT=8000

# Copy dependency definitions and install production-only dependencies
COPY package.json bun.lockb ./
RUN bun install --production --frozen-lockfile

# Copy generated Prisma Client and artifacts from builder stage
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy application source and files
COPY src ./src
COPY tsconfig.json ./
COPY prisma ./prisma
COPY docker-entrypoint.sh ./

# Expose port (default 8000)
EXPOSE 8000

# Set entrypoint to custom startup script
ENTRYPOINT ["./docker-entrypoint.sh"]
