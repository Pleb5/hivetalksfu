FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS build

WORKDIR /src

ENV MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY app ./app
COPY public ./public
COPY tests ./tests

RUN npm audit --omit=dev --audit-level=high \
    && npm test \
    && test -x node_modules/mediasoup/worker/out/Release/mediasoup-worker \
    && npm prune --omit=dev

FROM node:22.22.2-bookworm-slim@sha256:9f6d5975c7dca860947d3915877f85607946403fc55349f39b4bc3688448bb6e AS runtime

ARG VCS_REF=unknown

LABEL org.opencontainers.image.source="https://github.com/Pleb5/hivetalksfu" \
    org.opencontainers.image.revision="${VCS_REF}" \
    org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /src

ENV NODE_ENV=production

COPY --from=build --chown=node:node /src/package.json ./package.json
COPY --from=build --chown=node:node /src/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /src/node_modules ./node_modules
COPY --from=build --chown=node:node /src/app ./app
COPY --from=build --chown=node:node /src/public ./public
COPY --chown=node:node LICENSE README.md ./

USER node

EXPOSE 3010/tcp 40000-40100/tcp 40000-40100/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "require('http').get('http://127.0.0.1:3010/healthz',r=>process.exit(r.statusCode===204?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "app/src/Server.js"]
