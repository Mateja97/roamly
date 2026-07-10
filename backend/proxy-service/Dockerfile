FROM golang:1.26.4-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/proxy-service ./cmd/proxy-service

FROM alpine:3.20
COPY --from=build /out/proxy-service /usr/local/bin/proxy-service
ENTRYPOINT ["/usr/local/bin/proxy-service"]
