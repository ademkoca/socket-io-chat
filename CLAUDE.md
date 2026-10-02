# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The Glasklar chat relay: a socket.io server with no database. Pushing to `main` deploys to Render.

## Commands

Use Yarn 1 (`npx yarn@1.22.22 …`); the global `yarn` is v4 and would rewrite `yarn.lock`.

```bash
npx yarn@1.22.22 install --frozen-lockfile
npx yarn@1.22.22 test                                  # node --test (starts a server on :8899)
node --test --test-name-pattern="typing"              # tests by name (no directory argument)
SOCKET_SECRET=dev-secret npx yarn@1.22.22 start        # :8800 (PORT); refuses to start without SOCKET_SECRET
```

## Architecture

`server.js` exports `createSocketServer({ port, secret, origins })`; `index.js` only reads `PORT`, `SOCKET_SECRET` and `ALLOWED_ORIGINS` (comma-separated) and calls it.

- **Authentication:** an `io.use` middleware verifies `handshake.auth.token`, a JWT issued by `glasklar-api` (`GET /api/auth/socket-token`, signed with the same `SOCKET_SECRET`). The user id comes only from that token, never from client events.
- **Delivery:** each socket joins the room `user:<userId>`, so every tab of a user receives events. `connections` counts sockets per user for the online list.
- **Events** (the names are a contract with the frontend's `pages/chat`; keep the misspelling):
  - `send-message` `{ receiverId, … }` is relayed as `recieve-message` with `senderId` set to the sender's user id. Messages are already saved through the API, so nothing is stored here.
  - `is-typing` `{ receiverId, isTyping }` is relayed as `receive-is-typing` `{ senderId, isTyping }`.
  - `get-users` is broadcast as `[{ userId }]` whenever the online list changes. `new-user-add` is accepted for older clients and only triggers a re-broadcast.
