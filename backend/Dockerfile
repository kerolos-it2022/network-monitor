# Dockerfile for Network Monitor Backend
FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    sqlite \
    tzdata \
    && cp /usr/share/zoneinfo/Asia/Riyadh /etc/localtime \
    && echo "Asia/Riyadh" > /etc/timezone

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only — --omit=dev هو البديل المدعوم في npm الحديث بدل --production)
RUN npm ci --omit=dev && npm cache clean --force

# Copy source code
COPY src/ ./src/

# Create non-root user/group BEFORE changing ownership so files belong to the runtime user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 -G nodejs

# Create database directory with proper permissions (owned by runtime user)
RUN mkdir -p /app/database && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/api/health || exit 1

# Start application
CMD ["node", "src/server.js"]