# Multi-stage build for Doggy Sniper on Fly.io / any Docker host.
# Uses Debian slim (not Alpine) because Prisma's binary engine has
# notoriously broken OpenSSL detection on Alpine/musl.

# ---------- deps ----------
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev=false

# ---------- builder ----------
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Provide a dummy DATABASE_URL during build so Prisma can generate types.
ENV DATABASE_URL="file:/tmp/build.db"
RUN npx prisma generate
RUN npm run build

# ---------- runner ----------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Persistent SQLite path on Fly volume mount
ENV DATABASE_URL="file:/data/sniper.db"

# Install OpenSSL + ca-certs (Prisma engine needs libssl)
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy only what we need to run
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.js ./next.config.js

# Create data dir (mount point) and set ownership for non-root user
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000

# On startup: push schema (idempotent) then start Next.
CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && npx next start -H 0.0.0.0 -p 3000"]
