# Ingestion Plan — County GIS Data Pipeline

> Pure planning document. No code. Covers DuPage + Cook County GIS data into Postgres/PostGIS, Neo4j, and Pinecone.
> Every step is idempotent — re-running any step must be safe.

---

## Execution Order At a Glance

| Step | Name | Depends On | Can Run In Parallel With |
|------|------|------------|--------------------------|
| 1 | Seed counties + municipalities | Nothing | Nothing |
| 2 | Layer discovery | Step 1 | Nothing |
| 3 | Parcel ingestion | Step 2 | Step 8 |
| 4 | Spatial join — set municipality_id on parcels | Step 3 + Step 5a | Step 8 |
| 5a | Overlay ingest — municipalities layer only | Step 2 | — |
| 5b | Overlay ingest — flood zones layer | Step 2 | Steps 3, 8 |
| 5c | Overlay ingest — all remaining layers | Step 2 | Steps 3, 8 |
| 6 | Derived update — set flood_zone on parcels | Steps 3 + 5b | Step 8 |
| 7 | Neo4j graph population | Steps 3, 4 | Steps 8, 9 |
| 8 | Municipal zoning scraping | Step 1 | Steps 3–7 |
| 9 | Embedding + Pinecone upsert | Step 8 | Step 7 |
| 10 | Verification | All steps | Nothing |

---

## Global Constraints (Apply to Every Step)

- **Concurrency cap:** Never more than 3 simultaneous outbound ArcGIS HTTP requests. Global cap shared across all jobs.
- **Inter-request delay:** 200ms minimum between any two ArcGIS requests, enforced via a shared request queue.
- **Idempotency:** Every write uses upsert logic (insert or update on natural key). Re-running any step is safe.
- **Error logging:** All errors write to `ingestion_jobs.error_log` as a JSON array `[{offset, error, timestamp}]`. No silent failures.
- **Retry policy:** 3 retries with 2-second wait on transient errors (5xx, timeout). Log 4xx errors and skip the record, count in `records_failed`.
- **Geometry SRID:** All geometries stored in EPSG:4326 (WGS84). Convert any non-4326 source geometries at ingest time using the source SRID from ArcGIS layer metadata.
- **Data hash:** MD5 of the raw attributes JSON string (keys sorted alphabetically before hashing). Used for skip-unchanged logic in Steps 3 and 5.

---

## Step 1 — Seed Counties and Municipalities

**What it does:** Inserts the two known counties and four target municipalities as the root reference data.

**Tables written:**
- `counties` — 2 rows inserted

| id | name | state | fips | gis_base_url | portal_type |
|---|---|---|---|---|---|
| dupage | DuPage County | IL | 17043 | https://gis.dupageco.org/arcgis/rest/services | arcgis |
| cook | Cook County | IL | 17031 | https://gis12.cookcountyil.gov/arcgis/rest/services | arcgis |

Cook County's `metadata` field stores the fallback URLs: Open Data Hub (`hub-cookcountyil.opendata.arcgis.com`) and Socrata (`datacatalog.cookcountyil.gov`) since the primary ArcGIS server is unreachable.

- `municipalities` — 4 rows inserted

| id | county_id | name | zoning_source | zoning_url |
|---|---|---|---|---|
| wheaton | dupage | Wheaton | pdf_direct | https://www.wheaton.il.us/584/Zoning-Ordinances |
| naperville | dupage | Naperville | municode | https://library.municode.com/il/naperville |
| chicago | cook | Chicago | amlegal | https://codelibrary.amlegal.com/codes/chicagoil/latest/ |
| evanston | cook | Evanston | municode | https://library.municode.com/il/evanston |

**How writes are done:** `INSERT ... ON CONFLICT DO NOTHING` — safe to re-run.

**Ordering dependency:** None. This is the root step.

---

## Step 2 — Layer Discovery

**What it does:** Enumerates every available GIS data layer for both counties and writes one row per layer into `data_layers`.

**Two phases run per county:**

**Phase A — DCAT feed (Open Data Portal)**
- Fetch `https://gisdata-dupage.opendata.arcgis.com/api/feed/dcat-us/1.1.json` — single JSON file, no pagination
- Each dataset entry in the feed has a name, description, and `accessURL` pointing to a FeatureServer or MapServer
- Some of these URLs point to `services.arcgis.com` (not the county server) — both are valid

**Phase B — ArcGIS REST walk (county server)**
- Fetch `https://gis.dupageco.org/arcgis/rest/services?f=json` — returns all folders
- For each folder, fetch `/{folder}?f=json` — returns services in that folder
- For each service, fetch `/{folder}/{service}/MapServer/layers?f=json` — returns all layer IDs and names in one call
- Merge Phase A and Phase B results, deduplicate by `service_url`

**Tables written:**
- `data_layers` — one row per discovered layer with `county_id`, `layer_name`, `layer_type`, `service_url`, empty `field_mapping` (to be populated manually for parcel layer)
- `ingestion_jobs` — one row per county, `job_type = 'layer_discovery'`, updated to `completed` when done

**How writes are done:** `INSERT ... ON CONFLICT (county_id, layer_name) DO UPDATE SET service_url = excluded.service_url` — refreshes URL on re-run.

**Layers expected for DuPage (confirm these are present after this step):**
- `DuPage_County_IL/ParcelsWithRealEstateCC/FeatureServer/0`
- Flood zones (Stormwater/SpecialFloodHazardAreasDuPage)
- Wetlands (NaturalAreas/Wetlands_Inventory)
- Zoning (Zoning/UnincorporatedZoningData)
- School Districts (DuPage_County_IL/Grade_School_Districts, High_School_Districts)
- Municipalities / Boundaries
- Soils (Environmental/HydricSoils2024)
- Roads (Transportation/Road_Centerlines)

**Ordering dependency:** Step 1 must be complete (county_id FK needed).

**Rate limiting:** 3-concurrent / 200ms delay applies from this step onward.

---

## Step 3 — Parcel Ingestion

**What it does:** Fetches all parcel records from each county's parcel FeatureServer, normalizes fields, and upserts into the county parcel table.

**Source URLs:**
- DuPage: `https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/ParcelsWithRealEstateCC/FeatureServer/0/query`
- Cook: resolved from `data_layers` (Socrata fallback if ArcGIS server is unreachable)

**Query parameters on every page request:**
```
where=1=1
outFields=*
returnGeometry=true
outSR=4326
f=json
resultRecordCount=1000
resultOffset={N}
```

**Pagination loop (line by line):**
1. Set `resultOffset = 0`, `pageSize = 1000`
2. Fetch page
3. If `features` array is empty → done
4. For each feature: compute `data_hash = MD5(sort_keys(attributes_json))`
5. If `pin` exists in DB and `data_hash` matches → skip (no write)
6. If `pin` exists but `data_hash` differs → UPDATE all fields, set `last_updated_at = now()`
7. If `pin` does not exist → INSERT
8. After processing all features in the page, bulk upsert the whole page in one DB call
9. Update `ingestion_jobs.records_processed` every 10 pages
10. Increment `resultOffset += 1000`, go to step 2
11. DuPage: expect 338 pages (337,072 records)

**Field normalization for DuPage (source field → our column):**
- `PIN` → `pin`
- `PROPSTNUM + ' ' + PROPSTNAME + ', ' + PROPCITY` → `address`
- `BILLNAME` → `owner_name`
- `BILLADDRL1 + ', ' + BILLCITY + ', ' + BILLSTATE + ' ' + BILLZIP` → `owner_address`
- `LEGALDES1` through `LEGALDES9` concatenated → `legal_description`
- `REA017_PROP_CLASS` → `land_use_code`
- `REA017_FCV_TOTAL` → `assessed_value`
- `REA017_FCV_LAND` → `land_value`
- `REA017_FCV_IMP` → `building_value`
- `ACREAGE × 43560` → `lot_area_sqft`
- `OWNERSHIP_TYPE` → `ownership_type` (normalize to `individual | corporate | trust | government`)
- `SHAPE` → `geometry` (PostGIS polygon in EPSG:4326)
- All remaining fields → `raw_attributes` JSONB

**Fields left NULL at this stage (populated later):**
- `municipality_id` — set in Step 4
- `flood_zone` — set in Step 6

**Tables written:**
- `parcels_dupage` or `parcels_cook` — upserted per parcel
- `ingestion_jobs` — one row per county, `job_type = 'parcel_ingest'`

**Ordering dependency:** Step 2 must be complete.

**Performance notes:**
- Bulk upsert 1000 records per page — do not do 1000 individual inserts per page
- 338 pages × 200ms delay = ~68 seconds minimum for DuPage alone (network delay only)
- Total wall time estimate: 10–20 minutes for DuPage including parse and write

---

## Step 4 — Spatial Join: Set municipality_id on Parcels

**What it does:** Runs a PostGIS query to match each parcel's geometry against the ingested municipality boundary polygons and writes `municipality_id` on each matched parcel row.

**Precondition:** At least one row in `spatial_features` with `layer_type = 'municipality'` for the county must exist. If not, halt.

**SQL logic (described, not written here):**
1. For every parcel where `municipality_id IS NULL`
2. Find the `spatial_features` row where `layer_type = 'municipality'` AND `ST_Intersects(parcel.geometry, feature.geometry) = true`
3. Extract municipality name from `feature.attributes` JSON
4. Look up `municipalities.id` by name + county
5. Set `parcel.municipality_id = municipalities.id`
6. Where a parcel touches multiple boundaries (rare, boundary overlap), pick the one with the largest intersection area via `ST_Area(ST_Intersection(...))`
7. Parcels with no match remain `municipality_id = NULL` (these are unincorporated)
8. Run as a single bulk `UPDATE ... FROM ... WHERE` — not row-by-row

**Tables written:**
- `parcels_dupage.municipality_id` — updated
- `parcels_cook.municipality_id` — updated

**Ordering dependency:** Step 3 must be complete AND Step 5a (municipalities overlay) must be complete.

**Performance notes:** Pure SQL. GIST spatial index on both geometry columns required. ~337k parcels should complete in under 2 minutes with indexes.

---

## Step 5 — Overlay Layer Ingestion

**What it does:** Fetches every non-parcel GIS layer discovered in Step 2 and writes geometries + attributes into `spatial_features`.

**Same ArcGIS paginated query pattern as Step 3** (same parameters, same delta logic with `data_hash`).

**Output per feature:**
- `county_id` — from which county
- `layer_id` — FK to `data_layers` row
- `layer_type` — `'flood_zone'` | `'wetland'` | `'zoning'` | `'school_district'` | `'municipality'` | `'soil'` | `'road'` | `'misc'`
- `feature_id` — original OBJECTID from ArcGIS
- `geometry` — PostGIS geometry in EPSG:4326
- `attributes` — raw JSON of all source fields
- `data_hash` — MD5 of attributes (for delta)

**Run order within Step 5 (priority matters):**

**5a — Municipalities layer** (must run first — Step 4 depends on it)
- DuPage: `https://services.arcgis.com/neJvtQ4PXvnQ86MJ/arcgis/rest/services/Municipalities/FeatureServer/0`
- Write with `layer_type = 'municipality'`

**5b — Flood zones layer** (run second — Step 6 depends on it)
- DuPage: `Stormwater/SpecialFloodHazardAreasDuPage/MapServer/0` and `/1`
- Write with `layer_type = 'flood_zone'`
- Key attributes to preserve in `attributes` JSON: `FLD_ZONE`, `FLOODWAY`, `STATIC_BFE`

**5c — All remaining layers** (can run after 5a + 5b, order among themselves doesn't matter)
- Wetlands → `layer_type = 'wetland'`
- Unincorporated Zoning → `layer_type = 'zoning'`
- Grade + High School Districts → `layer_type = 'school_district'`
- Hydric Soils → `layer_type = 'soil'`
- Road Centerlines → `layer_type = 'road'`
- Lakes/Ponds, Rivers, Subdivisions, ROW, etc. → `layer_type = 'misc'`

**Tables written:**
- `spatial_features` — upserted per feature
- `ingestion_jobs` — one row per layer, `job_type = 'overlay_ingest'`

**Ordering dependency:** Step 2 must be complete. 5a before Step 4. 5b before Step 6.

**Performance notes:** Overlay layers are much smaller than parcels (hundreds to low thousands of features). Each layer should complete in seconds. Run at most 3 layers concurrently to stay within the global request cap.

---

## Step 6 — Derived Update: Set flood_zone on Parcels

**What it does:** Spatially joins ingested flood zone polygons against parcel geometries and stamps each parcel with its FEMA flood zone code.

**Precondition:** At least one `spatial_features` row with `layer_type = 'flood_zone'` must exist for the county.

**SQL logic (described):**
1. JOIN `parcels_dupage` with `spatial_features` on `ST_Intersects(parcel.geometry, feature.geometry)` WHERE `feature.layer_type = 'flood_zone'`
2. Extract `FLD_ZONE` from `feature.attributes` JSON
3. Set `parcel.flood_zone = FLD_ZONE`
4. Where a parcel intersects multiple flood zone polygons, use highest-risk zone (priority: `AE > AH > AO > A > X500 > X`)
5. Parcels outside all flood zones remain `flood_zone = NULL`
6. Run as single bulk `UPDATE ... FROM ... WHERE`

**Tables written:**
- `parcels_dupage.flood_zone` — updated
- `parcels_cook.flood_zone` — updated

**Ordering dependency:** Step 3 (parcels exist) and Step 5b (flood zones ingested) must both be complete.

**Performance notes:** Pure SQL. Same GIST index notes as Step 4.

---

## Step 7 — Neo4j Graph Population

**What it does:** Reads from Postgres and writes lightweight nodes + relationships into Neo4j to enable ownership traversal, district membership queries, and parcel adjacency.

**Neo4j nodes created:**

| Node Label | Properties | Source |
|---|---|---|
| `(:County)` | id, name, state | `counties` table |
| `(:Municipality)` | id, name, county_id | `municipalities` table |
| `(:Parcel)` | pin, address, assessed_value, flood_zone, zoning_code, county | `parcels_dupage` / `parcels_cook` |
| `(:Owner)` | name, address | derived from `owner_name` + `owner_address`, deduplicated |
| `(:ZoningDistrict)` | id, district_code, category | `zoning_districts` (Step 8 must run first for full coverage) |
| `(:TaxDistrict)` | name, type | derived from `raw_attributes` district fields on parcels |

**Neo4j relationships created:**

| Relationship | From → To | Source |
|---|---|---|
| `OWNS` | Owner → Parcel | `owner_name` + `owner_address` on parcel row |
| `LOCATED_IN` | Parcel → Municipality | `parcels.municipality_id` |
| `ZONED_AS` | Parcel → ZoningDistrict | `parcels.zoning_code` matched to `zoning_districts.district_code` |
| `IN_DISTRICT` | Parcel → TaxDistrict | district fields from `raw_attributes` (school, fire, park, library) |
| `ADJACENT_TO` | Parcel ↔ Parcel | PostGIS `ST_Touches(a.geometry, b.geometry)` query on Postgres, results written as Neo4j edges |
| `HAS_MUNICIPALITY` | County → Municipality | `municipalities.county_id` |

**Write strategy (line by line):**
1. Create Neo4j indexes on `:Parcel(pin)`, `:Owner(name)`, `:Municipality(id)`, `:ZoningDistrict(district_code)` before any writes
2. Write `(:County)` and `(:Municipality)` nodes first (small, fast)
3. Stream `parcels_dupage` rows from Postgres in batches of 500
4. For each batch: MERGE `(:Owner)` nodes, MERGE `(:Parcel)` nodes, CREATE `OWNS` and `LOCATED_IN` relationships — all in one `UNWIND` Cypher call
5. Repeat for `parcels_cook`
6. Write `ZONED_AS` edges after Step 8 completes (or skip and backfill)
7. For adjacency: run `SELECT a.pin, b.pin FROM parcels_dupage a JOIN parcels_dupage b ON ST_Touches(a.geometry, b.geometry) AND a.pin < b.pin` in Postgres, stream result pairs to Neo4j in batches of 500 as `ADJACENT_TO` edges

**Tables read:** `counties`, `municipalities`, `parcels_dupage`, `parcels_cook`, `zoning_districts`

**Ordering dependency:** Steps 3 and 4 must be complete. Step 8 optional (ZONED_AS can be backfilled).

**Performance notes:**
- Use `UNWIND` in Cypher for batch writes — never one query per row
- Owner deduplication: normalize `owner_name` to `UPPER(TRIM(name))` before MERGE
- Adjacency edges are expensive — limit to parcels within the same municipality on first pass
- Adjacency query on 337k parcels will return millions of pairs — stream from Postgres cursor, don't load all into memory

---

## Step 8 — Municipal Zoning Scraping

**What it does:** Scrapes the zoning ordinance for each municipality and writes structured data + raw text chunks.

**Tables written (all scrapers):**
- `zoning_districts` — one row per zoning district code found
- `permitted_uses` — one row per use entry per district (`by_right | conditional | prohibited | accessory`)
- `development_standards` — one row per standard per district (`min_lot_sqft | front_setback_ft | rear_setback_ft | side_setback_ft | max_height_ft | max_lot_coverage_pct | floor_area_ratio | max_density | min_lot_width_ft`)
- `document_chunks` — one row per text chunk, with `municipality_id`, `district_id` (if identifiable), `section_id`, `source_url`
- `ingestion_jobs` — one row per municipality, `job_type = 'zoning_scrape'`

**Ordering dependency:** Step 1 must be complete (municipality_id FKs needed). Can run in parallel with Steps 3–7.

---

### 8a — Wheaton (34 Direct PDFs)

**Source:** `https://www.wheaton.il.us/DocumentCenter/View/{ID}` for IDs 1084–1115 and 17507, 17921

**Process line by line:**
1. Iterate known chapter IDs (confirmed from API_INVENTORY.md)
2. HTTP GET each PDF URL with 200ms delay between requests
3. Parse PDF binary with `pdf-parse` → raw text per page
4. Chunk text at ~500 tokens with 50-token overlap, prefer paragraph breaks
5. Regex-match zoning district codes (`R-1`, `B-2`, `M-1` etc.) in chunk headers to assign `district_id`
6. Write each chunk to `document_chunks`
7. From tables within the PDF text, extract: district definitions → `zoning_districts`, use lists → `permitted_uses`, dimensional standards → `development_standards`
8. All writes use `municipality_id = 'wheaton'`

---

### 8b — Naperville (Municode, Playwright)

**Source:** `https://library.municode.com/il/naperville`

**Process line by line:**
1. Launch Playwright headless Chromium
2. Navigate to Naperville Municode zoning chapter URL
3. Expand the table of contents tree to enumerate all article + section links
4. For each section: navigate to page, wait for content div, extract `innerText`
5. Apply same chunking and structured extraction as 8a steps 4–7
6. Write to `document_chunks`, `zoning_districts`, `permitted_uses`, `development_standards` with `municipality_id = 'naperville'`
7. Close browser

---

### 8c — Chicago (American Legal, Playwright)

**Source:** `https://codelibrary.amlegal.com/codes/chicagoil/latest/` (Title 17 = Zoning)

**Process:** Same as 8b using Playwright. Chicago is large.

**Extra steps for Chicago:**
- Set 15-second timeout per section
- Checkpoint: flush `document_chunks` writes to Postgres every 50 sections
- `municipality_id = 'chicago'`

---

### 8d — Evanston (Municode, Playwright)

**Source:** `https://library.municode.com/il/evanston`

**Process:** Same as 8b. Can share a Playwright browser session with 8b (run sequentially).
`municipality_id = 'evanston'`

---

## Step 9 — Embedding and Pinecone Upsert

**What it does:** Reads all `document_chunks` rows not yet embedded, generates vector embeddings, and upserts them into Pinecone.

**Pinecone index config:**
- One index, four namespaces: `wheaton | naperville | chicago | evanston`
- Metadata fields (must be pre-declared at index creation for filtering to work): `municipality_id`, `district_codes` (array), `topic_tags` (array), `source_type`, `source_url`, `section_id`

**Process line by line:**
1. Query `document_chunks` in batches of 100 ordered by `created_at ASC` where `embedded_at IS NULL`
2. Extract `chunk_text` array from the batch
3. Send batch to embedding model API (100 texts per call)
4. Receive 100 embedding vectors
5. For each vector, build Pinecone metadata: `{ municipality_id, district_codes: [district.district_code], topic_tags: keyword_match(chunk_text), source_url, section_id }`
6. `topic_tags` assigned by matching keywords: `['setbacks']` if chunk contains "setback", `['permitted_uses']` if "permitted by right", `['height']` if "maximum height", etc.
7. Upsert batch of 100 vectors to Pinecone (namespace = municipality name)
8. Update `document_chunks.embedded_at = now()` for the 100 rows
9. Repeat until `document_chunks WHERE embedded_at IS NULL` is empty

**Tables written:**
- `document_chunks.embedded_at` — updated after successful upsert

**Stores written:**
- Pinecone index — vectors upserted per chunk

**Ordering dependency:** Step 8 must be complete.

**Performance notes:**
- Estimated total chunks: ~2,900 (Wheaton ~200, Naperville ~400, Chicago ~2000, Evanston ~300)
- At 100 chunks/batch = 29 embedding API calls total
- Retry embedding API call up to 3 times (2s, 4s, 8s backoff) on failure before marking batch failed

---

## Step 10 — Verification

**What it does:** Read-only checks across all stores to confirm ingestion is complete and data is consistent.

**All previous steps must be complete before running this.**

**Postgres checks:**
1. `counties` → expect 2 rows
2. `municipalities` → expect 4 rows
3. `data_layers` → expect ≥ 8 rows for DuPage (parcels + 7 overlay types)
4. `parcels_dupage` count → expect ~337,072 (within 1% tolerance)
5. `parcels_cook` count → verify against known source count
6. `parcels_dupage WHERE municipality_id IS NULL` → alert if > 5% of total (unincorporated is expected, but large % means the spatial join failed)
7. `parcels_dupage WHERE flood_zone IS NULL` → review; many parcels are outside flood zones (Zone X), which is valid
8. `spatial_features GROUP BY layer_type` → each expected layer_type must have at least one row
9. `zoning_districts` → expect rows for all 4 municipalities
10. `permitted_uses` → expect rows for all 4 municipalities
11. `development_standards` → expect rows for all 4 municipalities
12. `document_chunks` → expect ~2,900+ rows
13. `document_chunks WHERE embedded_at IS NULL` → expect 0
14. Sample geometry validity: `ST_IsValid(geometry)` on 1,000 random parcels — expect 100% valid
15. Confirm spatial indexes exist: query `pg_indexes` for GIST entries on `parcels_dupage.geometry`, `parcels_cook.geometry`, `spatial_features.geometry`
16. `ingestion_jobs WHERE status = 'failed'` → must be 0 rows

**Neo4j checks:**
17. `MATCH (p:Parcel) RETURN count(p)` → must match Postgres parcel totals
18. `MATCH (o:Owner) RETURN count(o)` → must be fewer than parcels (deduplication working)
19. `MATCH ()-[r:OWNS]->() RETURN count(r)` → must equal total parcel count
20. `MATCH ()-[r:LOCATED_IN]->() RETURN count(r)` → must equal parcels with non-null `municipality_id`
21. `MATCH ()-[r:ADJACENT_TO]->() RETURN count(r)` → must be > 0
22. Verify indexes exist on `:Parcel(pin)` and `:Owner(name)`

**Pinecone checks:**
23. `describeIndexStats` → `totalVectorCount` must equal `document_chunks` row count
24. Run a test semantic query (embed "minimum lot size residential district") → top 5 results must have correct `municipality_id` metadata and non-empty `district_codes`
