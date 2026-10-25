FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /relay .

FROM alpine:3
COPY --from=build /relay /relay
USER nobody
EXPOSE 7890
CMD ["/relay"]
