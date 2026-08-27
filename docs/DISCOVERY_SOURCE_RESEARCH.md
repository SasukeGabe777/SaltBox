# Discovery Source Research

## Phase 5C — Discovery Coverage Expansion (2026-08-26)

- **Scope:** add ONE complementary business-discovery source to close the
  service-business coverage gap Phase 5B measured (real restaurants found;
  zero roofers/plumbers in OSM for Ogden despite correct queries).
- **Decision:** Overture Maps Places through a bounded local regional extract
  queried with DuckDB. OpenStreetMap/Overpass remains the second source.

### Candidates evaluated (official sources only)

#### Overture Maps Places — SELECTED

- **Availability:** actively published; monthly GeoParquet releases on public
  S3/Azure (current release `2026-08-19.0`,
  `s3://overturemaps-us-west-2/release/<release>/theme=places/type=place/*`).
  No account, token, or API key is required.
- **Size/coverage:** ~74M place records; Meta (Facebook business pages)
  contributes ~58M, plus Microsoft, Foursquare OS Places, and smaller
  providers. Small local service businesses (roofers, plumbers, HVAC) very
  frequently exist as Facebook pages, which is exactly the coverage OSM lacks.
- **Categories:** the Overture Place Categories taxonomy (~2,300 codes)
  includes `roofing`, `plumbing`, `electrician`, `hvac_services`,
  `landscaping`, `painting`, `masonry_concrete`, `pest_control_service`,
  `tree_services`, `restaurant`, `cafe`, `bakery`, `automotive_repair`,
  `dentist`, and more (official taxonomy CSV in the OvertureMaps/schema repo).
- **Fields:** `names.primary`, `categories.primary/alternate`,
  `addresses[]` (freeform/locality/region/postcode/country), `websites[]`,
  `phones[]`, `emails[]`, `socials[]`, `confidence` (0–1), per-record
  `sources[]` (dataset + original record id), `operating_status`.
- **Stable identity:** GERS IDs, designed to be stable across releases
  (July 2026 re-conflation caused one-time churn; stability is a design goal).
- **Access method:** bulk GeoParquet with bbox column statistics; standard
  practice is DuckDB with a bounding-box filter, or a downloaded regional
  subset. No request/rate-limit regime because it is a dataset, not an API.
- **Cost:** $0 (open data on public buckets; a small one-time regional
  download per release).
- **Licence:** places theme is CDLA Permissive 2.0 (Meta, Microsoft, and
  other providers) + Apache 2.0 (Foursquare-derived) + CC0 (AllThePlaces).
  No ODbL share-alike obligations — the places theme contains no OSM data.
  Commercial use and redistribution are permitted with licence notice
  preserved; no copyleft on derived databases.
- **Attribution:** recommended citation "Overture Maps Foundation,
  overturemaps.org". SaltBox displays it wherever Overture-derived records
  appear, alongside the licence names.
- **Risks:** monthly release lifecycle (data can lag reality), conflation
  errors, stale/closed places (`operating_status` + `confidence` help),
  evolving taxonomy, and per-release extract refresh responsibility.
- **Official sources:**
  [Places guide](https://docs.overturemaps.org/guides/places/),
  [place schema](https://docs.overturemaps.org/schema/reference/places/place/),
  [attribution & licensing](https://docs.overturemaps.org/attribution/),
  [taxonomy](https://docs.overturemaps.org/guides/places/taxonomy/), and the
  [official category CSV](https://github.com/OvertureMaps/schema/blob/main/docs/schema/concepts/by-theme/places/overture_categories.csv).

#### Foursquare Open Source Places — not selected

- ~100M POIs under Apache 2.0 and still maintained, but distribution moved
  (March 2026) from the public S3 bucket to the Foursquare Places Portal,
  which requires account signup and access tokens (Iceberg catalog). That adds
  an account/token dependency for data that is already conflated INTO the
  Overture places theme under Apache 2.0. Selecting Overture obtains the
  Foursquare coverage without the portal dependency.
  Official: [FSQ OS Places docs](https://docs.foursquare.com/data-products/docs/access-fsq-os-places).

#### OpenStreetMap / Overpass — retained as existing baseline

- Already implemented (Phase 5B). Free, ODbL, stable `node/way/relation`
  identity, but measured coverage of small service contractors is weak.
  Retained as a corroborating source and for categories where volunteer
  coverage is good (restaurants, cafes). Public-instance etiquette from the
  Phase 5B research below remains binding.

#### Utah DOPL / Construction Business Registry (government data) — deferred

- Utah's Division of Professional Licensing runs the free Construction
  Business Registry (db.dopl.utah.gov/cbr) with contact information for all
  licensed construction professionals — in principle excellent contractor
  coverage. But there is no documented self-serve bulk download or stable
  programmatic API (bulk data goes through a records-request process), the
  data is Utah-only, and records generally lack websites. A credible future
  adapter after an official bulk-access path is confirmed; not implementable
  as this phase's dataset without scraping their search UI, which we will not
  do. Official: [DOPL records](https://dopl.utah.gov/records/),
  [CBR](https://commerce.utah.gov/dopl/construction-business-registry).

#### Self-hosted OSM / regional extracts — still deferred

- Unchanged from Phase 5B: the responsible path for high-volume OSM use, but
  it cannot fix OSM's underlying contractor coverage gap, which is the
  problem this phase addresses.

### Weighted selection scoring

Weights per the phase directive. Scores 0–5.

| Criterion (weight) | Overture | FSQ OS Places | OSM (baseline) | Utah DOPL |
| --- | --- | --- | --- | --- |
| Service-business coverage (30%) | 5 | 4 | 1 | 4 (UT contractors only) |
| $0 / low initial cost (20%) | 5 | 5 | 5 | 5 |
| Legal/licensing suitability (20%) | 5 | 5 | 4 (ODbL share-alike) | 3 (bulk access unclear) |
| Stable identifiers / provenance (10%) | 4 (GERS) | 4 | 5 | 4 (licence #) |
| Website/contact fields (10%) | 5 | 4 | 2 | 1 |
| Technical simplicity (5%) | 3 (DuckDB layer) | 2 (portal+tokens) | 4 | 1 (no API) |
| Future scale potential (5%) | 5 | 4 | 3 | 2 |
| **Weighted total** | **4.75** | **4.35** | **3.20** | **3.35** |

**Selected: Overture Maps Places.** Best coverage of exactly the categories
SaltBox values most (Meta-derived small-business pages), permissive licences,
no account or rate-limit regime, stable GERS identity, and a practical $0
local access path.

### Phase 5C access strategy

Do **not** import the planet into PostgreSQL. A bounded regional extract is
built once per area+release with DuckDB reading the public GeoParquet
(bbox-filtered, place type only, selected columns), stored under the
git-ignored `.data/overture/` directory with a manifest (release, bbox, row
count, retrieval time). The discovery adapter answers queries from that local
extract; PostgreSQL remains the authoritative CRM store and receives only the
few normalized candidates an operator-triggered search returns.

---

# Phase 5B Discovery Source Research

- **Research date:** 2026-08-26
- **Scope:** local-only, operator-triggered development searches of at most 25
  results; no deployment, continuous crawling, outreach, or paid service
- **Decision:** OpenStreetMap data through one bounded Overpass request, with
  one Nominatim request used only to resolve the operator's human location

Provider policies and availability can change. Recheck the linked official
material before deployment, higher-volume use, or a commercial launch.

## Decision criteria

The first source must cost $0 for Phase 5B, expose stable provider identities,
support small geographically bounded business searches, preserve provenance,
permit compliant use, and remain replaceable through a SaltBox-owned adapter.
It must not require scraping a commercial directory or evading access controls.

## Candidate review

### OpenStreetMap data through Overpass API — selected for the MVP

- **Data available:** tagged OpenStreetMap nodes, ways, and relations,
  including names, categories, coordinates, addresses, business contact tags,
  and websites where contributors have recorded them.
- **Stable external identity:** OSM object type plus numeric object ID, for
  example `node/123` or `way/456`. Search order and business names are not used
  as identity.
- **Cost:** OpenStreetMap data has no licence fee. The main public Overpass
  instance is donation-supported and free for appropriate small use.
- **Official operational limits:** the public-instance guidance says free
  servers are for small projects, identifies under 10,000 queries and under
  1 GB/day as a one-off safe envelope, and says regular applications should
  stay below roughly 100 queries and 10 MB/day. It requires an identifying
  User-Agent or Referer, caching/rate limiting, no parallel scripts, and a
  pause after 429/406 responses. It warns the public service is overloaded and
  that production/commercial users should self-host or use a paid provider.
  SaltBox Phase 5B performs one small request per explicit CLI run, never
  rotates instances, and is not a production use.
- **Licence/attribution:** OSM data is distributed under ODbL 1.0. Publicly
  displayed OSM-derived records must visibly credit OpenStreetMap and provide
  access to the licence/source information. SaltBox uses the linked attribution
  `© OpenStreetMap contributors · ODbL 1.0`.
- **Suitability:** good for a $0 proof of real, spatially bounded discovery;
  Overpass directly supports filtered `node`/`way`/`relation` queries.
- **Risks:** volunteered data is incomplete, uneven, occasionally stale, and
  not a comprehensive business directory. Public Overpass has no availability
  guarantee and is unsuitable for autonomous or production-scale collection.
  Missing results do not mean missing businesses.
- **Official sources:**
  [Overpass API and current public-instance policy](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances),
  [Overpass resource guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html),
  [OSM copyright and licence](https://www.openstreetmap.org/copyright), and
  [OSMF attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).

### Nominatim public service — selected only for one location lookup

- **Data available:** forward geocoding from an operator-entered location to a
  coordinate and address context. Nominatim is not the business-discovery
  source in this design.
- **Stable external identity:** results include OSM object references where
  available, but SaltBox uses the selected result only as a search center.
- **Cost:** $0 for this limited public endpoint use.
- **Official operational limits:** absolute maximum one request per second;
  valid application-identifying User-Agent or Referer; visible attribution;
  caching; no client autocomplete; no systematic grid queries; no details-page
  scraping; and no heavy or recurring bulk geocoding. The service must be
  replaceable without a software redesign.
- **Suitability:** one directly operator-triggered forward-geocode per run is a
  narrow, policy-aligned use. The result is cached and reused throughout that
  run, and geocoding is never parallelized.
- **Risks:** donated service with changeable policy and no production SLA.
  SaltBox must replace or self-host it before production/high-volume use.
- **Official sources:**
  [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/),
  [search API](https://nominatim.org/release-docs/latest/api/Search/), and
  [result formats](https://nominatim.org/release-docs/latest/api/Output/).

### Raw OpenStreetMap regional extracts / self-hosted Overpass

- **Data available and identity:** the same OSM dataset and stable object
  identities without depending on a public query service.
- **Cost:** data licence cost is $0, but local storage, updates, compute, and
  operations are not free in practical terms.
- **Limits/attribution:** ODbL and attribution still apply; locally operated
  infrastructure owns its resource policy.
- **Suitability:** the responsible direction for recurring or commercial OSM
  discovery, but disproportionate for two five-result Phase 5B smoke searches.
- **Decision:** defer until measured discovery value justifies the operational
  footprint.

### Overture Maps Places

- **Data available:** a global monthly places dataset containing businesses and
  other physical destinations, with names, categories, geometry, source data,
  and stable GERS identities.
- **Identity/licence:** GERS IDs are designed as stable cross-release
  identifiers. The Places theme currently combines source data published under
  CDLA Permissive 2.0 and Apache 2.0; source-specific licensing and attribution
  metadata must remain intact.
- **Cost:** dataset access and licences are $0, but this is bulk cloud-hosted
  data rather than a small public search API. Querying normally uses DuckDB,
  the Overture CLI, or downloads/range reads over monthly releases.
- **Suitability:** promising for a later batch adapter and potentially broader
  business coverage, but adds a bulk-data/runtime boundary and more complex
  per-source traceability than this controlled MVP needs.
- **Risks:** large global dataset, monthly release lifecycle, evolving category
  taxonomy, upstream conflation, and multi-source licence metadata.
- **Decision:** defer; do not combine sources in Phase 5B.
- **Official sources:**
  [Overture Places guide](https://docs.overturemaps.org/guides/places/) and
  [cloud data access](https://docs.overturemaps.org/getting-data/cloud-sources/).

## Phase 5B decision

Use a provider-neutral SaltBox discovery boundary with an
`OpenStreetMapOverpassAdapter`. For each explicit CLI run:

1. Resolve the human location with one Nominatim request.
2. Issue one radius- and category-bounded Overpass request.
3. Normalize at most the requested count, never exceeding 25.
4. Preserve OSM object identity, source locator, retrieval time, bounded tags,
   adapter version, retrieval method, and policy research date.
5. Feed normalized results into the existing Phase 4 ingestion and
   qualification pipeline.

This selection is authorized only for local Phase 5B development proof. It is
not approval for production, unattended crawling, commercial use of donated
public endpoints, or removal of attribution. A production discovery phase must
revisit self-hosting, extracts, or a provider with an appropriate service
agreement.
