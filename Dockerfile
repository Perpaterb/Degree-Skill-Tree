# Local development image: the Vite dev server with hot reload.
# Source is bind-mounted by docker-compose.yml; node_modules comes from the image.
FROM node:22-bookworm-slim

# The node user (uid 1000) owns everything, so the dev server can write its cache
# and files it creates on the bind mount belong to the host user.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && cp package-lock.json node_modules/.package-lock.stamp

COPY --chown=node:node . .
EXPOSE 5173
ENTRYPOINT ["sh", "scripts/dev-entrypoint.sh"]
# Run Vite directly, not through npm: npm reports a normal stop (SIGTERM) as "command failed".
CMD ["node_modules/.bin/vite", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]
