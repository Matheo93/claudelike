# Use official Node.js LTS (Long Term Support) version
FROM node:22-slim

# Install dependencies for Puppeteer (needed for PDF processing)
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# Use --legacy-peer-deps to handle peer dependency conflicts (Resend)
RUN npm ci --legacy-peer-deps --only=production

# Copy application source code
COPY . .

# Expose port (default 3001, can be overridden by PORT env var)
EXPOSE 3001

# Set environment to production
ENV NODE_ENV=production

# Health check - ensures the service is running properly
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

# Run the application
CMD ["node", "server.js"]
