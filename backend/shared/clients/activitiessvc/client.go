// Package activitiessvc is a thin gRPC client wrapper for ActivitiesService,
// used by proxy-service's api layer directly (see GO_STANDARDS.md — proxy
// stays two-layer, handlers call shared/clients, no service layer yet).
package activitiessvc

import (
	"context"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	activitiesv1 "backend/shared/proto/activities/v1"
)

type Client struct {
	conn *grpc.ClientConn
	rpc  activitiesv1.ActivitiesServiceClient
}

// Dial opens a gRPC connection to activities-service at addr. The connection
// is not TLS-secured: all traffic stays inside the compose/cluster network,
// matching activities-service's own server setup (no TLS configured there).
func Dial(addr string) (*Client, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn, rpc: activitiesv1.NewActivitiesServiceClient(conn)}, nil
}

func (c *Client) Close() error {
	return c.conn.Close()
}

func (c *Client) QueryActivities(ctx context.Context, req *activitiesv1.QueryActivitiesRequest) (*activitiesv1.QueryActivitiesResponse, error) {
	return c.rpc.QueryActivities(ctx, req)
}

func (c *Client) SuggestCities(ctx context.Context, req *activitiesv1.SuggestCitiesRequest) (*activitiesv1.SuggestCitiesResponse, error) {
	return c.rpc.SuggestCities(ctx, req)
}
