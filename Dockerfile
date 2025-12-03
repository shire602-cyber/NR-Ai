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

# Verify build output exists
RUN ls -la dist/src/index.js dist/shared/schema.js

# Use npm start script
CMD ["npm", "start"]
