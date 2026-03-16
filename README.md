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

## The Chat Endpoint — `POST /chat`

```
POST /chat
{ "message": "How many parcels in DuPage County are in flood zone AE?", "history": [] }
```

- `message` — the user's question
- `history` — optional array of previous turns (`{ role, content }`) for multi-turn conversation

Returns:
```json
{ "reply": "There are 82 parcels in DuPage County designated flood zone AE..." }
```

---

### How the agent works (`chat/agent.ts`)

The chat endpoint runs a **ReAct-style LLM agent loop** using GPT-4o with OpenAI function calling. Here is what happens on every request:

**1. Build the system prompt** (`chat/prompt.ts`)

Before calling the LLM, we query the live database to get current counts:
```sql
SELECT COUNT(*), COUNT(*) FILTER (WHERE flood_zone IS NOT NULL) FROM parcels_dupage
SELECT COUNT(*) FROM zoning_districts
SELECT COUNT(*) FROM document_chunks
```

These numbers are injected into the system prompt so the LLM knows exactly what data it has access to — e.g. "3,999 parcels, 82 in flood zones, 29 zoning districts, 1,200 searchable ordinance chunks." The system prompt also contains hard rules (explained below).

**2. The agent loop**

```
LLM call → tool calls? → execute tools → feed results back → LLM call → ... → final answer
```

The loop runs up to 5 iterations:
- We send the system prompt + conversation history + user message to GPT-4o with all 10 tool definitions attached
- GPT-4o responds with either a final text answer OR a list of `tool_calls` it wants to make
- If there are tool calls, we execute all of them **in parallel** using `Promise.all`, then append the results to the message history
- We call the LLM again with the tool results included
- This repeats until the LLM returns a text answer with no tool calls, or we hit 5 iterations

**Why parallel tool calls:** GPT-4o can request multiple tools in a single response (e.g. "I need to call `get_permitted_uses` AND `get_development_standards`"). We execute them concurrently so complex multi-step questions don't take 2–3x longer.

**3. Tool dispatch** (`chat/executor.ts`)

A simple switch statement routes each tool name to its handler function in `tools/handlers.ts`. If an unknown tool name arrives, it returns `{ error: "Unknown tool" }`.

---

### The System Prompt and Hard Rules

The system prompt is not static — it's rebuilt on every request with live DB counts. It contains:

**Tool selection guide:** Tells the LLM which tool to use for which type of question. Without this, GPT-4o would sometimes call `search_ordinance_text` for a simple parcel lookup, which is slow and returns irrelevant results.

**Four hard rules that were added to fix specific bugs found in evaluation:**

**Rule 1 — Parcel ↔ Zoning linkage does NOT exist**
The LLM was hallucinating zoning districts from street addresses (e.g. "304 S RT 59 is a highway corridor so it's probably B1 commercial"). The rule explicitly tells it: the parcel table has no `zoning_code` column, never infer a zone from an address, always tell the user to check the official zoning map instead.

**Rule 2 — Always report total count**
Tool responses include `total_count` and `truncated` fields. The LLM was sometimes only reporting the number of returned rows (20) instead of the true total (82). The rule forces it to always surface the real total and flag truncation.

**Rule 3 — Flood zone counting — use `by_flood_zone` totals**
The `get_flood_zone_summary` tool returns two separate aggregations: `by_flood_zone` (county-wide count per zone type) and `by_municipality` (total flood parcels per municipality). Without this rule, the LLM would use the wrong one for the wrong question — summing `by_municipality` rows to get an AE count (wrong) instead of reading `by_flood_zone` directly (right).

**Rule 4 — RAG fallback is mandatory when structured data is incomplete**
The structured tables (`development_standards`, `permitted_uses`) only have data for B1 and RD districts. For all other districts they return empty. When `get_development_standards` returns a `note` field listing missing standards, the LLM MUST call `search_ordinance_text` before answering — it cannot just say "no data found."

---

### The 10 Tools

Each tool is defined in `chat/tools.ts` in OpenAI function-calling format (name, description, JSON Schema for parameters). The handler that actually runs is in `tools/handlers.ts`.

---

#### 1. `search_parcels`

**What it does:** Searches `parcels_dupage` by any combination of address fragment, owner name, municipality ID, and flood zone. Uses `ILIKE '%fragment%'` for text fields (case-insensitive, partial match) and exact `=` for municipality and flood zone.

**Why `ILIKE`:** Parcel addresses in the DB are stored as-is from ArcGIS — all caps, inconsistent spacing. `ILIKE '%goldenrod%'` catches `1333 GOLDENROD DR NAPERVILLE 60540` without the user needing to know the exact format.

**Key detail — `total_count` + `truncated`:** The handler runs two queries: one `COUNT(*)` for the true total, one with `LIMIT` for the actual rows. Both are returned so the LLM can tell the user "there are 47 matching parcels, here are the first 20."

**Key detail — `zoning_district: null` and `data_note`:** Every parcel in the response has `zoning_district: null` explicitly set, plus a `data_note` saying "never infer a zoning district from an address." This makes the tool result itself block hallucination, not just the system prompt.

**Parameters:** `address`, `owner`, `municipality`, `flood_zone`, `limit`

---

#### 2. `get_flood_zone_summary`

**What it does:** Returns two separate aggregations:
- `by_flood_zone` — `GROUP BY flood_zone` (ignoring municipality). Answers "how many AE parcels are in DuPage County?" accurately, including parcels with `municipality_id = NULL`.
- `by_municipality` — `GROUP BY municipality_id` (ignoring zone type). Answers "which municipality has the most flood parcels?"

**Why two separate aggregations:** The original implementation grouped by `(flood_zone, municipality_id)` together. The LLM summed only the named-municipality rows and missed ~40 AE parcels with `municipality_id = NULL`, reporting 20 instead of 82. Splitting into two separate queries fixed this.

**Parameters:** `municipality` (optional — filters both aggregations to a single city)

---

#### 3. `list_zoning_districts`

**What it does:** Returns all rows from `zoning_districts` for a given municipality — district code (R1A, B1, RD), full name, category (residential/commercial/industrial), and description.

**Parameters:** `municipality` (required — `naperville` or `evanston`)

---

#### 4. `get_permitted_uses`

**What it does:** Looks up the district UUID from `zoning_districts`, then queries `permitted_uses` joined to that district. Returns each use with its `permit_type`: `by_right` (allowed as-of-right), `conditional` (needs approval), `prohibited`, or `accessory`.

**When structured data is empty:** If the district has no rows in `permitted_uses` (e.g. R1A, R3 — not yet extracted), the response includes a `note` field: `"No structured permitted uses extracted. Use search_ordinance_text..."`. The system prompt's hard rule forces the LLM to call `search_ordinance_text` when it sees this note.

**Parameters:** `municipality`, `district_code`, `permit_type` (optional filter)

---

#### 5. `get_development_standards`

**What it does:** Queries `development_standards` for a district. Returns standards like `min_lot_sqft: 7500`, `max_height_ft: 35`, `front_setback_ft: 25`, etc.

**Deduplication:** Re-ingestion runs sometimes insert duplicate rows (same standard, same value). The handler deduplicates them in-memory using a `Set` keyed on `${standard}|${value}|${unit}` before returning.

**Missing standards note:** We define a list of 9 common standard types (`COMMON_STANDARDS`). After querying, we check which ones are absent from the results. If any are missing, the response includes a `note` listing them: `"These standard types are not in structured data: front_setback_ft, side_setback_ft. Look them up via search_ordinance_text."` This triggers the mandatory RAG fallback in the system prompt.

**Parameters:** `municipality`, `district_code`

---

#### 6. `compare_districts`

**What it does:** Calls `getDevelopmentStandards` twice — once for district A and once for district B — and returns both results side by side. Districts can be from the same or different municipalities (e.g. Naperville RD vs Naperville B1, or Naperville B1 vs Evanston B2).

**Parameters:** `municipality_a`, `district_code_a`, `municipality_b`, `district_code_b`

---

#### 7. `search_ordinance_text`

**What it does:** Semantic search over all ingested ordinance text chunks. This is the RAG (Retrieval-Augmented Generation) tool — it finds the most relevant passages from the zoning ordinance to answer nuanced questions that aren't in the structured tables.

**How it works — two-stage with fallback:**

**Stage 1 — Pinecone semantic search:**
1. The query string is sent to OpenAI's `text-embedding-3-small` model, which converts it into a 1,536-dimensional vector (a list of numbers representing the semantic meaning)
2. That vector is sent to Pinecone, which finds the stored ordinance chunk vectors that are most similar (cosine similarity)
3. Pinecone stores chunks in **namespaces** — one per municipality (`naperville`, `evanston`). If `municipality` is specified, we query only that namespace. Otherwise we query both and merge the results.
4. Results are re-ranked by similarity score and the top-K are returned.

**Stage 2 — Keyword fallback:**
If Pinecone is unavailable or returns no results, we fall back to a simple `ILIKE '%query%'` search against the `document_chunks` table in Postgres.

**What are "chunks":** Each zoning ordinance is split into sections (e.g. Chapter 7, Section 17.3.1). Each section is stored as a `document_chunk` row with its full text, section ID, source URL, and municipality. The same UUID is used as both the Postgres primary key and the Pinecone vector ID, so after Pinecone returns a list of vector IDs we can hydrate the full text from Postgres.

**Parameters:** `query`, `municipality` (optional), `limit`

---

#### 8. `get_parcels_in_flood_zone`

**What it does:** Returns all parcels with a specific FEMA flood zone, optionally filtered to a municipality. Similar to `search_parcels` but flood-zone-first and includes `total_count` + `truncated`.

**Dirty data normalisation — `UPPER(TRIM(...))` in the SQL query:**

The flood zone values stored in the DB are inconsistent because they came from multiple different ArcGIS layers, each with slightly different formatting. The same FEMA zone appears as:
- `"AE"` in one layer
- `"ZONE AE"` in another
- `"ae"` or `" AE "` (with whitespace) in others

If you run a naive `WHERE flood_zone = 'AE'` you miss every row that doesn't match exactly. The fix works in two parts:

**Part 1 — normalise the user's input in TypeScript before the query:**
```ts
const normalised = flood_zone.replace(/^ZONE\s+/i, '').trim().toUpperCase()
// "zone ae" → "AE", " AE " → "AE", "ZONE AE" → "AE"
```

**Part 2 — normalise the stored DB value inside the SQL query itself:**
```ts
sql`UPPER(TRIM(${parcelsDupage.floodZone})) = ${normalised}`
```

`TRIM()` is a built-in Postgres string function that strips leading and trailing whitespace from a value. `UPPER()` converts it to uppercase. By wrapping the DB column in both, we ensure both sides of the `=` comparison are in the same canonical form (`"AE"`) regardless of how the data was originally stored.

**Why this matters for retrieval:** Without this, a user asking "parcels in flood zone AE" would get 40 results instead of 82, silently missing every parcel whose `flood_zone` column has a space, different casing, or the "ZONE " prefix. The normalisation makes the query robust to source data inconsistencies without needing to clean up the stored data.

**Parameters:** `flood_zone` (required), `municipality`, `limit`

---

#### 9. `list_available_layers`

**What it does:** Returns rows from `data_layers` — the registry of every GIS layer discovered during ingestion. Useful when the user asks "what data do you have?" or "is there school district data available?"

**Parameters:** `county`, `layer_type` (both optional filters)

---

#### 10. `get_municipality_summary`

**What it does:** Returns a high-level overview for a municipality by running 3 separate count queries:
- `COUNT(*)` from `parcels_dupage` WHERE `municipality_id = ?`
- `COUNT(*)` from `zoning_districts` WHERE `municipality_id = ?`
- `COUNT(*)` from `document_chunks` WHERE `municipality_id = ?`

Also returns metadata from the `municipalities` table: county, zoning source (PDF/Municode/eCode360), and last scrape timestamp.

**Parameters:** `municipality` (required)

---

### `pg_trgm` — Fuzzy Search (`GET /search/parcels`)

`pg_trgm` is a **PostgreSQL extension** that enables fuzzy text matching based on trigrams. A trigram is every sequence of 3 consecutive characters in a string — `"GOLDENROD"` becomes `["GOL", "OLD", "LDE", "DEN", "ENR", "NRO", "ROD"]`. Two strings are considered similar if they share enough trigrams.

This powers the `GET /search/parcels?q=...` endpoint — a separate, dedicated search endpoint distinct from the LLM chat tools.

**Why it exists:** The `ILIKE '%fragment%'` used in the chat tools requires the user to spell things exactly right. `pg_trgm` handles typos, partial words, and fuzzy input — e.g. `"goldenrd"` still finds `"GOLDENROD DR"`.

**How it is set up:**

`setup.sql` enables the extension once on the Neon database:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

`0001_spatial_indexes.sql` creates GIN trigram indexes on the address columns:
```sql
CREATE INDEX idx_parcels_dupage_address_trgm
  ON parcels_dupage USING GIN (address gin_trgm_ops);
```

A **GIN** (Generalized Inverted Index) on `gin_trgm_ops` pre-computes all the trigrams for every address and stores them in an inverted index — so instead of scanning every row at query time, Postgres looks up matching trigrams instantly.

**How the query works** (`routes/search.ts`):

```sql
SELECT pin, address, owner_name, ...,
  GREATEST(
    similarity(LOWER(address),    LOWER($q)),
    similarity(LOWER(owner_name), LOWER($q)),
    similarity(LOWER(pin),        LOWER($q))
  ) AS score
FROM parcels_dupage
WHERE
  LOWER(address)    % LOWER($q)
  OR LOWER(owner_name) % LOWER($q)
  OR LOWER(pin)     % LOWER($q)
ORDER BY score DESC
LIMIT 10
```

- `%` is the pg_trgm **similarity operator** — returns true if the trigram similarity between two strings exceeds the threshold (default 0.3). This is what filters rows using the GIN index.
- `similarity(a, b)` returns a float 0–1 score. We compute it against all three columns (address, owner name, PIN) and take the `GREATEST` so the best-matching column wins.
- Results are ordered by score descending — the closest match comes first.
- We lowercase both sides so `"goldenrod"` matches `"GOLDENROD DR"`.

**Why it helps with retrieval:**

| Query | `ILIKE` result | `pg_trgm` result |
|---|---|---|
| `"goldenrd dr"` | no match | matches `"GOLDENROD DR"` |
| `"naprvile park"` | no match | matches `"NAPERVILLE PARK DISTRICT"` |
| `"1333 gldnrod"` | no match | matches `"1333 GOLDENROD DR"` |

Without `pg_trgm`, a user has to know the exact address format stored in the DB. With it, approximate input works.

**`/search/parcels` vs `search_parcels` tool:** These are two different things. The `GET /search/parcels` endpoint is for direct programmatic/UI use with fuzzy matching. The `search_parcels` LLM tool uses `ILIKE` inside the chat agent — simpler but requires closer spelling. The two complement each other.

---

### Pinecone + RAG Architecture

Pinecone is a **vector database** — instead of searching by exact text match, it searches by semantic meaning. Here's how it fits into the system:

**At ingest time** (`/ingest/municipal`):
1. The municipal ordinance is scraped and split into chunks (~500–1000 tokens each)
2. Each chunk is embedded using OpenAI `text-embedding-3-small` into a 1,536-dimensional vector
3. The vector is upserted into Pinecone under the municipality's namespace (`naperville` or `evanston`)
4. The chunk text and metadata (section ID, source URL, municipality) are stored in the `document_chunks` Postgres table
5. The Pinecone vector ID = the Postgres UUID, linking the two stores

**At query time** (`search_ordinance_text`):
1. The user's query is embedded with the same model
2. Pinecone finds the top-K most similar stored vectors (cosine similarity score 0–1)
3. The full chunk text is returned from the metadata stored alongside the vector in Pinecone
4. Results from all queried namespaces are merged and re-sorted by score

**Why namespaces:** Pinecone namespaces act like separate indexes within one index. By storing Naperville and Evanston chunks in separate namespaces, a municipality-scoped query only searches that namespace and doesn't waste `topK` slots on results from the other city.

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
