# Build stage
FROM oven/bun:latest AS build

WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --production

COPY . .
RUN bun run build

# Runtime stage
FROM oven/bun:latest

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json .env* ./

EXPOSE 3000

CMD ["bun", "run", "dist/src/index.js"]
