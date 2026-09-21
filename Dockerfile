FROM node:24-bookworm-slim
WORKDIR /opt/unharnessed
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY test ./test
COPY scripts ./scripts
COPY examples ./examples
COPY tsconfig.json ./
RUN npm run check && npm test && mkdir /lab && chown node:node /lab
ENV PI_OFFLINE=1 PI_TELEMETRY=0
USER node
WORKDIR /lab
ENTRYPOINT ["node", "/opt/unharnessed/scripts/container.ts"]
