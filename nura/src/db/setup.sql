-- Run this ONCE against your Neon database before running any Drizzle migrations.
-- Neon supports PostGIS as a first-class extension — just needs to be enabled.
-- You can run this in the Neon SQL Editor (console.neon.tech) or via psql.

-- Core spatial extension — required for geometry columns and spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Trigram extension — required for fuzzy address search on parcels
-- Enables: CREATE INDEX ... USING GIN (address gin_trgm_ops)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Verify both extensions are active
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name IN ('postgis', 'pg_trgm');
