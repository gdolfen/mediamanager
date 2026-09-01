# ── Layer 1: Dependencies (cached unless package.json changes) ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspaces --include-workspace-root

# ── Layer 2: Build backend (tsc + esbuild minify) ──
FROM deps AS backend-build
COPY backend backend
RUN npm run build --workspace backend
RUN find backend/dist -name '*.js' | xargs npx -y esbuild --minify --allow-overwrite --platform=node

# ── Layer 3: Build frontend (vite already minifies) ──
FROM deps AS frontend-build
COPY frontend frontend
RUN npm run build --workspace frontend

# ── Layer 4: Production dependencies only ──
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspaces --include-workspace-root --omit=dev

# ── Final: minimal runtime image ──
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

ARG VERSION=
RUN if [ -n "$VERSION" ]; then printf '%s' "$VERSION" > /app/version.txt; fi

# Production deps (cached unless package.json changes)
COPY --from=prod-deps /app/node_modules node_modules

# Build outputs (changes on code change)
COPY --from=backend-build /app/backend/dist backend/dist
COPY --from=frontend-build /app/frontend/dist frontend/dist

EXPOSE 8080
VOLUME ["/upload", "/fotos", "/videos", "/data"]
CMD ["node", "backend/dist/index.js"]
