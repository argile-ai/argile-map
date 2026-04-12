# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Production build points directly at the backend (no proxy needed — CORS is
# enabled on the backend and the app is served from a different subdomain).
ENV VITE_ARGILE_API_URL=https://ai-rgile.argile.ai
RUN npm run build

# Serve stage
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
