FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache ca-certificates wget
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache ca-certificates wget
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY tsconfig.json eslint.config.js prettier.config.cjs ./
COPY src ./src
COPY data ./data
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ca-certificates wget
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/data ./data

EXPOSE 8788
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8788/health || exit 1

CMD ["node", "dist/server.js"]
