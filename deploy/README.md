# BudaBit Production Deployment

The production host uses Docker Compose with host networking. HiveTalk binds HTTP and Socket.IO to
`127.0.0.1:3010`; mediasoup binds TCP and UDP `40000-40100` directly on the host and announces
`116.203.126.94`.

## Runtime Environment

Create `/etc/hivetalk-vanilla/hivetalk.env` with mode `0600`. Start from `.env.example`, generate each secret with
`openssl rand -hex 32`, and set both revision values to the full clean production commit:

```dotenv
API_KEY_SECRET=
JWT_KEY=
HIVETALK_IMAGE_TAG=
HIVETALK_REVISION=
```

## Build And Start

```bash
docker compose --env-file /etc/hivetalk-vanilla/hivetalk.env config --quiet
docker compose --env-file /etc/hivetalk-vanilla/hivetalk.env build
docker compose --env-file /etc/hivetalk-vanilla/hivetalk.env up -d --no-build
```

## Nginx And TLS

Install `deploy/nginx/calls.budabit.club.bootstrap.conf` before requesting the first certificate. After DNS resolves
to the host, request the certificate with Certbot, replace the bootstrap site with
`deploy/nginx/calls.budabit.club.conf`, run `nginx -t`, and reload Nginx.

The production log format intentionally records `$uri`, not `$request`, so room passwords and tokens in query
strings are not written to access logs.

## Verification

```bash
curl -fsS -o /dev/null http://127.0.0.1:3010/healthz
curl -fsS http://127.0.0.1:3010/version
docker compose --env-file /etc/hivetalk-vanilla/hivetalk.env ps
docker compose --env-file /etc/hivetalk-vanilla/hivetalk.env logs --no-color
```

Run `tests/integration/socket-security.js` against the local service to verify origin checks, room-prefix checks,
locked-room authorization, and media denial before password acceptance.
