# @saltbox/discovery

Local, operator-triggered real-business discovery for SaltBox (Phases 5B/5C).
Discovery is a deterministic input adapter; it does not own business identity,
website analysis, scoring, decisions, or prospect lifecycle behavior.

```text
legacy `pnpm discover` path:

human query
  → DiscoverySourceAdapter (openstreetmap | overture)
  → normalized DiscoveryResult
  → existing prospecting ingestion (+ conservative cross-source identity)
  → existing Phase 4 qualification pipeline
  → Phase 5A admin viewer
```

This service performs discovery and analysis only. It does not send email,
SMS, phone calls, social messages, demo links, or any other outreach.

Phase 7 adds a second orchestration path without changing provider adapters or
v1 history:

```text
DiscoverySourceAdapter -> ingestion -> deep website intelligence
  -> FeatureSet v2 -> LeadScore v2 -> Decision v2 -> admin
```

## Sources

Two adapters implement the same `DiscoverySourceAdapter` boundary:

- `OpenStreetMapOverpassAdapter` (`openstreetmap`) — Phase 5B; live bounded
  Overpass queries; best for categories volunteers map well (restaurants).
- `OvertureMapsPlacesAdapter` (`overture`) — Phase 5C; answers queries from a
  bounded local regional extract of the Overture Maps places theme; much
  stronger coverage of small service businesses (roofers, plumbers, HVAC),
  largely via Meta-contributed business pages.

### Overture local extract (required before `--source overture`)

The adapter never queries the internet. Build a git-ignored regional extract
once per area + release (a single bounded read of the public Overture
GeoParquet on S3; no account or API key):

```text
pnpm discovery:data --location "Ogden, UT" --radius-km 30
```

This writes `.data/overture/<area>-r<km>km-<release>.parquet` plus a manifest
recording release, bbox, row count, and retrieval time. Any query whose
circle is fully covered by a manifest is answerable; anything else fails as
`dataset_unavailable` (never a silent empty result). Rebuild on a new machine
or release with the same command — no manually downloaded mystery files.

Extract defaults pin release `2026-08-19.0`; override with `--release`.

### Cross-source identity (`cross-source-identity-v1`)

When a provider identity `(source, external_id)` is unknown, ingestion may
link it to an existing business only on exact strong signals:

- exact normalized registrable website host (IP/localhost never counts), or
- exact phone number (10+-digit numbers compare their final ten digits so
  "+1 801…" and "(801) …" formatting cannot defeat an exact-number match).

If all matched signals agree on exactly ONE business, the record auto-links
and an `entity_match_candidate` row (status `auto_linked`, policy
`cross-source-identity-v1`) records the evidence. If signals point at more
than one business, a separate business is created and pending
`entity_match_candidate` rows are left for review. Name similarity alone
never links or merges anything. False merges are worse than duplicates.

### Comparing coverage (non-persisting)

```text
pnpm discovery:compare --location "Ogden, UT" --category roofing,plumbing --radius-km 15 --limit 20
```

Queries every source for the same bounded query, ingests nothing, and prints
per-source counts plus strong-signal overlap. Results feed
[`docs/DISCOVERY_COVERAGE_BENCHMARK.md`](../../docs/DISCOVERY_COVERAGE_BENCHMARK.md).

## OpenStreetMap source detail

The first adapter is `OpenStreetMapOverpassAdapter`:

- one Nominatim forward-geocode resolves the operator's human location;
- one bounded Overpass radius query returns named OSM objects;
- stable source identity is `<object-type>/<object-id>`;
- bounded OSM tags, retrieval metadata, source locator, adapter version,
  mapping version, and policy research date are retained in `source_record`;
- public business contact endpoints and website URLs are normalized when OSM
  contributors supplied them.

The adapter boundary is defined by `DiscoverySourceAdapter` in `src/types.ts`.
Future permitted datasets can implement location resolution and discovery
without changing Phase 4 qualification.

Source selection research and official-policy links are recorded in
[`docs/DISCOVERY_SOURCE_RESEARCH.md`](../../docs/DISCOVERY_SOURCE_RESEARCH.md).

## Public-service policy boundary

Phase 5B uses donation-supported public infrastructure only for tiny,
explicitly operator-triggered local development searches.

- Nominatim: one request per run, never autocomplete or parallel geocoding.
- Overpass: one geographically and categorically bounded request per run.
- Both receive an identifying User-Agent.
- Result limit defaults to 10 and cannot exceed 25.
- Radius defaults to 10 km and cannot exceed 25 km.
- Overpass retries at most once, with bounded backoff. A 429/406 waits 30
  seconds before that retry; instances are never rotated to evade limits.
- Website qualification concurrency defaults to 2 and cannot exceed 4.
- Location results are cached and reused within a run.

The public endpoints have no SLA and are not approved for deployment,
continuous crawling, commercial production traffic, or nationwide discovery.
Production or recurring discovery must revisit extracts, self-hosting, or a
provider with an appropriate service agreement.

The default development User-Agent is:

```text
SaltBox-Discovery/0.1 (+https://github.com/SasukeGabe777/SaltBox)
```

It can be replaced with another honest identifying value through the
server-side `SALTBOX_DISCOVERY_USER_AGENT` environment variable. Do not
impersonate a browser or crawler.

## Licence and attribution

OpenStreetMap data is available under ODbL 1.0. Wherever OSM-derived records
are displayed, SaltBox shows:

> © OpenStreetMap contributors · ODbL 1.0

and links to <https://www.openstreetmap.org/copyright>. Source and detail views
must not hide this attribution. Database/source metadata also retains the
attribution, licence URL, adapter version, mapping version, and research date.

## Supported categories

`osm-category-mapping-v1` centralizes all provider tag mappings:

| CLI category | SaltBox category | OSM tag |
| --- | --- | --- |
| `roofing` | `roofing` | `craft=roofer` |
| `plumbing` | `plumbing` | `craft=plumber` |
| `electrician` | `electrical` | `craft=electrician` |
| `hvac` | `hvac` | `craft=hvac` |
| `landscaping` | `landscaping` | `craft=landscaper` |
| `restaurant` | `restaurant` | `amenity=restaurant` |
| `coffee` | `restaurant` | `amenity=cafe` |
| `bakery` | `bakery` | `shop=bakery` |
| `auto_repair` | `auto_repair` | `shop=car_repair` |
| `dentist` | `dental` | `amenity=dentist` |

Mappings are explicit and versioned. Source tags are not scattered through
the orchestrator or prospecting service.

## CLI

Prerequisites from the repository root:

```text
pnpm db:up
pnpm db:migrate
```

Run a controlled search:

```text
pnpm discover --category roofing --location "Ogden, UT" --radius-km 10 --limit 5
```

Run the complete Phase 7 flow (safe default limit 3, concurrency 1):

```text
pnpm acquire --category roofing --location "Ogden, UT" --radius-km 10 --limit 3 --source overture --concurrency 1
```

Acquisition caps limit at 10 per source and deep concurrency at 2. Target
analysis failures are persisted and produce `completed_with_target_failures`
with exit 0 by default; add `--strict` for a non-zero CI/debug exit. System,
schema, configuration, source, and globally unavailable Chromium failures
produce `failed`.

Optional flags:

```text
--source openstreetmap
--concurrency 2
```

The command refuses unsupported sources, categories, radius/limit values, and
non-local databases. It emits structured JSON logs to stderr and readable
candidate progress plus a structured run result to stdout.

## Identity, ingestion, and failure behavior

- Exact source identity is database-backed through `(source, external_id)`.
- Rerunning a query reuses the same SourceRecord, Business, Website, contact
  methods, and active/closed Prospect identity.
- New observations, snapshots, analyses, FeatureSets, LeadScores, and Decisions
  append as legitimate history.
- No fuzzy name matching or broad cross-source entity merging is performed.
- A website DNS, TLS, timeout, HTTP, content-type, or missing-site result is a
  business observation and qualification continues.
- One business pipeline system failure is isolated and reported while
  independent candidates continue.
- Location/Overpass failure is classified as a discovery-source failure;
  database failure is a system failure.

The legacy `pnpm discover` analyzer remains homepage/single-page only and
retains all Phase 4 DNS, SSRF, timeout, redirect, content-type, and size
protections. `pnpm acquire` uses the separate bounded Chromium/Lighthouse
analyzer before qualification v2.

## Testing

Standard tests never call live providers. Controlled HTTP responses cover
geocoding, empty/malformed/duplicate results, stable identity, result bounds,
timeouts, rate limits, and server failures. A disposable-PostgreSQL integration
test runs three mocked discoveries through local controlled websites, verifies
mixed qualification decisions and admin visibility, then reruns the query to
prove identity idempotency and append-only history.

Live searches are manual development smoke tests through `pnpm discover`; they
are intentionally excluded from `pnpm test`.

## Cost, privacy, and limitations

- Third-party API cost for Phase 5B: **$0**.
- Only public business facts supplied by OSM or the business homepage are used.
- No people-search enrichment or sensitive personal-data collection exists.
- Provider payloads and HTML are not stored wholesale; only bounded tags,
  structured observations, hashes, and traceability metadata persist.
- OSM is volunteer-maintained and is not a complete catalog. Coverage may be
  especially sparse for roofers, plumbers, HVAC companies, contractors, and
  other small services. Zero results never means zero businesses exist.
- Overture, public registries, customer lists, and additional permitted sources
  are future adapters, not Phase 5B implementations.
