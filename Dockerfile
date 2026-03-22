FROM node:20-slim

# Install canvas + build dependencies
RUN apt-get update && apt-get install -y \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install all deps (need dev for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# /data is the persistent volume mount point on Railway
# All state files (burn receipts, DB, CYOA state, etc.) live here
RUN mkdir -p /data
EXPOSE 5000

ENV NODE_ENV=production
ENV DATA_DIR=/data

CMD ["node", "dist/index.cjs"]
