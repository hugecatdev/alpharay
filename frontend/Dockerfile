FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_MODE=real
ARG VITE_ASSISTANT_ENABLED=true
ENV VITE_API_MODE=$VITE_API_MODE VITE_ASSISTANT_ENABLED=$VITE_ASSISTANT_ENABLED
RUN npm run build

FROM nginx:1.27-alpine
ENV API_UPSTREAM=http://backend:8000
ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
