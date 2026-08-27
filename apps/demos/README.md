# @saltbox/demos

The SaltBox demo renderer: **one** lightweight loopback HTTP server that
renders **many** prospect demos from persisted `Demo`/`DemoVersion` state.
Architecture and safety posture: [`docs/DEMO_GENERATION.md`](../../docs/DEMO_GENERATION.md).

```powershell
pnpm demos:dev        # http://127.0.0.1:5175/ (loopback only)
pnpm demo:qa --token <public-locator>   # Chromium desktop/mobile sanity checks + screenshots
```

- `GET /d/<public-locator>` resolves an opaque, revocable locator token to the
  demo's current persisted version and renders it with the registered
  template (`server/templates/local-service-v1.ts`). Internal IDs never
  appear in URLs and the index never enumerates demos.
- Every response is `noindex, nofollow` + `no-store` with a strict CSP
  (`default-src 'none'`, `form-action 'none'`) — the demo contact form cannot
  submit anywhere. Pages are fully self-contained: no external requests,
  fonts, scripts, or images.
- Templates consume the `demo-content-v1` contract only (escaped plain text);
  no database rows or prospect HTML reach rendering code.
- Configuration: `SALTBOX_DEMOS_PORT` (default 5175); the admin builds VIEW
  DEMO links from `SALTBOX_DEMOS_BASE_URL`.
- The server binds to 127.0.0.1 and must not be exposed externally without
  authentication in front of it.

QA screenshots are written to git-ignored `.data/demos/qa/<locator>/`.
