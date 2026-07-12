FROM golang:1.26.4-alpine AS build
WORKDIR /src
COPY shared ./shared
COPY activities-service/go.mod activities-service/go.sum ./activities-service/
WORKDIR /src/activities-service
RUN go mod download
COPY activities-service/. .
RUN CGO_ENABLED=0 go build -o /out/activities-service ./cmd/activities-service

FROM alpine:3.20
COPY --from=build /out/activities-service /usr/local/bin/activities-service
ENTRYPOINT ["/usr/local/bin/activities-service"]
