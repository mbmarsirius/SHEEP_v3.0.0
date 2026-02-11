# =============================================================================
# SHEEP Cloud Server - Docker Image for Railway
# =============================================================================
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build TypeScript (cloud config excludes legacy files)
RUN npx tsc -p tsconfig.cloud.json

# =============================================================================
# Production stage
# =============================================================================
FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Create data directory for per-user SQLite databases
RUN mkdir -p /data

ENV NODE_ENV=production
ENV SHEEP_DATA_DIR=/data

# Railway sets PORT dynamically
EXPOSE 3000

CMD ["node", "dist/cloud/server.js"]
