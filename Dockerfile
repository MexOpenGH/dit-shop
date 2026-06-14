# ── Dit Shop — production container ───────────────────────────
FROM node:22-slim

# better-sqlite3 ships prebuilt binaries for Node 22, but keep build
# tools available in case a source build is needed on the host's arch.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend dependencies first (better layer caching)
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Copy the rest of the application
COPY . .

# Database lives on a persistent volume in production
ENV DB_PATH=/data/ditshop.sqlite
VOLUME ["/data"]

# Hosts inject PORT; default to 3000 for local `docker run`
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/backend
CMD ["node", "server.js"]
