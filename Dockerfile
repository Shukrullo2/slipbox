# Runtime image. The web app is built beforehand (npm run build) and dist/ is
# copied in, so the server only installs the four runtime packages.
FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
ENV NODE_ENV=production SLIPBOX_HOST=0.0.0.0 SLIPBOX_PORT=4747 SLIPBOX_VAULT=/data/vault
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY claude ./claude
COPY dist ./dist
# Readable by the node user whatever permissions the files arrived with.
RUN chmod -R a+rX /app && mkdir -p /data/vault && chown -R node:node /data
USER node
EXPOSE 4747
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:4747/api/health >/dev/null || exit 1
CMD ["node", "server/index.js"]
