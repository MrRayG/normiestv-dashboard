FROM node:20-slim

# Install canvas dependencies
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

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source
COPY . .

# Build the app
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "dist/index.cjs"]
