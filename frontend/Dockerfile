FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_PROXY_URL
ENV VITE_PROXY_URL=${VITE_PROXY_URL}
RUN npm run build

FROM node:22-alpine
WORKDIR /app
# ponytail: `vite preview` (from the build stage's node_modules, so no
# second npm install / network fetch at runtime) serves the static build —
# good enough for this dev-scoped slice; swap for nginx/a real static host
# if this ever needs to be production-hardened (caching headers, gzip).
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/dist ./dist
COPY --from=build /src/vite.config.ts ./vite.config.ts
EXPOSE 4173
ENTRYPOINT ["node_modules/.bin/vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
