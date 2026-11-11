# syntax=docker/dockerfile:1.7
# One image for the Cloud Run service (API + SPA) and the migrate job.

ARG NODE_VERSION=26

# ---------------------------------------------------------------- deps
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---------------------------------------------------------------- build
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build

# ---------------------------------------------------------------- prod deps
FROM node:${NODE_VERSION}-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund -w @app/api --include-workspace-root=false

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST_DIR=/app/web
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build --chown=node:node /app/apps/web/dist ./web
USER node
EXPOSE 8080
# The migrate job overrides this with: node apps/api/dist/migrate.js
CMD ["node", "--enable-source-maps", "apps/api/dist/server.js"]
