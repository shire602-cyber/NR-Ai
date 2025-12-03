FROM node:22-alpine

WORKDIR /app

# Copy package files first for better caching
COPY backend/package*.json ./

# Install ALL dependencies
RUN npm install

# Copy source files (excluding node_modules, dist via .dockerignore)
COPY backend/src/ ./src/
COPY backend/shared/ ./shared/
COPY backend/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Debug: Show entire dist structure
RUN echo "=== Full dist structure ===" && find dist -type f && echo "=== End structure ==="

# Verify critical files exist
RUN test -f dist/src/index.js || (echo "ERROR: dist/src/index.js missing" && exit 1)
RUN test -f dist/shared/schema.js || (echo "ERROR: dist/shared/schema.js missing" && exit 1)

# Use npm start script
CMD ["npm", "start"]
