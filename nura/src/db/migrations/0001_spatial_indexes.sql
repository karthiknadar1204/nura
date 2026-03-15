-- Spatial and text indexes that Drizzle cannot generate automatically.
-- Run this after Drizzle pushes the table schema.

-- ── GIST spatial indexes ──────────────────────────────────────────────────
-- Required for ST_Intersects, ST_DWithin, ST_Within, ST_Contains.
-- Without these, every spatial query is a full table scan.

CREATE INDEX IF NOT EXISTS idx_parcels_dupage_geometry
  ON parcels_dupage USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_parcels_cook_geometry
  ON parcels_cook USING GIST (geometry);

CREATE INDEX IF NOT EXISTS idx_spatial_features_geometry
  ON spatial_features USING GIST (geometry);

-- ── GIN trigram indexes for fuzzy address search ──────────────────────────
-- Required for lookup_parcel(address=...) — enables ~, ILIKE, similarity().
-- Extension pg_trgm must be enabled first (see setup.sql).

CREATE INDEX IF NOT EXISTS idx_parcels_dupage_address_trgm
  ON parcels_dupage USING GIN (address gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_parcels_cook_address_trgm
  ON parcels_cook USING GIN (address gin_trgm_ops);

-- ── Unified parcels view ──────────────────────────────────────────────────
-- Tools query this view instead of hitting county tables directly.
-- The 'county' column lets the LLM's cross_county_query tool tag results.

CREATE OR REPLACE VIEW parcels AS
  SELECT *, 'dupage' AS county FROM parcels_dupage
  UNION ALL
  SELECT *, 'cook'   AS county FROM parcels_cook;
