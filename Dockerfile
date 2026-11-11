FROM ubuntu:24.04 AS proxy-build
RUN apt-get update && apt-get install -y --no-install-recommends g++ python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY scripts/bootstrap_proxy.py scripts/bootstrap_proxy.py
RUN python3 scripts/bootstrap_proxy.py
COPY scripts/build_proxy.py scripts/build_proxy.py
COPY proxy proxy
RUN python3 scripts/build_proxy.py

FROM ubuntu:24.04 AS proxy-runtime
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m aegis
WORKDIR /app
COPY --from=proxy-build /src/build/aegis-proxy /app/aegis-proxy
COPY configs/docker.json /app/config.json
USER 10001:10001
ENTRYPOINT ["/app/aegis-proxy", "/app/config.json"]

FROM node:24-bookworm-slim AS app-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json vite.config.ts index.html ./
COPY control control
COPY scripts scripts
COPY web web
RUN npm run build && npx tsc -p tsconfig.runtime.json && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS app-runtime
WORKDIR /app
COPY --from=app-build --chown=node:node /app/node_modules node_modules
COPY --from=app-build --chown=node:node /app/build/server build/server
COPY --from=app-build --chown=node:node /app/dist dist
COPY --chown=node:node package.json ./
RUN mkdir -p /app/.runtime && chown node:node /app/.runtime
USER node
CMD ["node", "build/server/control/server.js"]
