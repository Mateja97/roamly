FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG EXPO_PUBLIC_PROXY_URL
ARG EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
ENV EXPO_PUBLIC_PROXY_URL=${EXPO_PUBLIC_PROXY_URL}
ENV EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}
RUN npm run export:web

FROM node:22-alpine
WORKDIR /app
# ponytail: `serve` is a static file server, good enough for this dev-scoped
# web-preview target; swap for nginx if this ever needs production hardening.
RUN npm install -g serve
COPY --from=build /src/dist ./dist
EXPOSE 4174
ENTRYPOINT ["serve", "-s", "dist", "-l", "4174"]
