# ============================================================================
# HelkinSwarm — Multi-stage Dockerfile (Node 22 LTS + Azure Functions v4)
# Spec refs: 03-Tech-Stack-Infrastructure.md, 12-Deployment-CICD.md
# ============================================================================

# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json host.json ./
COPY src/ src/

RUN pnpm run build

# Prune dev dependencies for production
RUN pnpm prune --prod

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM mcr.microsoft.com/azure-functions/node:4-node22

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

WORKDIR /home/site/wwwroot

# Copy production node_modules and built output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/host.json ./host.json
COPY --from=build /app/package.json ./package.json

EXPOSE 80
