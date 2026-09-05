# One file, three images, sharing a dependency layer.
#
# Node runs the TypeScript directly by stripping types, so the API and the
# migrator have no build step and nothing in the image can be stale relative to
# the source it was built from. Only the web app is compiled, because a browser
# cannot strip types for itself.

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Only the manifests, so a source edit does not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/runtime/package.json packages/runtime/
RUN pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

FROM source AS api
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/src/server.ts"]

FROM source AS migrate
CMD ["node", "packages/db/src/migrate.ts"]

FROM source AS web-build
RUN pnpm --filter @fledge/web build

FROM caddy:2-alpine AS web
COPY --from=web-build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
