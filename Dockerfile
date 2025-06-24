# syntax=docker/dockerfile:1

FROM node:20 AS builder
WORKDIR /app

# Copy monorepo files
COPY package.json yarn.lock* .npmrc* ./
COPY packages ./packages

# Install root dependencies and all workspaces
RUN yarn install --frozen-lockfile

# Build frontend
WORKDIR /app/packages/frontend
RUN yarn build || yarn run build

# --- Production image ---
FROM node:20-slim AS runner
WORKDIR /app

# Copy only necessary files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/backend ./packages/backend
COPY --from=builder /app/packages/frontend/dist ./packages/backend/public

# Install backend dependencies only
WORKDIR /app/packages/backend
RUN yarn install --production --frozen-lockfile

# Expose backend port
EXPOSE 3000

# Start backend server only
CMD ["yarn", "start"]
