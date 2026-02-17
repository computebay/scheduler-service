# Scheduler Service

A distributed job scheduler service built with TypeScript, Bun, Prisma, and RabbitMQ.

## Features

- **Job Scheduling**: Schedule jobs across a distributed cluster of nodes
- **Resource Management**: Manage CPU and memory resources across nodes
- **Heartbeat Monitoring**: Monitor node health through heartbeat events
- **Event-Driven**: Built on RabbitMQ for event-driven architecture
- **Placement Algorithm**: Intelligent job placement based on available resources

## Architecture

The service is organized into:

- **Consumers**: Message queue consumers for events (job creation, heartbeats, node registration)
- **Producers**: Event publishers for scheduler events
- **Config**: Configuration management for database, RabbitMQ, and environment
- **Libs**: Reusable libraries for Prisma, RabbitMQ, and logging
- **Domain**: Core business logic (cluster state, placement algorithm, resource reservation)
- **Services**: Business logic services for scheduling operations
- **Types**: TypeScript type definitions
- **Utils**: Utility functions

## Prerequisites

- [Bun](https://bun.sh/)
- PostgreSQL
- RabbitMQ
- Node.js 18+ (if not using Bun runtime)

## Setup

1. Install dependencies:

```bash
bun install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

3. Setup database:

```bash
bun run prisma:migrate
```

4. Start the service:

```bash
bun run dev
```

## Development

- Build: `bun run build`
- Test: `bun run test`
- Lint: `bun run lint`
- Prisma Studio: `bun run prisma:studio`

## Docker

Build and run with Docker:

```bash
docker build -t scheduler-service .
docker run -p 3000:3000 scheduler-service
```

## License

MIT
