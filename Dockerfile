# Single-stage image: builds the site, then serves site + API from one process.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so this layer caches between code changes.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# devDependencies are needed to build the front end, then discarded.
COPY . .
RUN npm install --include=dev && npm run build && npm prune --omit=dev

EXPOSE 1215
ENV API_HOST=0.0.0.0
ENV API_PORT=1215

# Fail the container health check if the database is unreachable.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||1215)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
