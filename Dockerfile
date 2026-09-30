FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
RUN apk add --no-cache ca-certificates curl \
    && curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /tmp/rds-global-bundle.pem
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem
WORKDIR /app
COPY --from=build /tmp/rds-global-bundle.pem /app/certs/rds-global-bundle.pem
COPY package.json package-lock.json ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/scripts/require-direct-database-url.mjs ./scripts/require-direct-database-url.mjs
RUN npm ci --omit=dev --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000 \
    && npm run db:generate \
    && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/app.js"]
