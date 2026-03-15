import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  jsonb,
  timestamp,
  customType,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// PostGIS geometry custom type
// Drizzle doesn't natively support PostGIS so we declare it as a custom type.
// All geometries are stored in EPSG:4326 (WGS84 lat/lng).
// ---------------------------------------------------------------------------
const geometry = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geometry(Geometry, 4326)'
  },
})


export const counties = pgTable('counties', {
  id:         varchar('id', { length: 50 }).primaryKey(),   // 'cook' | 'dupage'
  name:       varchar('name', { length: 100 }).notNull(),
  state:      varchar('state', { length: 2 }).notNull(),
  fips:       varchar('fips', { length: 10 }),
  gisBaseUrl: text('gis_base_url'),
  portalType: varchar('portal_type', { length: 20 }),       // 'arcgis' | 'socrata'
  metadata:   jsonb('metadata'),
  createdAt:  timestamp('created_at').defaultNow().notNull(),
})

export const municipalities = pgTable('municipalities', {
  id:            varchar('id', { length: 100 }).primaryKey(), // 'naperville' | 'wheaton'
  countyId:      varchar('county_id', { length: 50 })
                   .notNull()
                   .references(() => counties.id),
  name:          varchar('name', { length: 100 }).notNull(),
  state:         varchar('state', { length: 2 }).notNull(),
  // Which system the zoning ordinance lives in
  zoningSource:  varchar('zoning_source', { length: 20 }),  // 'pdf_direct' | 'municode' | 'ecode360' | 'amlegal'
  zoningUrl:     text('zoning_url'),
  lastScrapedAt: timestamp('last_scraped_at'),
})

// ---------------------------------------------------------------------------
// LAYER DISCOVERY REGISTRY
// One row per data layer discovered from the ArcGIS REST walk + DCAT feed.
// This is the source of truth for list_available_layers tool.
// ---------------------------------------------------------------------------

export const dataLayers = pgTable('data_layers', {
  id:           uuid('id').defaultRandom().primaryKey(),
  countyId:     varchar('county_id', { length: 50 })
                  .notNull()
                  .references(() => counties.id),
  layerName:    varchar('layer_name', { length: 200 }).notNull(),
  // 'parcel' | 'flood' | 'zoning' | 'school' | 'wetland' | 'road' | 'municipality' | 'misc'
  layerType:    varchar('layer_type', { length: 50 }),
  serviceUrl:   text('service_url').notNull(),
  // Maps source field names → our normalized field names e.g. { "PIN14": "pin", "SITE_ADDR": "address" }
  fieldMapping: jsonb('field_mapping'),
  lastSyncedAt: timestamp('last_synced_at'),
  recordCount:  integer('record_count'),
  metadata:     jsonb('metadata'),
},
(t) => [
  uniqueIndex('uq_data_layers_county_url').on(t.countyId, t.serviceUrl),
]
)

// ---------------------------------------------------------------------------
// PARCELS
// Two physical tables (one per county) + a unified view defined in migrations.
// Counties have different source field names — normalization happens at ingest
// time using dataLayers.fieldMapping. Tier-1 fields are promoted to typed
// columns and indexed. Everything else goes into rawAttributes JSONB.
// ---------------------------------------------------------------------------

export const parcelsDupage = pgTable(
  'parcels_dupage',
  {
    id:               uuid('id').defaultRandom().primaryKey(),
    pin:              varchar('pin', { length: 50 }).notNull().unique(),
    municipalityId:   varchar('municipality_id', { length: 100 })
                        .references(() => municipalities.id),

    // --- Tier 1: promoted, indexed, queryable by tools ---
    address:          text('address'),
    ownerName:        text('owner_name'),
    ownerAddress:     text('owner_address'),
    legalDescription: text('legal_description'),
    landUseCode:      varchar('land_use_code', { length: 20 }),
    zoningCode:       varchar('zoning_code', { length: 30 }),
    assessedValue:    numeric('assessed_value'),
    landValue:        numeric('land_value'),
    buildingValue:    numeric('building_value'),
    lotAreaSqft:      numeric('lot_area_sqft'),
    buildingSqft:     numeric('building_sqft'),
    yearBuilt:        integer('year_built'),
    // 'individual' | 'corporate' | 'trust' | 'government'
    ownershipType:    varchar('ownership_type', { length: 20 }),
    // FEMA designation: 'AE' | 'X' | 'A' | 'AH' | 'AO' — populated by
    // spatial join with flood_zones overlay at ingest time
    floodZone:        varchar('flood_zone', { length: 100 }),
    schoolDistrict:   varchar('school_district', { length: 100 }),
    geometry:         geometry('geometry'),

    // --- Tier 2: all remaining county fields, available for display ---
    rawAttributes:    jsonb('raw_attributes'),

    // MD5 hash of rawAttributes — used for delta ingestion (skip if unchanged)
    dataHash:         varchar('data_hash', { length: 64 }),
    lastUpdatedAt:    timestamp('last_updated_at'),
  },
  (t) => [
    index('idx_parcels_dupage_municipality').on(t.municipalityId),
    index('idx_parcels_dupage_zoning').on(t.zoningCode),
    index('idx_parcels_dupage_ownership').on(t.ownershipType),
    index('idx_parcels_dupage_school').on(t.schoolDistrict),
    index('idx_parcels_dupage_flood').on(t.floodZone),
    index('idx_parcels_dupage_values').on(t.assessedValue, t.lotAreaSqft),
    // Composite: most common multi-filter pattern
    index('idx_parcels_dupage_composite').on(t.municipalityId, t.zoningCode, t.ownershipType),
  ]
)

export const parcelsCook = pgTable(
  'parcels_cook',
  {
    id:               uuid('id').defaultRandom().primaryKey(),
    pin:              varchar('pin', { length: 50 }).notNull().unique(),
    municipalityId:   varchar('municipality_id', { length: 100 })
                        .references(() => municipalities.id),

    address:          text('address'),
    ownerName:        text('owner_name'),
    ownerAddress:     text('owner_address'),
    legalDescription: text('legal_description'),
    landUseCode:      varchar('land_use_code', { length: 20 }),
    zoningCode:       varchar('zoning_code', { length: 30 }),
    assessedValue:    numeric('assessed_value'),
    landValue:        numeric('land_value'),
    buildingValue:    numeric('building_value'),
    lotAreaSqft:      numeric('lot_area_sqft'),
    buildingSqft:     numeric('building_sqft'),
    yearBuilt:        integer('year_built'),
    ownershipType:    varchar('ownership_type', { length: 20 }),
    floodZone:        varchar('flood_zone', { length: 100 }),
    schoolDistrict:   varchar('school_district', { length: 100 }),
    geometry:         geometry('geometry'),
    rawAttributes:    jsonb('raw_attributes'),
    dataHash:         varchar('data_hash', { length: 64 }),
    lastUpdatedAt:    timestamp('last_updated_at'),
  },
  (t) => [
    index('idx_parcels_cook_municipality').on(t.municipalityId),
    index('idx_parcels_cook_zoning').on(t.zoningCode),
    index('idx_parcels_cook_ownership').on(t.ownershipType),
    index('idx_parcels_cook_school').on(t.schoolDistrict),
    index('idx_parcels_cook_flood').on(t.floodZone),
    index('idx_parcels_cook_values').on(t.assessedValue, t.lotAreaSqft),
    index('idx_parcels_cook_composite').on(t.municipalityId, t.zoningCode, t.ownershipType),
  ]
)

// ---------------------------------------------------------------------------
// SPATIAL OVERLAY LAYERS
// All non-parcel GIS layers land here: flood zones, wetlands, school district
// boundaries, municipality boundaries, zoning polygons, roads, etc.
// layerType discriminates which kind of feature this row represents.
// The attributes JSONB holds all source fields as-is — no normalization needed
// since these layers are queried spatially, not attribute-filtered.
// ---------------------------------------------------------------------------

export const spatialFeatures = pgTable(
  'spatial_features',
  {
    id:          uuid('id').defaultRandom().primaryKey(),
    countyId:    varchar('county_id', { length: 50 })
                   .references(() => counties.id),
    layerId:     uuid('layer_id')
                   .references(() => dataLayers.id),
    // 'flood_zone' | 'wetland' | 'school_district' | 'municipality' | 'zoning' | 'road' | 'misc'
    layerType:   varchar('layer_type', { length: 50 }).notNull(),
    featureId:   varchar('feature_id', { length: 100 }), // original OBJECTID from source
    geometry:    geometry('geometry').notNull(),
    attributes:  jsonb('attributes'),                    // all source fields verbatim
    dataHash:    varchar('data_hash', { length: 64 }),
    ingestedAt:  timestamp('ingested_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_spatial_county_type').on(t.countyId, t.layerType),
    uniqueIndex('uq_spatial_layer_feature').on(t.layerId, t.featureId),
  ]
)

// ---------------------------------------------------------------------------
// MUNICIPAL ZONING RULES
// Populated from ordinance scraping. These are the structured tables the LLM
// queries via get_zoning_details and get_permitted_uses tools.
// ---------------------------------------------------------------------------

export const zoningDistricts = pgTable(
  'zoning_districts',
  {
    id:             uuid('id').defaultRandom().primaryKey(),
    municipalityId: varchar('municipality_id', { length: 100 })
                      .notNull()
                      .references(() => municipalities.id),
    districtCode:   varchar('district_code', { length: 20 }).notNull(), // R-1, B-2, M-1
    districtName:   text('district_name'),
    // 'residential' | 'commercial' | 'industrial' | 'mixed' | 'overlay' | 'special'
    category:       varchar('category', { length: 30 }),
    description:    text('description'),
  },
  (t) => [
    uniqueIndex('idx_zoning_districts_unique').on(t.municipalityId, t.districtCode),
  ]
)

export const permittedUses = pgTable(
  'permitted_uses',
  {
    id:             uuid('id').defaultRandom().primaryKey(),
    districtId:     uuid('district_id')
                      .notNull()
                      .references(() => zoningDistricts.id),
    useCategory:    varchar('use_category', { length: 100 }),
    useDescription: text('use_description').notNull(),
    // 'by_right' | 'conditional' | 'prohibited' | 'accessory'
    permitType:     varchar('permit_type', { length: 20 }).notNull(),
    conditions:     text('conditions'),
  },
  (t) => [
    index('idx_permitted_uses_district_type').on(t.districtId, t.permitType),
  ]
)

export const developmentStandards = pgTable(
  'development_standards',
  {
    id:           uuid('id').defaultRandom().primaryKey(),
    districtId:   uuid('district_id')
                    .notNull()
                    .references(() => zoningDistricts.id),
    // 'min_lot_sqft' | 'min_lot_width_ft' | 'front_setback_ft' | 'rear_setback_ft'
    // 'side_setback_ft' | 'max_height_ft' | 'max_lot_coverage_pct' | 'max_density'
    // 'floor_area_ratio' | 'min_unit_size_sqft'
    standardType: varchar('standard_type', { length: 50 }).notNull(),
    value:        numeric('value'),
    unit:         varchar('unit', { length: 20 }),   // 'sqft' | 'ft' | '%' | 'units_per_acre'
    conditions:   text('conditions'),
  },
  (t) => [
    index('idx_dev_standards_district').on(t.districtId, t.standardType),
  ]
)

// ---------------------------------------------------------------------------
// RAG CHUNK REGISTRY
// Maps Pinecone vector IDs back to source metadata stored in Postgres.
// The id here is the same UUID used as the vector ID in Pinecone so we can
// hydrate full context after a semantic search returns vector IDs.
// ---------------------------------------------------------------------------

export const documentChunks = pgTable('document_chunks', {
  id:             uuid('id').primaryKey(),              // = Pinecone vector ID
  municipalityId: varchar('municipality_id', { length: 100 })
                    .references(() => municipalities.id),
  districtId:     uuid('district_id')
                    .references(() => zoningDistricts.id),
  sourceType:     varchar('source_type', { length: 30 }), // 'zoning_ordinance'
  chunkText:      text('chunk_text').notNull(),
  sectionId:      varchar('section_id', { length: 50 }),  // e.g. 'Ch-07', '17.3.1'
  sourceUrl:      text('source_url'),
  createdAt:      timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// INGESTION JOB TRACKING
// Every ingest run is recorded here for progress tracking and delta detection.
// ---------------------------------------------------------------------------

export const ingestionJobs = pgTable('ingestion_jobs', {
  id:               uuid('id').defaultRandom().primaryKey(),
  countyId:         varchar('county_id', { length: 50 }),
  layerName:        varchar('layer_name', { length: 200 }),
  // 'full' = re-ingest everything | 'delta' = only changed records
  jobType:          varchar('job_type', { length: 10 }).notNull(),
  // 'pending' | 'running' | 'completed' | 'failed'
  status:           varchar('status', { length: 20 }).notNull().default('pending'),
  recordsProcessed: integer('records_processed').default(0),
  recordsFailed:    integer('records_failed').default(0),
  errorLog:         jsonb('error_log'),
  startedAt:        timestamp('started_at'),
  completedAt:      timestamp('completed_at'),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
})
