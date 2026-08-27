# Discovery Coverage Benchmark — Phase 5C

- **Date:** 2026-08-26
- **Method:** `pnpm discovery:compare` — non-persisting; each source queried
  once per cell with radius 15 km and a 20-result cap; nothing ingested.
- **Sources:** OpenStreetMap (live bounded Overpass query) vs Overture Maps
  places (local regional extract, release `2026-08-19.0`).

This is a **tiny exploratory benchmark, not a statistical coverage study**.
Counts are capped at 20 per source, and "overlap" uses strong signals only
(same normalized website host or same phone number), so two records that are
the same business but carry no shared contact data count as unique.

## Results

| Query | OSM found | Overture found | Strong-signal overlap |
| --- | --- | --- | --- |
| Ogden, UT · roofing | 0 | 20 (86 in extract) | 0 |
| Ogden, UT · plumbing | 3 | 20 (61 in extract) | 0 |
| Ogden, UT · electrician | 0 | 20 (41 in extract) | 0 |
| Ogden, UT · landscaping | 0 | 20 (89+ in extract) | 0 |
| Ogden, UT · restaurant | 20 | 20 (189 in extract) | 0 |
| Salt Lake City, UT · roofing | 3 | 20 | 0 |
| Salt Lake City, UT · plumbing | 3 | 20 | 0 |

"In extract" figures are total category counts inside the 30 km Ogden
regional extract (19,890 places overall; the 25 km Salt Lake City extract
holds 57,181 places).

## Notes

- The first Ogden roofing Overpass request timed out on the public instance
  and was retried once cleanly (result: 0) — consistent with the Phase 5B
  live search, which also found zero Ogden roofers in OSM.
- Zero strong-signal overlap is expected at these caps: each source returns
  a different nearest/arbitrary 20-record subset, and OSM records for
  restaurants and trades rarely carry website/phone tags (3 of 5 Phase 5B
  restaurant records had neither). Overlap here measures *provable* identity,
  not true-business overlap.
- Conclusion: for SaltBox's highest-value local-service categories, Overture
  materially outperforms OSM in this market (0–3 vs capped 20 per query).
  OSM remains useful for volunteer-rich categories and as corroboration.
- $0 was spent; the only network use was bounded Overpass/Nominatim requests
  under the documented etiquette and two one-time bounded S3 extract reads.
