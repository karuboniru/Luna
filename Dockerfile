# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ARG PNPM_VERSION=10.33.0
# Do not copy the desktop .npmrc (Electron download mirrors).
RUN npm install --global pnpm@${PNPM_VERSION} --registry=https://registry.npmjs.org
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    LAM_DATA_DIR=/data \
    LAM_CACHE_DIR=/cache \
    LAM_MEDIA_DIR=/media \
    BASE_PATH=
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json LICENSE ./
COPY server ./server
COPY public ./public
COPY tools/check/container-health.mjs ./tools/check/container-health.mjs
RUN mkdir -p /data /cache /media && chown node:node /data /cache /media
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "tools/check/container-health.mjs"]
CMD ["node", "server/index.mjs"]
