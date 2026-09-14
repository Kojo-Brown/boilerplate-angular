# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build --configuration production

# Stage 2: Serve
#
# A Node process rather than nginx, because half the routes now need one: `/dashboard`
# and everything under it is `RenderMode.Client` and answered with the application shell,
# and `/` and `**` are resolved into 302s by the router *on the server*. `nginx.conf` is
# kept for a static-only deployment — see docs/ssr.md.
#
# Only the build output and production dependencies are copied across: `dist/server`
# bundles the application, but `express` and `@angular/ssr`'s Node entry stay external.
FROM node:22-alpine AS server

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

COPY --from=builder /app/dist/boilerplate-angular ./dist/boilerplate-angular

# Deliberately not defaulted. Angular validates the Host and X-Forwarded-Host of every
# request against this list, and it is empty unless something fills it — so an image that
# baked in `localhost` would start, pass a health check, and reject every real request
# with a 400 about server-side request forgery. `src/server.ts` refuses to start without
# it instead, which fails the deploy rather than the traffic.
#
#   docker run -e NG_ALLOWED_HOSTS=example.com,www.example.com -p 4000:4000 <image>
ENV PORT=4000
EXPOSE 4000

USER node

CMD ["node", "dist/boilerplate-angular/server/server.mjs"]
