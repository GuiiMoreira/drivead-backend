# ---- Base Stage ----
FROM node:18-alpine AS base
WORKDIR /usr/src/app
RUN npm install -g pnpm

# ---- Dependencies Stage ----
FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- Build Stage ----
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN npm run build
# Gere o Prisma Client
RUN npx prisma generate

# ---- Production Stage ----
FROM base AS production
COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/prisma ./prisma

# Comando para iniciar a aplicação
CMD ["node", "dist/main"]