# Build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspaces --include-workspace-root

COPY backend backend
COPY frontend frontend
RUN npm run build --workspace backend
RUN npm run build --workspace frontend

# Runtime stage
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

ARG VERSION=
RUN if [ -n "$VERSION" ]; then printf '%s' "$VERSION" > /app/version.txt; fi

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspaces --include-workspace-root --omit=dev

COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

EXPOSE 8080
VOLUME ["/upload", "/fotos", "/videos", "/data"]

CMD ["node", "backend/dist/index.js"]