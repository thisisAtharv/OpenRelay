FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=4000

# Install production dependencies only using the existing package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code
COPY src/ ./src/

# Use unprivileged node user provided by the official Node image
USER node

EXPOSE 4000

CMD ["node", "src/server.js"]
