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

## Browser Media Regression

Use Node.js 22 or newer. `npm run compile` builds the checked-in browser client from the locked
`mediasoup-client` dependency; the Docker build also runs this step so server and browser versions stay aligned.

```bash
npm run compile
npm test
npm run test:media
```

Open `http://127.0.0.1:5196` in Chromium and click **Run regression**. This local fixture uses the production
router codecs and orientation-extension filter, a real loopback mediasoup worker, and synthetic canvas/audio
tracks. It never requests camera, microphone, or desktop capture. `MEDIASOUP_WORKER_BIN` can point to a local
worker matching the installed server version if it is not present in `node_modules`.

The six scenarios cover VP8/H.264, camera/audio/screen-first ordering, simultaneous producers, and stopping and
restarting each producer. Passing requires received RTP for audio and decoded frames for each video producer,
including after renegotiation. The structured result is available as `window.testResult`.

This reproduces the Chromium RTP extension collision with client 3.7.17: a video-first offer assigns ID 3 to
`urn:3gpp:video-orientation`, but the old client's answer reuses ID 3 for transport-wide congestion control.
Client 3.23.2 derives sending parameters from the actual offer and passes the regression with server 3.14.16.
After deployment, leave and rejoin existing calls to load the rebuilt client and create fresh transports.
Physical-device permissions, the OS screen picker, and the embedded production flow still need a live retest.

## Embedded call presentation

Remote shared-screen tiles have always-visible **Focus screen** and **Full screen** buttons. Focus fills the current call iframe and exposes **Back to call**. Native fullscreen is requested on the tile including its controls, even when the room is already fullscreen. If denied/unsupported, focus is used instead. A new share is never automatically put into browser fullscreen.

The call widget must declare camera, microphone, and display-capture permissions, and every embedding iframe must delegate them and fullscreen. Budabit provides host-level Enlarge/fullscreen controls without reconnecting the call; the widget also has its own fullscreen-call control. Deploy the updated HiveTalk assets and reload/rejoin the call for the new share actions.

`tests/test-ScreenShareActions.js` covers focus/restore, nested fullscreen requests, and denied-fullscreen fallback. `tests/integration/screen-share-controls.html` is a synthetic visual fixture served by the sibling stream widget's presentation server. It does not access a real screen or microphone.
