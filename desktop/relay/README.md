# Constellation Commander relay

The relay is the stable public HTTPS half of Constellation Commander. ChatGPT's plugin talks to `/mcp`; paired PCs make outbound HTTPS long-poll connections to `/device/poll` and return tool results to `/device/result`.

## Required production settings

- `PUBLIC_BASE_URL=https://your-stable-hostname.example`
- `CONSTELLATION_RELAY_OWNER_PASSWORD=<strong private password>`
- `CONSTELLATION_RELAY_DATA=/data` on persistent storage
- `PORT=8787` (or your platform's assigned port)
- TLS must terminate at the hosting platform or reverse proxy.

No OpenAI API key is used by the relay or device agent. The relay has diagnostics counters but no tool-call quota.

## Security model

- ChatGPT -> relay: OAuth 2.1 authorization code + PKCE S256.
- Relay -> PC: the PC initiates the connection; no inbound PC port is exposed.
- Device tokens are random bearer credentials and are stored as hashes by the relay.
- ChatGPT access/refresh tokens are opaque, random, resource-bound relay credentials.
- Pairing and OAuth authorization both require the relay owner password.
- Device tool execution still applies the local Commander's allowed-roots and blocked-command policy.

## Endpoints

- `GET /health`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`
- `POST /oauth/register`
- `GET|POST /oauth/authorize`
- `POST /oauth/token`
- `POST /mcp`
- `POST /device/pair/start`
- `GET|POST /device/verify`
- `POST /device/pair/token`
- `POST /device/poll`
- `POST /device/result`

A temporary tunnel is useful only for development. Public plugin submission requires a stable public HTTPS endpoint, so Commander intentionally does not treat a quick tunnel as the finished product.
