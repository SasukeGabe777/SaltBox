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
