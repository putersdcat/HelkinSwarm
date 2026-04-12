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
COPY skills/ skills/

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

# Install Playwright Chromium browser + OS-level dependencies for interactive browsing (#177 Phase 2)
# Must run in the runtime stage so binaries match the target Linux environment.
RUN npx playwright install chromium --with-deps

# Copy config and skills manifests (JSON files needed at runtime)
COPY config/ ./config/
COPY skills/ ./skills/
COPY src/persona/ ./src/persona/
COPY visualAssets/ ./visualAssets/

# Copy model profiles — needed at runtime by profileLoader (#618)
# Resolves to dist/model-profiles/ to match join(import.meta.dirname, '..', '..', 'model-profiles')
COPY model-profiles/ ./dist/model-profiles/

EXPOSE 80
