# ElderNexus Web Client

Minimal React chat UI for the ElderNexus backend.

## Hack

The tenant and user are hard-wired right now. So every request sends:
```
X-Tenant-Id: 00000000-0000-0000-0000-000000000001

X-User-Id: 00000000-0000-0000-0000-000000000002
```

## Prerequisites

- Node.js 18+
- Go backend running on port 8080

## Start

```bash
npm install   # first time only
npm run dev
```

Opens at http://localhost:3000. API requests are proxied to the Go backend at `localhost:8080`.


## Stop

Press `Ctrl+C` in the terminal running `npm run dev`.
