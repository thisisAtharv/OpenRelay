# Stage 1: Build the Vite React application
FROM node:20-alpine AS builder

WORKDIR /app

# Build arguments for Vite environment variables
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Install dependencies using package-lock.json
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source code and configuration
COPY index.html vite.config.js eslint.config.js ./
COPY public/ ./public/
COPY src/ ./src/

# Run the production build
RUN npm run build

# Stage 2: Serve the production bundle with Nginx
FROM nginx:alpine AS runner

# Remove default static files
RUN rm -rf /usr/share/nginx/html/*

# Copy built static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
