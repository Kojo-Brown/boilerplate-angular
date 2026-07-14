# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build --configuration production

# Stage 2: Serve
FROM nginx:1.27-alpine AS server

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/boilerplate-angular/browser /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
