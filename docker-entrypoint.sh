#!/bin/sh
# Docker Entrypoint Script
set -e

echo "=== Starting Scheduler Service Bootstrap ==="

# 1. Database Connectivity Check
if [ -n "$DATABASE_URL" ]; then
  echo "Checking database connectivity..."
  
  # Use inline Bun script to verify PostgreSQL connection
  MAX_RETRIES=30
  RETRY_COUNT=0
  
  until bun -e "
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.end();
  process.exit(0);
} catch (err) {
  process.exit(1);
}
" > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT+1))
    if [ $RETRY_COUNT -gt $MAX_RETRIES ]; then
      echo "Error: Database is still unavailable after $MAX_RETRIES attempts. Exiting."
      exit 1
    fi
    echo "Database is unavailable - waiting... ($RETRY_COUNT/$MAX_RETRIES)"
    sleep 2
  done
  echo "Database connection successful!"
else
  echo "Warning: DATABASE_URL is not set. Skipping connectivity check."
fi

# 2. Database Migrations
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Applying database migrations..."
  if bun run prisma:generate; then
    echo "Prisma client generated successfully."
  else
    echo "Warning: Prisma client generation failed, continuing..."
  fi
  
  echo "Deploying database migrations..."
  if bunx prisma migrate deploy; then
    echo "Database migrations applied successfully!"
  else
    echo "Error: Database migrations failed to apply. Exiting."
    exit 1
  fi
fi

echo "=== Bootstrapping Complete, Launching App ==="
# Execute the application as PID 1 (important for graceful shutdown signals)
exec bun run src/index.ts
