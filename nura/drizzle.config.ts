import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema:  './src/db/schema.ts',
  out:     './src/db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Tell drizzle-kit to ignore PostGIS system tables.
  // Without this, drizzle-kit push tries to drop spatial_ref_sys,
  // geography_columns etc. which breaks the PostGIS extension.
  extensionsFilters: ['postgis'],
})
