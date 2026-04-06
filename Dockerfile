# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone mode)
RUN npm run build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static    ./.next/static
COPY --from=builder /app/public          ./public

# Copy Prisma schema + generated client (needed at runtime)
COPY --from=builder /app/prisma          ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy grammy (Telegram bot) + deps — not auto-traced by Next.js standalone
COPY --from=builder /app/node_modules/grammy          ./node_modules/grammy
COPY --from=builder /app/node_modules/@grammyjs        ./node_modules/@grammyjs
COPY --from=builder /app/node_modules/node-fetch        ./node_modules/node-fetch
COPY --from=builder /app/node_modules/abort-controller  ./node_modules/abort-controller
COPY --from=builder /app/node_modules/event-target-shim ./node_modules/event-target-shim
COPY --from=builder /app/node_modules/debug             ./node_modules/debug
COPY --from=builder /app/node_modules/ms                ./node_modules/ms
COPY --from=builder /app/node_modules/whatwg-url        ./node_modules/whatwg-url
COPY --from=builder /app/node_modules/tr46              ./node_modules/tr46
COPY --from=builder /app/node_modules/webidl-conversions ./node_modules/webidl-conversions

# Create uploads directory with correct ownership BEFORE switching to nextjs user
# This allows the app to write uploaded files at runtime
RUN mkdir -p /app/public/uploads && \
    chown -R nextjs:nodejs /app/public/uploads

USER nextjs

# Declare uploads as a volume so files persist across container restarts
VOLUME ["/app/public/uploads"]

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
