FROM node:22-alpine

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./

# Install ALL dependencies (including dev for TypeScript)
RUN npm install

# Copy shared schema (required by backend imports)
COPY shared/ ./shared/

# Copy backend source
COPY backend/src/ ./src/
COPY backend/tsconfig.json ./

# Build TypeScript
RUN npm run build

# Expose port (Railway uses PORT env var)
EXPOSE 8080

# Start the server
CMD ["node", "dist/src/index.js"]
