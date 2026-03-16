# API Inventory — County GIS Ingestion & RAG Chat

> Auth status confirmed via live probing. All DuPage ArcGIS endpoints are **public, no token required**.
> Cook County main ArcGIS server (`gis12.cookcountyil.gov`) is currently unreachable — Open Data Hub + Socrata are the fallback.

---

## How ArcGIS REST Works (Pattern applies to both counties)

Every ArcGIS REST server follows the same discovery chain:

```
/services?f=json                              → list folders + root services
/services/{folder}?f=json                    → list services inside folder
/services/{folder}/{service}/MapServer?f=json → service metadata + layer list
/services/{folder}/{service}/MapServer/layers?f=json → ALL layers + fields in one call
/services/{folder}/{service}/MapServer/{layerId}/query → paginated feature data
```

Query parameters used on every feature fetch:


| Param               | Value               | Purpose                                  |
| ------------------- | ------------------- | ---------------------------------------- |
| `where`             | `1=1`               | return all records                       |
| `outFields`         | `*`                 | return all attributes                    |
| `outSR`             | `4326`              | normalize geometry to WGS84              |
| `resultRecordCount` | `1000`              | page size (server max)                   |
| `resultOffset`      | `0, 1000, 2000...`  | pagination cursor                        |
| `returnCountOnly`   | `true`              | get total record count before paginating |
| `f`                 | `json` or `geojson` | response format                          |


Watch for `"exceededTransferLimit": true` in response — means reduce page size.

---

## DuPage County

**Base URL:** `https://gis.dupageco.org/arcgis/rest/services`
**Auth:** None — all public
**Total parcels confirmed:** 337,072

---

### 1. Root Service Directory

**Endpoint:**

```
GET https://gis.dupageco.org/arcgis/rest/services?f=json
```

**Returns:**

```json
{
  "folders": ["DuPage_County_IL", "ParcelSearch", "Stormwater", "Zoning",
              "NaturalAreas", "Environmental", "Transportation", "Elections",
              "PublicWorks", "OpenData", "Hydrography", "Accela",
              "CityworksStormwater", "Contours", "CORS_Benchmarks", "DuDOT",
              "ETSB_GIS", "HealthDepartment", "OEMHS", "Projects",
              "PublicAccess", "SID_Imagery", "Tyler", "Utilities", "Web_RMS"],
  "services": [
    {"name": "DPMS_STREET_INTERSECTION_SERVICE", "type": "MapServer"},
    {"name": "DSM2014_HillShade", "type": "MapServer"},
    ...
  ]
}
```

**Use case:** Layer discovery — this is the entry point for programmatic enumeration of every data layer the county exposes. The pipeline starts here, walks every folder, and registers every service in the `data_layers` table.

---

### 2. Parcel Data — Core Layer (337,072 records)

**Endpoint:**

```
GET https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/ParcelsWithRealEstateCC/FeatureServer/0/query
    ?where=1=1&outFields=*&outSR=4326&resultRecordCount=1000&resultOffset=0&f=json
```

**Total count check:**

```
GET .../FeatureServer/0/query?where=1=1&returnCountOnly=true&f=json
→ { "count": 337072 }
```

**Returns (per feature):**


| Field                                                             | Description                      | Normalized to                     |
| ----------------------------------------------------------------- | -------------------------------- | --------------------------------- |
| `PIN`                                                             | Parcel ID number (DuPage format) | `parcels.pin`                     |
| `PROPSTNUM` + `PROPSTNAME` + `PROPCITY`                           | Property street address          | `parcels.address`                 |
| `PROPZIP`                                                         | Property ZIP code                | `parcels.address_components`      |
| `BILLNAME`                                                        | Owner/taxpayer mailing name      | `parcels.owner_name`              |
| `BILLSTNUM` + `BILLSTNAME` + `BILLCITY` + `BILLSTATE` + `BILLZIP` | Owner mailing address            | `parcels.owner_address`           |
| `ACREAGE`                                                         | Lot size in acres                | `parcels.lot_area_sqft` (× 43560) |
| `MUNICIPALITY`                                                    | Municipality within DuPage       | `parcels.raw_attributes`          |
| `TAXCODE`                                                         | Tax code area                    | `parcels.raw_attributes`          |
| `BILLVALUE`                                                       | Assessed/billed value            | `parcels.assessed_value`          |
| `TAXRATE`                                                         | Tax rate                         | `parcels.raw_attributes`          |
| `TAXAMOUNT`                                                       | Annual tax amount                | `parcels.raw_attributes`          |
| `REA017_PROP_CLASS`                                               | Property classification code     | `parcels.land_use_code`           |
| `REA017_FCV_LAND`                                                 | Full cash value — land           | `parcels.land_value`              |
| `REA017_FCV_IMP`                                                  | Full cash value — improvements   | `parcels.building_value`          |
| `REA017_FCV_TOTAL`                                                | Full cash value — total          | `parcels.assessed_value`          |
| `REA017_DUAL_LAND/IMP/TOTAL`                                      | Dual assessment values           | `parcels.raw_attributes`          |
| `EXEMPTCODE`                                                      | Tax exemption code               | `parcels.raw_attributes`          |
| `GRADESCHOOLDISTRICT`                                             | Grade school district            | `parcels.raw_attributes`          |
| `HIGHSCHOOLDISTRICT`                                              | High school district             | `parcels.raw_attributes`          |
| `UNITSCHOOLDISTRICT`                                              | Unit school district             | `parcels.raw_attributes`          |
| `COMMUNITYCOLLEGEDISTRICT`                                        | Community college district       | `parcels.raw_attributes`          |
| `FIREPROTECTIONDISTRICT`                                          | Fire protection district         | `parcels.raw_attributes`          |
| `LIBRARYDISTRICT`                                                 | Library district                 | `parcels.raw_attributes`          |
| `PARKDISTRICT`                                                    | Park district                    | `parcels.raw_attributes`          |
| `SANITARYDISTRICT`                                                | Sanitary district                | `parcels.raw_attributes`          |
| `MOSQUITOABATEMENTDISTRICT`                                       | Mosquito abatement district      | `parcels.raw_attributes`          |
| `SURFACEWATERDISTRICT`                                            | Surface water district           | `parcels.raw_attributes`          |
| `SPECIALSERVICEDISTRICT`                                          | Special service district         | `parcels.raw_attributes`          |
| `SPECIALPOLICEDISTRICT`                                           | Special police district          | `parcels.raw_attributes`          |
| `WATERCOMMISSION`                                                 | Water commission                 | `parcels.raw_attributes`          |
| `AIRPORTAUTHORITY`                                                | Airport authority                | `parcels.raw_attributes`          |
| `LEGALDES1`–`LEGALDES9`                                           | Legal description segments       | `parcels.legal_description`       |
| `MAJOR_PROPERTY_OWNER`                                            | Major owner flag                 | `parcels.raw_attributes`          |
| `River_Basin1`–`River_Basin4`                                     | Watershed/river basin            | `parcels.raw_attributes`          |
| `PARCEL_STATUS` / `PARCELSTAT`                                    | Active/inactive status           | `parcels.raw_attributes`          |
| `SHAPE`                                                           | Polygon geometry                 | `parcels.geometry` (PostGIS)      |


**Use case:** The primary parcel record for DuPage. Answers: *"Who owns this parcel?", "What's it assessed at?", "What school district is it in?", "What taxing districts apply?"*. 338 pages × 1000 records = full county coverage.

---

### 3. ParcelSearch — Assessment Viewer (Cadastral Detail)

**Service metadata:**

```
GET https://gis.dupageco.org/arcgis/rest/services/ParcelSearch/DuPageAssessmentParcelViewer/MapServer/layers?f=json
```

**All layers returned (28 total):**


| Layer ID | Name                     | Geometry           | Purpose                                                      |
| -------- | ------------------------ | ------------------ | ------------------------------------------------------------ |
| 0        | Parcel Blocks            | Polygon            | Block-level groupings                                        |
| 1        | Parcel Block Numbers     | Polygon/Annotation | Block number labels                                          |
| 4        | **Cadastral Realestate** | Polygon            | Full assessment record (60+ fields including OWNERSHIP_TYPE) |
| 5        | Subdivision Lot Lines    | Polyline           | Lot boundary lines with dimensions                           |
| 6        | Lot Dimensions           | Annotation         | Dimension labels                                             |
| 9        | Parcel Dimensions        | Annotation         | Parcel dimension labels                                      |
| 12       | ROW Dimensions           | Annotation         | Right-of-way dimensions                                      |
| 14       | Subdiv Lot Numbers       | Annotation         | Subdivision lot number labels                                |
| 17       | Parcel Numbers           | Annotation         | Parcel PIN labels                                            |
| 21       | Other Dimensions         | Annotation         | Miscellaneous dimensions                                     |


**Key layer to query — Layer 4 (Cadastral Realestate):**

```
GET .../DuPageAssessmentParcelViewer/MapServer/4/query
    ?where=1=1&outFields=*&outSR=4326&resultRecordCount=1000&resultOffset=0&f=json
```

Additional fields beyond the FeatureServer layer:

- `OWNERSHIP_TYPE` — individual, corporate, trust, government
- Full parcel block/subdivision context
- HQS mapping references

**Use case:** Deeper assessment details and ownership type classification. Supplements the FeatureServer parcel layer. Important for queries like *"Find all corporate-owned parcels over 5 acres in DuPage"*.

---

### 4. Unincorporated Zoning

**Endpoint:**

```
GET https://gis.dupageco.org/arcgis/rest/services/Zoning/UnincorporatedZoningData/MapServer/0/query
    ?where=1=1&outFields=*&outSR=4326&resultRecordCount=1000&resultOffset=0&f=json
```

**Returns:**


| Field         | Description                                  |
| ------------- | -------------------------------------------- |
| `ZONING`      | Zoning district code (R-1, B-2, A-1, etc.)   |
| `ZCODE`       | Numeric zoning code                          |
| `Link_to_Ord` | URL link to the actual zoning ordinance text |
| `SHAPE`       | Polygon geometry of the zone                 |


**Use case:** Spatial join with parcels to determine what zone a parcel falls in (for unincorporated DuPage). The `Link_to_Ord` field directly links to ordinance text — critical for RAG. Answers: *"What zone is this parcel in?", "Show all A-1 agricultural parcels in unincorporated DuPage"*.

---

### 5. Flood Zones (FEMA SFHA)

**Endpoint:**

```
GET https://gis.dupageco.org/arcgis/rest/services/Stormwater/SpecialFloodHazardAreasDuPage/MapServer/0/query
    ?where=1=1&outFields=*&outSR=4326&resultRecordCount=1000&resultOffset=0&f=json
```

**Layers:**

- Layer 0: Special Flood Hazard Area Floodway
- Layer 1: Special Flood Hazards

**Returns:**


| Field        | Description                    | Values                                 |
| ------------ | ------------------------------ | -------------------------------------- |
| `FLD_ZONE`   | FEMA flood zone classification | A, AE, AH, AO, X, X PROTECTED BY LEVEE |
| `FLOODWAY`   | Floodway designation           | FLOODWAY / (blank)                     |
| `STATIC_BFE` | Base Flood Elevation           | numeric (feet)                         |
| `SHAPE`      | Polygon geometry               |                                        |


**Use case:** Critical filter layer. Answers: *"Is this parcel in a flood zone?", "Find all R-3 parcels NOT in an AE flood zone"*. Spatial intersection with parcel geometries in PostGIS.

---

### 6. Wetlands

**Endpoints:**

```
GET https://gis.dupageco.org/arcgis/rest/services/NaturalAreas/Wetlands_Inventory/MapServer
GET https://gis.dupageco.org/arcgis/rest/services/OpenData/Wetlands/MapServer
```

**Use case:** Environmental overlay for development feasibility. Parcels intersecting wetlands face strict permitting. Answers: *"Does this parcel contain wetlands?", "Find parcels near wetlands in Naperville"*.

---

### 7. Municipality Boundaries

**Endpoint:**

```
GET https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/Municipality/MapServer/0/query
    ?where=1=1&outFields=*&outSR=4326&f=json
```

**Use case:** Resolve which municipality a parcel belongs to (for routing to correct municipal zoning code). Answers: *"Is 425 Fawell Blvd in Naperville or Lisle?"*. Also used to determine which Municode/eCode360 zoning ordinance applies.

---

### 8. School Districts

**Endpoints:**

```
GET https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/Grade_School_Districts/MapServer
GET https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/High_School_Districts/MapServer
GET https://gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/Schools/MapServer
```

**Use case:** School district assignment per parcel — key factor in residential real estate valuations. Answers: *"What school district is this parcel in?", "Find all parcels in District 203 (Naperville)"*.

---

### 9. Soils / Hydric Soils

**Endpoints:**

```
GET https://gis.dupageco.org/arcgis/rest/services/Environmental/DuPage_SSURGO_Soils_2024/MapServer
GET https://gis.dupageco.org/arcgis/rest/services/Environmental/HydricSoils2024/MapServer
```

**Use case:** Site suitability and environmental due diligence. Hydric soils indicate wetland/drainage constraints. Answers: *"What are the soil conditions on this parcel?", "Identify parcels with hydric soil limitations"*.

---

### 10. Transportation / Road Centerlines

**Endpoints:**

```
GET https://gis.dupageco.org/arcgis/rest/services/Transportation/Road_Centerlines/MapServer
GET https://gis.dupageco.org/arcgis/rest/services/Transportation/RoadTypeCenterline/MapServer
```

**Use case:** Address geocoding fallback, proximity queries (e.g., *"Parcels within 500ft of a major arterial road"*), and routing context.

---

### 11. Additional DuPage Layers (Full enumeration)

These will be auto-discovered by the pipeline and stored in `data_layers` + `spatial_features`:


| Folder       | Service                            | Notes                         |
| ------------ | ---------------------------------- | ----------------------------- |
| Hydrography  | DPMS_LakesPonds_Service            | Lakes and ponds polygons      |
| OpenData     | RiversStreams                      | River/stream centerlines      |
| OpenData     | ROW                                | Right-of-way boundaries       |
| OpenData     | Subdiv_Lots                        | Subdivision lot polygons      |
| OpenData     | Subdivision                        | Subdivision boundaries        |
| PublicWorks  | SSewerALLSYSview                   | Sanitary sewer infrastructure |
| PublicWorks  | WaterALLSYSview                    | Water main infrastructure     |
| Elections    | EarlyVotingLocations               | Voting locations (points)     |
| Elections    | PollingLocations_Precincts         | Precinct boundaries           |
| Stormwater   | DuPage_RFM_Flood_Zones             | Regional flood model zones    |
| Stormwater   | WatershedStatusFEQ                 | Watershed status              |
| NaturalAreas | Lakes                              | Natural lakes                 |
| NaturalAreas | WetlandsMapInitiativeReviewService | Wetland review overlay        |


---

## Cook County

**Primary ArcGIS Base:** `https://gis12.cookcountyil.gov/arcgis/rest/services` *(timing out — use fallbacks below)*
**Open Data Hub:** `https://hub-cookcountyil.opendata.arcgis.com`
**Socrata Catalog:** `https://datacatalog.cookcountyil.gov`

The ArcGIS server structure mirrors DuPage (same Esri platform, same REST patterns) but the server is currently unreachable from our environment. Once reachable, the discovery pattern is identical:

**Known Cook County folders (from documentation):**
`Assessor`, `Zoning`, `Political`, `Election`, `Census_Unincorporated`, `Land_Use_Land_Cover`, `buildingFootprint`, `Tax_Districts`, `Brownfields`

---

### 12. Cook County Open Data Hub — Dataset Search API

**Endpoint:**

```
GET https://hub-cookcountyil.opendata.arcgis.com/api/search/v1/collections/all/items
    ?limit=100&f=json
```

**Returns:** Dataset catalog with download URLs and ArcGIS Feature Service URLs for each dataset.

**Known dataset categories:**

- Property & Land Records (parcels, assessments, PIN lookup)
- Boundaries & Districts (zoning, political, census, TIF districts)
- Natural Environment (land cover, brownfields, wetlands)
- Transportation
- Imagery (building footprints, LiDAR)

**Use case:** Enumerate all Cook County datasets programmatically when the direct ArcGIS server is unreachable. Each dataset entry includes a FeatureServer URL that follows the same query pattern as DuPage.

---

### 13. Cook County Assessor Open Data (Socrata)

**Endpoint:**

```
GET https://datacatalog.cookcountyil.gov/resource/{dataset_id}.json
    ?$limit=1000&$offset=0
```

**Known datasets:**

- `assessments` — PIN, address, class, assessed values, land/building split
- `parcel_sales` — recent sales history per PIN
- `exemptions` — homeowner, senior, veteran exemptions
- `characteristics` — building sqft, year built, bedrooms, bathrooms

**Use case:** Assessor-specific data not always in the GIS layers — sales history, building characteristics, exemptions. Answers: *"What did this property last sell for?", "Find all properties with senior exemptions in Lincoln Park"*.

---

## Municipal Zoning Sources

---

## The County-to-Municipality Hierarchy Problem

This is the core architectural challenge of the project.

County GIS data (parcels, flood zones, tax districts) and municipal zoning data (permitted uses, setbacks, density limits) live in **completely separate systems with no link between them**. A parcel record from DuPage tells you the PIN, owner, lot size, and school district — it does not tell you what you're allowed to build on it. That answer lives in Naperville's zoning ordinance on Municode, a system that has no knowledge of DuPage's GIS.

```
DuPage County GIS                    Naperville Municode
─────────────────                    ────────────────────
PIN: 0206309011                      R-3 District:
Owner: John Smith                      - min lot: 10,000 sqft
Lot: 12,000 sqft          ???          - permitted: single-family
Geometry: POLYGON(...)                 - conditional: two-flat
Municipality: Naperville               - max height: 35ft
```

**Your schema is the bridge.** The `municipality_id` foreign key on the `parcels` table — resolved via a spatial join against municipality boundary polygons — is what connects these two worlds.

---

### Why "Abstracting Across the Hierarchy" Matters

The evaluator will ask: *"Can you add Downers Grove (DuPage) or Oak Park (Cook) without touching existing code?"*

**Bad abstraction — hardcoded logic:**
```typescript
if (county === "dupage" && city === "naperville") {
  return queryNapervilleZoningTable()
} else if (county === "cook" && city === "chicago") {
  return queryChicagoZoningTable()
}
// breaks the moment you add a 3rd municipality
```

**Good abstraction — hierarchy encoded in schema:**
```
parcel.geometry
  → ST_Intersects → municipality_boundaries
  → municipality.id
  → zoning_districts WHERE municipality_id = X
  → permitted_uses WHERE district_id = X
```

Adding a new municipality = one new row in `municipalities` + run `ingest_municipality(id)`. Zero code changes.

---

### Schema Relationships That Encode the Hierarchy

```
counties
  id: dupage
  │
  ├── parcels
  │     pin: 0206309011
  │     geometry: POLYGON(...)
  │     municipality_id: naperville   ← resolved by spatial join at ingest time
  │
  └── municipalities
        id: naperville
        county_id: dupage
        zoning_source: municode          ← which adapter to use
        zoning_url: library.municode.com/il/naperville
        │
        ├── zoning_districts
        │     district_code: R-3
        │     municipality_id: naperville
        │     │
        │     ├── permitted_uses
        │     │     use: "multifamily residential"
        │     │     permit_type: by_right
        │     │
        │     └── development_standards
        │           min_lot_sqft: 10000
        │           max_height_ft: 35
        │           front_setback_ft: 30
        │
        └── document_chunks
              chunk_text: "R-3 Residential District..."
              pinecone_id: uuid   ← for semantic search
```

The spatial join (`ST_Intersects(parcel.geometry, municipality.geometry)`) happens **at parcel ingest time** and writes `municipality_id` onto each parcel row. After that, every query that needs zoning context can traverse the hierarchy purely through foreign keys — no geometry operations needed at query time.

---

### The Adapter Pattern — One Interface, Four Implementations

Different municipalities publish zoning in completely different formats. The abstraction layer is a `ZoningAdapter` interface with one implementation per source type:

```typescript
interface ZoningAdapter {
  fetchTableOfContents(municipality: Municipality): Promise<TOCNode[]>
  fetchSection(node: TOCNode): Promise<string>  // returns plain text
}

class PdfDirectAdapter    implements ZoningAdapter { }  // HTTP GET + pdf-parse
class MunicodeAdapter     implements ZoningAdapter { }  // Playwright headless browser
class ECode360Adapter     implements ZoningAdapter { }  // Playwright or JSON API
class AMLegalAdapter      implements ZoningAdapter { }  // Playwright headless browser
```

After text is extracted, a **single shared parser** (LLM-assisted extraction) runs on all four — producing the same structured output regardless of source:

```
raw text (any source)
  → extract zoning districts
  → extract permitted uses per district
  → extract development standards per district
  → store in zoning_districts / permitted_uses / development_standards
  → chunk text → embed → store in Pinecone
```

The `municipalities.zoning_source` field determines which adapter gets instantiated at runtime. Adding eCode360 support for a new municipality is just adding a new adapter class — nothing else changes.

---

### The 4 Source Formats (confirmed via live probing)

| Format | How it Works | Access Method |
|---|---|---|
| **Municipality PDFs** | City hosts chapter-by-chapter PDFs on their own CMS | HTTP GET → `pdf-parse` |
| **Municode** | JavaScript SPA, backend API returns 401 to plain HTTP | Playwright headless browser |
| **eCode360** | JavaScript SPA, returns 403 to plain HTTP | Playwright, or try JSON API at `/api/1/{code}/toc` |
| **American Legal** | JavaScript SPA, returns 403 to plain HTTP | Playwright headless browser |

---

### Selected Municipalities

| Municipality | County | Source Type | Access Method | Notes |
|---|---|---|---|---|
| Wheaton | DuPage | Municipality PDFs (city website) | HTTP + pdf-parse | 34 chapter PDFs confirmed at `wheaton.il.us/DocumentCenter/View/{ID}` |
| Naperville | DuPage | Municode | Playwright | `library.municode.com/il/naperville` |
| Chicago | Cook | American Legal | Playwright | `codelibrary.amlegal.com/codes/chicagoil/` |
| Evanston | Cook | Municode | Playwright | `library.municode.com/il/evanston` |

**Build order:** Start with Wheaton (PDFs, simplest path, no JS rendering). Get the full pipeline working end-to-end — ingest → parse → store → query. Then generalize the adapter to handle Playwright-based sources.

---

### 14. Wheaton — Direct PDF Chapters (confirmed working, no auth)

**Index page:**
```
GET https://www.wheaton.il.us/584/Zoning-Ordinances
```

**34 chapter PDFs, all publicly downloadable:**

| URL | Chapter |
|---|---|
| `https://www.wheaton.il.us/DocumentCenter/View/1084` | Table of Contents |
| `https://www.wheaton.il.us/DocumentCenter/View/1087` | Ch 02: Definitions |
| `https://www.wheaton.il.us/DocumentCenter/View/1088` | Ch 03: Zoning Districts & General Regulations |
| `https://www.wheaton.il.us/DocumentCenter/View/1092` | Ch 07: R-1 Residential District |
| `https://www.wheaton.il.us/DocumentCenter/View/1093` | Ch 08: R-2 Residential District |
| `https://www.wheaton.il.us/DocumentCenter/View/1094` | Ch 09: R-3 Residential District |
| `https://www.wheaton.il.us/DocumentCenter/View/1095` | Ch 10: R-4 Residential District |
| `https://www.wheaton.il.us/DocumentCenter/View/1096` | Ch 11: R-5 Residential District |
| `https://www.wheaton.il.us/DocumentCenter/View/1097` | Ch 12: R-6 Residential District |
| `https://www.wheaton.il.us/DocumentCenter/View/1098` | Ch 13: R-7 Residential District |
| `https://www.wheaton.il.us/DocumentCenter/View/1099` | Ch 14: I-1 and I-2 Institutional District |
| `https://www.wheaton.il.us/DocumentCenter/View/1100` | Ch 15: O-R Office and Research District |
| `https://www.wheaton.il.us/DocumentCenter/View/1101` | Ch 16: C-1 Local Business District |
| `https://www.wheaton.il.us/DocumentCenter/View/1102` | Ch 17: C-2 Retail Core Business District |
| `https://www.wheaton.il.us/DocumentCenter/View/1103` | Ch 18: C-3 General Business District |
| `https://www.wheaton.il.us/DocumentCenter/View/1104` | Ch 19: C-4 CBD Perimeter Commercial District |
| `https://www.wheaton.il.us/DocumentCenter/View/1105` | Ch 20: C-5 Planned Commercial District |
| `https://www.wheaton.il.us/DocumentCenter/View/1106` | Ch 21: M-1 Manufacturing District |
| `https://www.wheaton.il.us/DocumentCenter/View/1107` | Ch 22: Off-Street Parking and Loading |
| `https://www.wheaton.il.us/DocumentCenter/View/1108` | Ch 23: Signs |
| `https://www.wheaton.il.us/DocumentCenter/View/1109` | Ch 24: Accessory Uses and Home Occupations |
| `https://www.wheaton.il.us/DocumentCenter/View/1110` | Ch 25: Performance Standards |
| `https://www.wheaton.il.us/DocumentCenter/View/1112` | Ch 27: Downtown Design Review Overlay District |
| `https://www.wheaton.il.us/DocumentCenter/View/1113` | Ch 28: Northside Residential Overlay District |
| `https://www.wheaton.il.us/DocumentCenter/View/17507` | Ch 31: Roosevelt Road Corridor District |
| `https://www.wheaton.il.us/DocumentCenter/View/17921` | Ch 32: DuPage County Governmental Center District |

**Ingestion flow:**
```
1. HTTP GET each PDF URL → binary
2. pdf-parse → plain text per chapter
3. LLM extraction → structured districts / permitted uses / standards
4. Store in zoning_districts, permitted_uses, development_standards
5. Chunk text (500 tokens) → embed → store in Pinecone
   with metadata: { municipality: "wheaton", county: "dupage", district_code: "R-3" }
```

---

### 15. Naperville — Municode (Playwright required)

**URL:** `https://library.municode.com/il/naperville`

Municode is a JavaScript SPA. Backend API returns 401 to plain HTTP. Requires Playwright to render.

```
1. playwright.chromium.launch()
2. page.goto("https://library.municode.com/il/naperville")
3. Wait for TOC sidebar to render
4. Find zoning title (Title 6 or Title 17 depending on Naperville's structure)
5. Walk chapter tree → click each district section
6. page.textContent() → extract ordinance text per section
7. Same LLM extraction + storage as Wheaton
```

---

### 16. Chicago — American Legal (Playwright required)

**URL:** `https://codelibrary.amlegal.com/codes/chicagoil/latest/`

Chicago's Title 17 is the zoning ordinance. Access via Playwright — same pattern as Municode.

---

### 17. Evanston — Municode (Playwright required)

**URL:** `https://library.municode.com/il/evanston`

Same Playwright pattern as Naperville.

---

### Data Extracted (all sources, same output schema)

| Data Type | Example | Storage |
|---|---|---|
| District codes | R-1, R-2, R-3, B-1, B-2, M-1, PD | `zoning_districts.district_code` |
| District names | Single Family Residential, General Business | `zoning_districts.district_name` |
| Permitted uses by right | Single-family detached dwelling | `permitted_uses` (permit_type=by_right) |
| Conditional uses | Day care center, religious institution | `permitted_uses` (permit_type=conditional) |
| Prohibited uses | Adult entertainment, heavy manufacturing | `permitted_uses` (permit_type=prohibited) |
| Minimum lot size | 8,000 sqft | `development_standards` |
| Minimum lot width | 65 ft | `development_standards` |
| Front setback | 30 ft | `development_standards` |
| Rear setback | 25 ft | `development_standards` |
| Side setback | 7.5 ft | `development_standards` |
| Maximum height | 35 ft / 2.5 stories | `development_standards` |
| Maximum lot coverage | 40% | `development_standards` |
| Maximum density | 4 units/acre | `development_standards` |
| Floor area ratio | 0.5 | `development_standards` |
| Raw section text | Full text per section | `document_chunks` → Pinecone |

---

## How the Layers Compose for Key Queries

### Query: *"Find R-3 parcels over 10,000 sqft in DuPage, not in a flood zone, that allow multifamily by right"*

```
Step 1: filter_parcels(county=dupage, min_lot_sqft=10000)
        → hits ParcelsWithRealEstateCC FeatureServer [API #2]

Step 2: spatial_query(flood_zone_filter=exclude)
        → spatial join with SpecialFloodHazardAreasDuPage [API #5]
        → PostGIS: ST_Disjoint(parcel.geometry, flood.geometry)

Step 3: filter by zoning
        → spatial join with UnincorporatedZoningData [API #4]
        → WHERE zoning_code LIKE 'R-3%'

Step 4: get_permitted_uses(district=R-3, municipality=naperville)
        → query permitted_uses table (ingested from Municode [API #14])
        → check permit_type = 'by_right' for 'multifamily'

Step 5: Compose answer
```

### Query: *"What's the zoning for 425 Fawell Blvd, Naperville and what uses are permitted?"*

```
Step 1: lookup_parcel(address="425 Fawell Blvd, Naperville")
        → hits ParcelsWithRealEstateCC [API #2], get PIN + geometry

Step 2: ST_Intersects(parcel.geometry, zoning.geometry)
        → determine zone code from UnincorporatedZoningData [API #4]
        → or from municipality zoning layer if incorporated

Step 3: get_permitted_uses(district=resolved_zone, municipality=naperville)
        → query permitted_uses table [API #14]

Step 4: search_zoning_text("permitted uses R-3 Naperville")
        → Pinecone semantic search over Municode chunks [API #14]

Step 5: Compose answer with zone + full permitted use list
```

---

## Gaps & Corrections (discovered during live probing)

### Gap 1 — DCAT Feed (missing from original inventory)

The DuPage Open Data Portal exposes a machine-readable catalog of every published dataset with its FeatureServer URL. This should be the **first call** the pipeline makes before walking the ArcGIS REST service tree:

```
GET https://gisdata-dupage.opendata.arcgis.com/api/feed/dcat-us/1.1.json
```

Returns every dataset with:
- Name + description
- Download formats (CSV, GeoJSON, Shapefile, KML)
- `accessURL` → the actual FeatureServer or MapServer endpoint

**Why this matters:** Some datasets published on the Open Data Portal are hosted on `services.arcgis.com` (ArcGIS Online), not on `gis.dupageco.org`. The DCAT feed is the only place that surfaces those URLs. Without it, the direct ArcGIS REST walk would miss them.

Confirmed datasets found via DCAT feed (not discoverable from `gis.dupageco.org` alone):

| Dataset | FeatureServer URL |
|---|---|
| Municipalities | `https://services.arcgis.com/neJvtQ4PXvnQ86MJ/arcgis/rest/services/Municipalities/FeatureServer/0` |
| DuPage County Boundary | `https://services.arcgis.com/neJvtQ4PXvnQ86MJ/arcgis/rest/services/County/FeatureServer/0` |
| Subdivisions | `https://utility.arcgis.com/usrsvcs/servers/98d84f3be7954ff39f8da076d6986731/rest/services/OpenData/Subdivision/MapServer/1` |

---

### Gap 2 — Municipalities endpoint correction

Originally documented as:
```
gis.dupageco.org/arcgis/rest/services/DuPage_County_IL/Municipality/MapServer/0
```

Actual published endpoint (from DCAT feed):
```
services.arcgis.com/neJvtQ4PXvnQ86MJ/arcgis/rest/services/Municipalities/FeatureServer/0
```

Both may return data but the `services.arcgis.com` URL is the authoritative published version. The pipeline must handle both `gis.dupageco.org` and `services.arcgis.com` as valid base hosts — cannot assume all layers live on the county server.

---

### Two-Phase Discovery (updated pipeline approach)

Original plan was a single ArcGIS REST walk. Updated to two phases to ensure complete coverage:

```
Phase A — Open Data Portal DCAT feed
  GET gisdata-dupage.opendata.arcgis.com/api/feed/dcat-us/1.1.json
  → captures published datasets including those hosted on services.arcgis.com

Phase B — Direct ArcGIS REST walk
  GET gis.dupageco.org/arcgis/rest/services?f=json → walk all folders
  → captures unpublished layers (flood zones, soils, roads, hydrology, etc.
    that exist on the county server but aren't in the Open Data Portal)

Merge both result sets
  → deduplicate by FeatureServer URL
  → store complete inventory in data_layers table
```

This guarantees no layer is missed regardless of where it's hosted.

---

## Pagination Reference


| County | Layer                   | Total Records | Pages (×1000) |
| ------ | ----------------------- | ------------- | ------------- |
| DuPage | ParcelsWithRealEstateCC | 337,072       | 338           |
| DuPage | Zoning (Uninc_Zoning)   | TBD           | TBD           |
| DuPage | Flood Zones (SFHA)      | TBD           | TBD           |
| DuPage | Municipality            | ~35           | 1             |
| DuPage | School Districts        | TBD           | TBD           |
| Cook   | Parcels (Assessor)      | ~1,800,000    | ~1,800        |


---

## Rate Limiting Strategy


| Source        | Limit           | Strategy                                          |
| ------------- | --------------- | ------------------------------------------------- |
| DuPage ArcGIS | No stated limit | Max 3 concurrent, 200ms delay between requests    |
| Cook ArcGIS   | No stated limit | Max 3 concurrent, 200ms delay between requests    |
| Municode      | Public scrape   | 1 req/sec, respect robots.txt, rotate user-agents |
| eCode360      | Public scrape   | 1 req/sec                                         |


All requests: exponential backoff on 429/503 (2s → 4s → 8s → 16s, max 5 retries).

---

## Summary Table


| #   | Endpoint                                             | County | Data Type                                        | Records Est.     | Auth |
| --- | ---------------------------------------------------- | ------ | ------------------------------------------------ | ---------------- | ---- |
| 1a  | DuPage `/services?f=json`                            | DuPage | Layer discovery (Phase B — county server)        | 25+ folders      | None |
| 1b  | `gisdata-dupage.opendata.arcgis.com/api/feed/dcat-us/1.1.json` | DuPage | Layer discovery (Phase A — Open Data Portal) | All published datasets | None |
| 2   | `ParcelsWithRealEstateCC/FeatureServer/0/query`      | DuPage | Parcel + assessment + all districts              | 337,072          | None |
| 3   | `DuPageAssessmentParcelViewer/MapServer/layers`      | DuPage | Assessment detail, ownership type                | 337,072          | None |
| 4   | `Zoning/UnincorporatedZoningData/MapServer/0/query`  | DuPage | Zoning polygons + ordinance links                | TBD              | None |
| 5   | `Stormwater/SpecialFloodHazardAreasDuPage/MapServer` | DuPage | FEMA flood zones                                 | TBD              | None |
| 6   | `NaturalAreas/Wetlands_Inventory/MapServer`          | DuPage | Wetland polygons                                 | TBD              | None |
| 7   | `DuPage_County_IL/Municipality/MapServer/0/query`    | DuPage | Municipality boundaries                          | ~35              | None |
| 8   | `DuPage_County_IL/Grade_School_Districts/MapServer`  | DuPage | School district polygons                         | TBD              | None |
| 9   | `Environmental/HydricSoils2024/MapServer`            | DuPage | Soil/hydric data                                 | TBD              | None |
| 10  | `Transportation/Road_Centerlines/MapServer`          | DuPage | Road network                                     | TBD              | None |
| 11  | All other DuPage folders                             | DuPage | Misc overlays                                    | TBD              | None |
| 12  | `hub-cookcountyil.opendata.arcgis.com`               | Cook   | Dataset catalog + FeatureServer URLs             | 50+ datasets     | None |
| 13  | `datacatalog.cookcountyil.gov` (Socrata)             | Cook   | Assessor data, sales, exemptions                 | ~1.8M parcels    | None |
| 14  | `municode.com` (scrape)                              | Both   | Zoning ordinance text, permitted uses, standards | 4 municipalities | None |
| 15  | `ecode360.com` (scrape)                              | Both   | Zoning ordinance text (alt source)               | Varies           | None |


