FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json ./web/
COPY server/package.json ./server/

RUN npm ci --no-audit --no-fund \
  || (echo "[docker] npm ci retry 1…" && sleep 15 && npm ci --no-audit --no-fund) \
  || (echo "[docker] npm ci retry 2…" && sleep 15 && npm ci --no-audit --no-fund)

COPY web ./web
COPY server ./server
COPY plugins ./plugins
COPY scripts ./scripts
COPY config.example.json ./

RUN npm run build \
  && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    SERVE_STATIC=1 \
    HOST=0.0.0.0 \
    PORT=6633 \
    DATA_DIR=/data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/plugins ./plugins
COPY config.example.json ./

COPY scripts/docker-entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

RUN mkdir -p /data

VOLUME ["/data"]
EXPOSE 6633

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||6633)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
ENTRYPOINT ["sh", "/entrypoint.sh"]
CMD ["node", "dist/index.js"]
