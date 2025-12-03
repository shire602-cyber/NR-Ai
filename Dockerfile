FROM node:22-alpine

WORKDIR /app

# Force cache bust - v2
ARG CACHEBUST=2

# Copy ALL backend files at once to ensure consistency
COPY backend/ ./

# Install dependencies
RUN npm install

# Build TypeScript
RUN npm run build

# Debug: List files to verify structure
RUN echo "=== Checking build output ===" && ls -la dist/src/ && ls -la dist/shared/ 2>/dev/null || echo "No dist/shared"

# Expose port
EXPOSE 8080

# Start the server
CMD ["node", "dist/src/index.js"]
