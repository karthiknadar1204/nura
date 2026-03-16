# Nura — Technical Reference

This document explains the full architecture of the Nura backend: what it ingests, why it was built this way, and exactly what happens at every step of the pipeline.

---

## What is this system?

Nura is a chat API that lets you ask natural language questions about real estate parcels, zoning rules, and land use regulations across Illinois municipalities. Under the hood it combines three data sources:

1. **ArcGIS GIS data** — parcel boundaries, flood zone polygons, municipality boundary polygons from county government GIS servers
2. **Municipal zoning ordinances** — scraped and structured zoning rules (permitted uses, development standards) for Naperville and Evanston
3. **Ordinance text (RAG)** — full zoning ordinance text chunked and embedded into Pinecone for semantic search

---

## Key Concepts

### What is a County?

A county is the top-level administrative unit. We work with two Illinois counties:

- **DuPage County** — suburban county west of Chicago. Home to Naperville, Wheaton, Elmhurst, Downers Grove, and ~30 other municipalities. Has an ArcGIS GIS server at `gis.dupageco.org` that publishes all their spatial data.
- **Cook County** — the county that contains Chicago. Much larger (5.2M people). Also has an ArcGIS server. We attempted Cook County ingestion but it was not completed — their parcel layer has 1.8M records and field names differ significantly from DuPage.

### What is a Municipality?

A municipality is a city or village within a county — Naperville, Wheaton, Elmhurst, etc. Municipalities matter because:

- Parcels are physically located inside municipality boundaries
- Zoning rules are set **by the municipality**, not the county — Naperville has its own zoning code, Wheaton has its own, etc.
- The county GIS server has boundary polygons for each municipality, which we use to spatially link parcels to municipalities

### What is a Parcel?

A parcel is the fundamental unit of real property. Every piece of land in the US is divided into parcels, each with:

- A **PIN** (Parcel Identification Number) — a unique identifier assigned by the county assessor. In DuPage it looks like `0936301008`.
- A physical **boundary polygon** — a precise geographic shape stored as coordinates
- An **owner** — individual, corporation, trust, or government entity
- **Assessment data** — land value, building value, lot area, year built
- Derived attributes we stamp on at ingest time: **flood zone**, **municipality**, **zoning code**

The county assessor maintains parcel data. They publish it as ArcGIS feature layers (basically a REST API that returns GeoJSON features with attributes).

### What is Spatial Geometry?

Every parcel, flood zone, and municipality boundary has a physical shape in the real world — a polygon defined by a sequence of (longitude, latitude) coordinate pairs that trace the boundary. We store these shapes in Postgres using the **PostGIS** extension, which adds a `geometry` column type and spatial functions like `ST_Intersects`.

**EPSG:4326 (WGS84)** is the coordinate system used everywhere in this system. It's the same lat/lng system as GPS. ArcGIS natively stores data in various state plane projections (feet-based, not degrees), but we always request `outSR=4326` when fetching from their API, which tells ArcGIS to reproject the coordinates to lat/lng before sending them to us.

---

## The Ingestion Pipeline — `POST /ingest/trigger`

### How to trigger it

```
POST /ingest/trigger
{ "county": "dupage", "type": "full" }
```

- `county`: `"dupage"` | `"cook"` | `"all"`
- `type`: `"full"` (re-ingest everything) | `"delta"` (only changed records, detected via MD5 hash)

The endpoint returns a `202 Accepted` immediately with a BullMQ `jobId`. The actual work runs in a separate worker process (`bun run worker:pipeline`) so the HTTP server never blocks.

```json
{ "message": "Ingestion queued", "county": "dupage", "jobId": "1", "status": "queued" }
```

Check progress: `GET /ingest/jobs/1`

---

### Step 1 — The Request Routes to a Worker

`routes/ingest.ts` validates the body and enqueues a job:

```ts
const job = await pipelineQueue.add('run-pipeline', { countyId: county, jobType: type })
```

The BullMQ worker process picks this up and calls `runIngestion({ countyId, jobType })` from `ingestion/pipeline.ts`. Everything below happens inside that function.

---

### Step 2 — Layer Discovery (`discover.ts`)

**Why we need this:** DuPage's GIS server has ~149 published data layers — parcel data, flood zones, wetland maps, school district boundaries, road centerlines, etc. We don't want to hardcode which URL to use for parcels because the county can rename or restructure their services. So we auto-discover everything first and store it in the `data_layers` table.

**How it works — two phases:**

**Phase A: DCAT Feed**

DCAT (Data Catalog Vocabulary) is a US government standard for publishing open data catalogs as JSON. DuPage publishes one at:
```
https://gisdata-dupage.opendata.arcgis.com/api/feed/dcat-us/1.1.json
```

We fetch this catalog, which lists ~84 datasets. For each dataset we look for a `distribution` entry whose URL contains `/FeatureServer` or `/MapServer` — that's the actual ArcGIS REST endpoint. We skip any URL that contains `/maps/` or `/datasets/` because those are web viewer pages, not data APIs.

**Phase B: ArcGIS REST Walk**

We also directly hit the ArcGIS REST root:
```
https://gis.dupageco.org/arcgis/rest/services?f=json
```

This returns a JSON list of all service folders. We walk every folder, find every `MapServer` and `FeatureServer`, and add `/0` to the path (layer 0 is the main feature layer for most services). This catches ~65 additional layers not in the DCAT catalog.

**How we classify layers:**

Each discovered URL gets a `layer_type` assigned via regex on the layer name:
```
"flood"        → if name contains "flood"
"parcel"       → if name contains "parcel"
"municipality" → if name contains "munic", "boundary", "village", "city"
"zoning"       → if name contains "zoning"
"misc"         → everything else
```

All discovered layers are stored in `data_layers` with `ON CONFLICT DO NOTHING` — so re-running discovery never creates duplicate rows.

---

### Step 3 — Parcel Ingestion (`ingestParcelLayerWithGeometry`)

**Why there are multiple parcel layers:** Discovery finds multiple layers with `layer_type = 'parcel'`. DuPage publishes the same parcel data through several different ArcGIS services (a viewer layer, a report layer, a search layer, etc.) with slightly different field subsets. We pick the one with the **highest record_count** — that's the authoritative full dataset with all fields. For DuPage this is:
```
https://gis.dupageco.org/arcgis/rest/services/Accela/AccelaServiceParcelsWGS84/MapServer/0
(337,690 records — but we cap at 4,000 for the current ingestion limit)
```

#### How `paginateLayer()` works

ArcGIS REST services have a `maxRecordCount` limit — you can only fetch 1,000 features per request. To get all features, you paginate using `resultOffset`:

```
GET /query?where=1=1&outFields=*&outSR=4326&resultOffset=0&resultRecordCount=1000
GET /query?where=1=1&outFields=*&outSR=4326&resultOffset=1000&resultRecordCount=1000
GET /query?where=1=1&outFields=*&outSR=4326&resultOffset=2000&resultRecordCount=1000
...
```

`paginateLayer` is an **async generator** — it yields one batch of 1,000 features at a time. The calling code processes each batch while the next one is being fetched. The key parameters:

- `outSR=4326` — tells ArcGIS to reproject coordinates to WGS84 lat/lng before returning them. Without this, DuPage would return Illinois State Plane coordinates (feet-based, completely different numbers), which PostGIS would misinterpret as lat/lng and place parcels in the wrong ocean.
- `exceededTransferLimit: true` — ArcGIS signals there are more pages with this flag. When it's absent, we stop paginating.
- Retry logic — if a page request fails, we retry up to 3 times with exponential backoff (1s, 2s, 4s).

#### How `normalizeFeature()` works

Each ArcGIS feature comes back as raw attributes with county-specific field names:
```json
{
  "PIN": "0936301008",
  "PROPSTNUM": "1333",
  "PROPSTDIR": null,
  "PROPSTNAME": "GOLDENROD DR",
  "PROPCITY": "NAPERVILLE",
  "PROPNAME": "SMITH JOHN A",
  "LANDUSE": "101",
  "ASSESS_VAL": "245000"
}
```

DuPage splits the address across 4 fields (`PROPSTNUM`, `PROPSTDIR`, `PROPSTNAME`, `PROPCITY`). `normalizeFeature()` assembles them into a single address string. `COOK_FIELD_MAPPING` has entirely different field names (`PROPERTY_ADDR`, `TAXPAYER_NAME`, etc.) — that's why we have per-county field mappings.

**Ownership classification:** The owner name is run through a regex classifier:
- Contains `LLC`, `INC`, `CORP`, `REALTY`, `HOLDINGS` → `corporate`
- Contains `TRUST`, `TR`, `REVOCABLE` → `trust`
- Contains `CITY`, `VILLAGE`, `DISTRICT`, `PARK DISTRICT`, `SCHOOL` → `government`
- Everything else → `individual`

This lets the chat tools filter parcels by ownership type without the LLM having to parse raw text.

**MD5 data hash:** We compute `MD5(sorted JSON of all raw attributes)` for every parcel. On delta runs, if the hash matches what's already in the DB, we skip that parcel entirely. This is how we avoid reprocessing 4,000 unchanged parcels every time.

**Geometry storage — why two passes:**

Drizzle ORM's type system doesn't support PostGIS functions inline in `.values()`. So we do it in two passes:
1. First pass: upsert all non-geometry columns (`ON CONFLICT (pin) DO UPDATE`)
2. Second pass: run raw SQL for each parcel that has geometry:
   ```sql
   UPDATE parcels_dupage SET geometry = ST_GeomFromGeoJSON($geojson) WHERE pin = $pin AND geometry IS NULL
   ```
   `ST_GeomFromGeoJSON()` converts a GeoJSON string into PostGIS's internal binary geometry format.

---

### Step 3.5 — Geometry Repair

After all overlay layers are ingested into `spatial_features`, but before any spatial joins run, we repair invalid geometries:

```sql
UPDATE spatial_features
SET geometry = ST_MakeValid(geometry)
WHERE county_id = 'dupage' AND NOT ST_IsValid(geometry)
```

**Why this is necessary:** Some polygons from ArcGIS have self-intersections — the boundary crosses itself, which is invalid geometry. PostGIS's `ST_Intersects()` throws a `GEOSIntersects: TopologyException: side location conflict` error when it tries to process one.

**Why we don't wrap ST_MakeValid in the join itself:** We tried `WHERE ST_Intersects(ST_MakeValid(p.geometry), ST_MakeValid(sf.geometry))` but this calls `ST_MakeValid` on every row combination — O(parcels × polygons) — which is extremely slow and exceeds Neon serverless's query timeout. By pre-repairing once upfront, the joins run against clean geometry at full speed.

---

### Step 5a — Municipality Boundary Ingestion

We fetch the municipality boundary layer from DuPage's ArcGIS — this layer contains the official boundary polygons of every city and village in DuPage County (Naperville, Wheaton, Elmhurst, etc.). Each polygon's attributes include the municipality name.

These polygons are stored in `spatial_features` with `layer_type = 'municipality'`:

```sql
INSERT INTO spatial_features (county_id, layer_id, layer_type, feature_id, geometry, attributes)
VALUES ('dupage', $layerId, 'municipality', $objectId, ST_GeomFromGeoJSON($geojson), $attributes)
ON CONFLICT (layer_id, feature_id) DO UPDATE SET geometry = ..., attributes = ...
```

The `attributes` JSONB column stores all the original fields from ArcGIS verbatim — including the municipality name in whatever field it lives in (`NAME`, `CITY`, `MunName`, etc.).

---

### Step 4 — Municipality Spatial Join

Now we have:
- `parcels_dupage`: 3,999 rows, each with a `geometry` polygon, `municipality_id = NULL`
- `spatial_features`: 40 municipality boundary polygons, each with a `geometry` polygon and a `attributes->>'NAME'` like `"NAPERVILLE"`

The spatial join asks: **"Which municipality boundary polygon does each parcel polygon overlap?"**

```sql
UPDATE parcels_dupage p
SET municipality_id = m.id
FROM municipalities m, spatial_features sf
WHERE sf.layer_type = 'municipality'
  AND ST_Intersects(sf.geometry, p.geometry)
  AND LOWER(sf.attributes->>'NAME') = LOWER(m.name)
  AND p.municipality_id IS NULL
  AND p.geometry IS NOT NULL
```

`ST_Intersects(A, B)` returns true if geometry A and geometry B share any point in space — i.e., the parcel polygon is physically inside or touching the municipality polygon. PostGIS uses spatial indexing (GiST index) to make this fast — it doesn't check every parcel against every boundary.

**Why 2,049 parcels have `municipality_id = NULL`:** Either their geometry is NULL (ArcGIS returned no coordinates for them), or the spatial join failed because the parcel polygon sits on a boundary, or the municipality name in `sf.attributes` doesn't exactly match any row in the `municipalities` table after the `LOWER()` comparison.

---

### Step 5b — Flood Zone Ingestion

Same as municipality ingestion. FEMA publishes flood zone polygons through DuPage's ArcGIS. Each polygon represents an area with a specific flood designation:

- **AE** — 1% annual chance flood (100-year flood), base flood elevation determined
- **X** — minimal flood hazard
- **A** — 1% annual chance flood, base flood elevation undetermined
- **FW** — floodway

We ingest all these polygons into `spatial_features` with `layer_type = 'flood'`. Some DuPage flood layers fail (400 or 500 errors from the ArcGIS server) — those are skipped, others succeed. We found 3 working flood layers contributing a total of ~8,000 flood zone polygons.

---

### Step 6 — Flood Zone Spatial Join

Same pattern as municipality:

```sql
UPDATE parcels_dupage p
SET flood_zone = COALESCE(
  sf.attributes->>'FLD_ZONE',
  sf.attributes->>'ZONE_',
  sf.attributes->>'FLOOD_ZONE',
  'X'
)
FROM spatial_features sf
WHERE sf.layer_type = 'flood'
  AND ST_Intersects(p.geometry, sf.geometry)
  AND p.flood_zone IS NULL
  AND p.geometry IS NOT NULL
```

The `COALESCE` tries multiple field names because different FEMA layers use different attribute names for the zone designation. If none match, it defaults to `'X'` (minimal hazard).

**Result:** 82 parcels get `flood_zone = 'AE'`, plus others for X, A, etc.

---

### Step 7a — Zoning Polygon Ingestion

DuPage publishes an unincorporated zoning layer:
```
https://gis.dupageco.org/arcgis/rest/services/Zoning/UnincorporatedZoningData/MapServer/0
```

This contains 761 polygon features covering unincorporated DuPage County (land that isn't inside any city or village). Each polygon has a `ZONING` attribute like `"R-1"`, `"B-2"`, `"I-1"`.

**Important limitation:** This only covers **unincorporated** land. Parcels inside Naperville or Wheaton are under those municipalities' own zoning codes, not the county's. Those municipalities don't publish their zoning polygons through DuPage's ArcGIS server.

These polygons are stored in `spatial_features` with `layer_type = 'zoning'`. Then we run geometry repair again (this layer had particularly bad topology) before running the join.

---

### Step 7b — Zoning Code Spatial Join

```sql
UPDATE parcels_dupage p
SET zoning_code = COALESCE(
  sf.attributes->>'ZONING',
  sf.attributes->>'ZONE_CODE',
  sf.attributes->>'ZONING_CLASS'
)
FROM spatial_features sf
WHERE sf.layer_type = 'zoning'
  AND ST_Intersects(p.geometry, sf.geometry)
  AND p.zoning_code IS NULL
  AND p.geometry IS NOT NULL
```

Result: parcels in unincorporated DuPage get a `zoning_code` like `R-1`, `B-2`, `I-1`. Incorporated-area parcels still have `zoning_code = NULL` — their zoning comes from the municipal ordinances, not county GIS.

---

## The Core Spatial Pattern

The entire pipeline is the same idea applied three times:

```
Ingest overlay polygons → spatial_features
         ↓
ST_Intersects each parcel against those polygons
         ↓
Stamp a derived field on the parcel row
```

| Overlay | Field stamped | Source |
|---|---|---|
| Municipality boundaries | `municipality_id` | DuPage ArcGIS boundary layer |
| FEMA flood zones | `flood_zone` | DuPage ArcGIS / FEMA NFHL |
| DuPage unincorporated zoning | `zoning_code` | DuPage Zoning ArcGIS layer |

Every piece of derived data on a parcel comes from "which polygon does this parcel sit inside of."

---

## Why Cook County Wasn't Completed

Cook County (Chicago) was designed into the schema (`parcels_cook`, `COOK_FIELD_MAPPING`, `parcelsCook` table) but ingestion was not completed for two reasons:

1. **Scale**: Cook County has 1.8M parcels. The current pipeline has a `maxRecords: 4000` cap — ingesting all of Cook would take hours and produce ~450x more rows than DuPage.
2. **Field mapping is unverified**: Cook's ArcGIS layer uses completely different field names (`PROPERTY_ADDR`, `TAXPAYER_NAME`, `ASSESSED_VALUE` vs DuPage's `PROPSTNUM`, `PROPNAME`, `ASSESS_VAL`). The `COOK_FIELD_MAPPING` in `normalize.ts` was written based on what Cook's fields are *expected* to be named — it was never verified against a live Cook response. If the real field names differ, most columns will come back NULL on every parcel.
3. **No single clean parcel layer**: Cook County's GIS is messier than DuPage. They have multiple overlapping parcel services — some maintained by the Cook County Assessor, others by the Chicago Data Portal — with different schemas and record counts. The pipeline picks the highest record-count layer as authoritative, but for Cook that heuristic may not select the right one.
4. **Cook municipalities not seeded**: The `municipalities` table currently only contains DuPage municipalities. For the municipality spatial join to work on Cook parcels, every city and village in Cook (Chicago, Evanston, Oak Park, Skokie, etc.) would need to be seeded into that table first.

The schema and code are fully Cook-ready — you can trigger `{ "county": "cook", "type": "full" }` and it will attempt ingestion, but the data quality of the results is untested.

---

## The Municipal Zoning Pipeline — `POST /ingest/municipal`

This is entirely separate from the ArcGIS parcel pipeline. It handles scraping structured zoning data from municipality websites.

```
POST /ingest/municipal
{ "municipality": "naperville" }
```

Supported: `naperville`, `evanston`, `wheaton`, `chicago`, `all`

This pipeline:
1. Fetches the municipality's zoning ordinance from its source (PDF, Municode, eCode360, or AMlegal)
2. Parses the text using an LLM extraction prompt
3. Stores structured data into `zoning_districts`, `permitted_uses`, `development_standards`
4. Chunks the full text and embeds it into Pinecone for RAG

---

## Database Schema Summary

| Table | What it stores |
|---|---|
| `counties` | Cook and DuPage county metadata + GIS base URLs |
| `municipalities` | Cities/villages with FK to county, zoning source URL |
| `data_layers` | Every ArcGIS layer discovered (149 for DuPage) |
| `parcels_dupage` | 3,999 parcels with address, owner, geometry, flood zone, municipality |
| `parcels_cook` | Empty (Cook not ingested) |
| `spatial_features` | All non-parcel GIS polygons: flood zones, municipality boundaries, zoning polygons |
| `zoning_districts` | Naperville + Evanston zoning districts (R1A, B1, RD, etc.) |
| `permitted_uses` | Uses allowed by right, conditionally, or prohibited per district |
| `development_standards` | Setbacks, height limits, lot coverage per district |
| `document_chunks` | Ordinance text chunks with Pinecone vector IDs for RAG |
| `ingestion_jobs` | Job tracking for every pipeline run |

---

## Chat Tools

The chat endpoint (`POST /chat`) runs an LLM agent that has access to 10 structured tools:

| Tool | What it queries |
|---|---|
| `search_parcels` | `parcels_dupage` by address, owner, flood zone |
| `get_flood_zone_summary` | Aggregates flood zone counts by zone type and by municipality |
| `get_parcels_in_flood_zone` | All parcels matching a specific flood zone |
| `list_zoning_districts` | All districts for a municipality |
| `get_permitted_uses` | Permitted/conditional/prohibited uses for a district |
| `get_development_standards` | Setbacks, height, coverage for a district |
| `compare_districts` | Side-by-side standards for two districts |
| `search_ordinance_text` | Pinecone semantic search over ordinance chunks |
| `list_available_layers` | What data layers are available |
| `get_municipality_summary` | Parcel counts, flood stats, districts for a municipality |

---

## Running Locally

```bash
# Start the API server
bun run dev

# Start the pipeline worker (separate terminal)
bun run worker:pipeline

# Start the municipal worker (separate terminal)
bun run worker:municipal
```

Required `.env`:
```
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX_NAME=nura
REDIS_URL=redis://localhost:6379
FIRECRAWL_API_KEY=fc-...
```
