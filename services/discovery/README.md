# @saltbox/discovery

Local, operator-triggered real-business discovery for SaltBox Phase 5B.
Discovery is a deterministic input adapter; it does not own business identity,
website analysis, scoring, decisions, or prospect lifecycle behavior.

```text
human query
  → DiscoverySourceAdapter
  → normalized DiscoveryResult
  → existing prospecting ingestion
  → existing Phase 4 qualification pipeline
  → Phase 5A admin viewer
```

This phase performs discovery and analysis only. It does not send email, SMS,
phone calls, social messages, demo links, or any other outreach.

## Selected source

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

The website analyzer remains homepage/single-page only and retains all Phase 4
DNS, SSRF, timeout, redirect, content-type, and size protections.

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
