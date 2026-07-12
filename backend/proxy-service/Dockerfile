FROM golang:1.26.4-alpine AS build
WORKDIR /src
COPY shared ./shared
COPY proxy-service/go.mod proxy-service/go.sum ./proxy-service/
WORKDIR /src/proxy-service
RUN go mod download
COPY proxy-service/. .
RUN CGO_ENABLED=0 go build -o /out/proxy-service ./cmd/proxy-service

FROM alpine:3.20
COPY --from=build /out/proxy-service /usr/local/bin/proxy-service
ENTRYPOINT ["/usr/local/bin/proxy-service"]
