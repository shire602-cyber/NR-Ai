FROM node:22-alpine

WORKDIR /app

# Copy backend files
COPY backend/package*.json ./

# Install ALL dependencies (including dev for TypeScript)
RUN npm install

# Copy backend source
COPY backend/ ./

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "dist/src/index.js"]
