# @saltbox/artifact-store

A deliberately tiny, provider-neutral artifact boundary (ADR-003/005). Demo
generation and publication ask for `put`/`get`/`has` against a validated key;
they never know whether the bytes land on disk or in Cloudflare R2.

```text
demo publication
      ↓
ArtifactStore (put/get/has, validated keys)
      ↓
LocalArtifactStore  (.data/demo-assets, development)
R2ArtifactStore     (Cloudflare R2 binding, hosted)
```

- Keys are `demo-assets/<run-ref>/<file>`: lowercase, at most four segments,
  no `..`, no absolute paths, no backslashes. Both implementations validate
  before touching storage, and the local store re-checks the resolved path
  against its root.
- `hashArtifact` uses Web Crypto, so the same code runs in Node and workerd.
- PostgreSQL stores only the resulting metadata (`demo_asset`): content type,
  byte size, SHA-256, provider, and key. Blobs never enter the database.
- `src/r2.ts` describes the R2 binding structurally and imports no Node APIs,
  so no Cloudflare types leak into SaltBox code.

This is not a general storage framework and should not grow into one.
