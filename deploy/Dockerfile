# codex-auth reference backend — deploy-anywhere container.
#
# Bundles Node + the official `codex` CLI + an Express server that mounts
# createCodexRouter at /api/codex. Push to any container host (Railway, Render,
# a VPS, Cloud Run, etc.). This is the persistent backend the browser talks to;
# the OAuth tokens live here, never in the browser.
#
# Build:  docker build -f deploy/Dockerfile -t codex-auth-backend .
# Run:    docker run -p 8787:8787 -e COOKIE_SECRET=$(openssl rand -base64 32) codex-auth-backend

FROM node:22-slim

# Install the official Codex CLI globally.
RUN npm install -g @openai/codex

WORKDIR /app

# Install backend deps (express, the codex-auth package).
COPY deploy/server-package.json ./package.json
RUN npm install --omit=dev

# The standalone production server.
COPY deploy/server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

# COOKIE_SECRET MUST be provided at runtime (high-entropy, from your secret store).
# CODEX_MODEL is optional (defaults to gpt-5.5).
CMD ["node", "server.mjs"]
