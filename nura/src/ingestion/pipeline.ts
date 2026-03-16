import { sql, eq, and } from 'drizzle-orm'
import { db } from '../db/client'
import {
  counties,
  ingestionJobs,
  dataLayers,
  parcelsDupage,
  parcelsCook,
} from '../db/schema'
import { discoverLayers } from './arcgis/discover'
import { paginateLayer, fetchAllFeaturesParallel } from './arcgis/paginate'
import { normalizeFeature, DUPAGE_FIELD_MAPPING, COOK_FIELD_MAPPING, type FieldMapping } from './arcgis/normalize'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunIngestionOptions {
  countyId: 'dupage' | 'cook' | 'all'
  jobType:  'full' | 'delta'
}

// ── Job helpers ───────────────────────────────────────────────────────────────

async function createJob(countyId: string, layerName: string, jobType: string) {
  const [job] = await db.insert(ingestionJobs).values({
    countyId,
    layerName,
    jobType,
    status:    'running',
    startedAt: new Date(),
  }).returning()
  return job
}

async function completeJob(jobId: string, processed: number, failed: number) {
  await db.update(ingestionJobs).set({
    status:           'completed',
    recordsProcessed: processed,
    recordsFailed:    failed,
    completedAt:      new Date(),
  }).where(eq(ingestionJobs.id, jobId))
}

async function failJob(jobId: string, error: unknown) {
  await db.update(ingestionJobs).set({
    status:      'failed',
    errorLog:    { message: String(error) },
    completedAt: new Date(),
  }).where(eq(ingestionJobs.id, jobId))
}

// ── Step 2: Layer discovery ───────────────────────────────────────────────────

async function runDiscovery(countyId: string) {
  const [county] = await db.select().from(counties).where(eq(counties.id, countyId))
  if (!county) throw new Error(`County not found: ${countyId}`)

  const meta = county.metadata as any
  await discoverLayers(
    countyId,
    county.gisBaseUrl!,
    meta?.dcatFeedUrl,
  )
}

// ── Step 3: Parcel ingestion ──────────────────────────────────────────────────

const INSERT_BATCH = 500  // rows per INSERT to stay within Neon's statement limits

// ── Geometry update pass ──────────────────────────────────────────────────────
// Because drizzle's type system doesn't allow ST_ expressions inline in .values(),
// we do a second pass: fetch parcels with null geometry and update via raw SQL.
// In practice, geometry comes from the same ArcGIS response — we cache it here.

async function updateGeometriesForBatch(
  countyId: 'dupage' | 'cook',
  geomMap: Map<string, string>,  // pin → GeoJSON string
) {
  const tableName = countyId === 'dupage' ? 'parcels_dupage' : 'parcels_cook'
  const entries = Array.from(geomMap.entries())

  // Batch via VALUES clause — one query per 500 rows instead of one query per row
  for (let i = 0; i < entries.length; i += INSERT_BATCH) {
    const slice = entries.slice(i, i + INSERT_BATCH)
    const valueParts = slice.map(([pin, geojson]) => sql`(${pin}, ${geojson})`)
    try {
      await db.execute(sql`
        UPDATE ${sql.raw(tableName)} t
        SET geometry = ST_GeomFromGeoJSON(v.geojson)
        FROM (VALUES ${sql.join(valueParts, sql`, `)}) AS v(pin, geojson)
        WHERE t.pin = v.pin
      `)
    } catch (err) {
      console.warn(`[geometry] batch update failed, skipping ${slice.length} rows:`, err)
    }
  }
}

// Overloaded ingest that also collects geometry and updates in a second pass
async function ingestParcelLayerWithGeometry(
  countyId: 'dupage' | 'cook',
  layer: { id: string; serviceUrl: string; fieldMapping: any; recordCount?: number | null },
  jobType: 'full' | 'delta',
) {
  // Always use the canonical mapping from normalize.ts — the DB copy may be stale
  const fieldMapping: FieldMapping = countyId === 'dupage' ? DUPAGE_FIELD_MAPPING : COOK_FIELD_MAPPING
  const table = countyId === 'dupage' ? parcelsDupage : parcelsCook

  const job = await createJob(countyId, layer.serviceUrl, jobType)
  let processed = 0
  let failed    = 0

  try {
    console.log(`[ingest:${countyId}] Fetching features in parallel pages…`)
    const allFeatures = await fetchAllFeaturesParallel(layer.serviceUrl, {
      onProgress: n => console.log(`[ingest:${countyId}] ${n} features fetched`),
      maxRecords: 10_000,
      knownCount: layer.recordCount ?? undefined,
    })
    console.log(`[ingest:${countyId}] Fetch complete — ${allFeatures.length} features`)

    const rows: any[]            = []
    const geomMap = new Map<string, string>()

    for (const feature of allFeatures) {
      const norm = normalizeFeature(feature.attributes, feature.geometry, fieldMapping)
      if (!norm) { failed++; continue }

      rows.push({
        pin:              norm.pin,
        address:          norm.address,
        ownerName:        norm.ownerName,
        ownerAddress:     norm.ownerAddress,
        legalDescription: norm.legalDescription,
        landUseCode:      norm.landUseCode,
        zoningCode:       norm.zoningCode,
        assessedValue:    norm.assessedValue,
        landValue:        norm.landValue,
        buildingValue:    norm.buildingValue,
        lotAreaSqft:      norm.lotAreaSqft,
        buildingSqft:     norm.buildingSqft,
        yearBuilt:        norm.yearBuilt,
        ownershipType:    norm.ownershipType,
        rawAttributes:    norm.rawAttributes,
        dataHash:         norm.dataHash,
        lastUpdatedAt:    new Date(),
      })

      if (norm.geometryGeoJson) geomMap.set(norm.pin, norm.geometryGeoJson)
    }

    // Deduplicate by PIN — Postgres rejects ON CONFLICT DO UPDATE
    // if the same constrained value appears twice in one INSERT statement.
    const deduped: any[] = Array.from(
      rows.reduce((map: Map<string, any>, row: any) => map.set(row.pin, row), new Map<string, any>()).values()
    )

    // Batch upsert non-geometry columns
    for (let i = 0; i < deduped.length; i += INSERT_BATCH) {
      const slice = deduped.slice(i, i + INSERT_BATCH)
      try {
        await db.insert(table).values(slice).onConflictDoUpdate({
          target: table.pin,
          set: {
            address:          sql`excluded.address`,
            ownerName:        sql`excluded.owner_name`,
            ownerAddress:     sql`excluded.owner_address`,
            legalDescription: sql`excluded.legal_description`,
            landUseCode:      sql`excluded.land_use_code`,
            zoningCode:       sql`excluded.zoning_code`,
            assessedValue:    sql`excluded.assessed_value`,
            landValue:        sql`excluded.land_value`,
            buildingValue:    sql`excluded.building_value`,
            lotAreaSqft:      sql`excluded.lot_area_sqft`,
            buildingSqft:     sql`excluded.building_sqft`,
            yearBuilt:        sql`excluded.year_built`,
            ownershipType:    sql`excluded.ownership_type`,
            rawAttributes:    sql`excluded.raw_attributes`,
            dataHash:         sql`excluded.data_hash`,
            lastUpdatedAt:    sql`excluded.last_updated_at`,
          },
        })
        processed += slice.length
      } catch (err) {
        console.error(`[ingest:${countyId}] batch failed:`, err)
        failed += slice.length
      }
    }

    // Geometry second pass
    await updateGeometriesForBatch(countyId, geomMap)

    await completeJob(job.id, processed, failed)
    console.log(`[ingest:${countyId}] Done. processed=${processed} failed=${failed}`)
  } catch (err) {
    await failJob(job.id, err)
    throw err
  }
}

// ── Step 3.5: Repair invalid geometries in spatial_features ──────────────────
// Runs once after overlay ingestion. Fixes self-intersections etc. in-place so
// that subsequent ST_Intersects calls don't need per-row ST_MakeValid wrappers
// (which are too slow for Neon serverless timeouts).

async function repairSpatialGeometries(countyId: string) {
  console.log(`[pipeline] Repairing geometries in spatial_features for ${countyId}`)
  // ST_Buffer(ST_MakeValid(geom), 0) forces a full topology rebuild — stronger than
  // ST_MakeValid alone, which can leave topology conflicts that only surface at ST_Intersects time.
  await db.execute(sql`
    UPDATE spatial_features
    SET geometry = ST_Buffer(ST_MakeValid(geometry), 0)
    WHERE county_id = ${countyId}
      AND geometry IS NOT NULL
  `)
  console.log(`[pipeline] Geometry repair complete for ${countyId}`)
}

// ── Step 4: Spatial join — set municipality_id on parcels ─────────────────────
// Joins parcels against the municipality boundaries in spatial_features.
// Name match is case-insensitive to handle 'WHEATON' vs 'Wheaton'.

async function runMunicipalityJoin(countyId: string) {
  console.log(`[pipeline] Running municipality spatial join for ${countyId}`)
  const tableName = countyId === 'dupage' ? 'parcels_dupage' : 'parcels_cook'

  const needsUpdate = await db.execute(sql`
    SELECT id FROM ${sql.raw(tableName)}
    WHERE municipality_id IS NULL AND geometry IS NOT NULL
  `)
  const ids: string[] = (needsUpdate as any).rows.map((r: any) => r.id)
  console.log(`[pipeline] Municipality join: ${ids.length} parcels to process`)

  const BATCH = 300
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const idValues = batch.map(id => sql`(${id}::uuid)`)
    try {
      await db.execute(sql`
        UPDATE ${sql.raw(tableName)} p
        SET municipality_id = m.id
        FROM municipalities m, spatial_features sf
        WHERE sf.layer_type = 'municipality'
          AND sf.county_id = ${countyId}
          AND ST_Intersects(sf.geometry, p.geometry)
          AND LOWER(COALESCE(sf.attributes->>'NAME', sf.attributes->>'CITY', sf.attributes->>'MunName', sf.attributes->>'MUNICIPALITY')) = LOWER(m.name)
          AND m.county_id = ${countyId}
          AND p.id IN (SELECT id FROM (VALUES ${sql.join(idValues, sql`,`)}) AS v(id))
      `)
    } catch (err) {
      console.warn(`[pipeline] Municipality batch ${i}–${i + BATCH} failed:`, err)
    }
  }
  console.log(`[pipeline] Municipality join complete for ${countyId}`)
}

// ── Step 5: Overlay layer ingestion (flood zones, municipality boundaries) ────

async function ingestOverlayLayer(
  countyId: string,
  layer: { id: string; serviceUrl: string },
  layerType: string,
) {
  console.log(`[pipeline] Ingesting overlay ${layerType} for ${countyId}`)
  const job = await createJob(countyId, `${layerType}:${layer.serviceUrl}`, 'full')

  try {
    // Collect all features first
    type OverlayRow = { featureId: string | null; geojson: string; attrs: string }
    const rows: OverlayRow[] = []

    for await (const batch of paginateLayer(layer.serviceUrl)) {
      for (const feature of batch) {
        const geojson = feature.geometry
          ? JSON.stringify(
              feature.geometry.rings
                ? { type: 'Polygon', coordinates: feature.geometry.rings }
                : feature.geometry.x !== undefined
                ? { type: 'Point', coordinates: [feature.geometry.x, feature.geometry.y] }
                : null,
            )
          : null
        if (!geojson || geojson === 'null') continue

        const featureId = String(feature.attributes['OBJECTID'] ?? feature.attributes['FID'] ?? '') || null
        rows.push({ featureId, geojson, attrs: JSON.stringify(feature.attributes) })
      }
    }

    // Delete stale features for this layer, then batch insert fresh ones
    await db.execute(sql`DELETE FROM spatial_features WHERE layer_id = ${layer.id}`)

    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const slice = rows.slice(i, i + INSERT_BATCH)
      const valueParts = slice.map(r =>
        sql`(gen_random_uuid(), ${countyId}, ${layer.id}, ${layerType}, ${r.featureId}, ST_GeomFromGeoJSON(${r.geojson}), ${r.attrs}::jsonb, NOW())`
      )
      try {
        await db.execute(sql`
          INSERT INTO spatial_features (id, county_id, layer_id, layer_type, feature_id, geometry, attributes, ingested_at)
          VALUES ${sql.join(valueParts, sql`, `)}
        `)
      } catch (err) {
        console.warn(`[overlay:${layerType}] batch insert failed (${slice.length} rows):`, err)
      }
    }

    await completeJob(job.id, rows.length, 0)
    console.log(`[overlay:${layerType}] Done. processed=${rows.length}`)
  } catch (err) {
    await failJob(job.id, err)
    throw err
  }
}

// ── Step 7: Zoning code derived update ───────────────────────────────────────
// After zoning polygons are in spatial_features, stamp zoning_code on parcels.
// DuPage zoning layer uses the ZONING field (e.g. "R-1", "B-2", "I-1").

async function runZoningCodeUpdate(countyId: string) {
  console.log(`[pipeline] Running zoning code update for ${countyId}`)
  const tableName = countyId === 'dupage' ? 'parcels_dupage' : 'parcels_cook'

  const needsUpdate = await db.execute(sql`
    SELECT id FROM ${sql.raw(tableName)}
    WHERE zoning_code IS NULL AND geometry IS NOT NULL
  `)
  const ids: string[] = (needsUpdate as any).rows.map((r: any) => r.id)
  console.log(`[pipeline] Zoning code update: ${ids.length} parcels to process`)

  const BATCH = 300
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const idValues = batch.map(id => sql`(${id}::uuid)`)
    try {
      await db.execute(sql`
        UPDATE ${sql.raw(tableName)} p
        SET zoning_code = COALESCE(
          sf.attributes->>'ZONING',
          sf.attributes->>'ZONE_CODE',
          sf.attributes->>'ZONING_CLASS'
        )
        FROM spatial_features sf
        WHERE sf.layer_type = 'zoning'
          AND sf.county_id = ${countyId}
          AND ST_Intersects(p.geometry, sf.geometry)
          AND p.id IN (SELECT id FROM (VALUES ${sql.join(idValues, sql`,`)}) AS v(id))
      `)
    } catch (err) {
      console.warn(`[pipeline] Zoning batch ${i}–${i + BATCH} failed:`, err)
    }
  }
  console.log(`[pipeline] Zoning code update complete for ${countyId}`)
}

// ── Step 6: Flood zone derived update ────────────────────────────────────────
// After flood zone boundaries are in spatial_features, stamp flood_zone on parcels.

async function runFloodZoneUpdate(countyId: string) {
  console.log(`[pipeline] Running flood zone update for ${countyId}`)
  const tableName = countyId === 'dupage' ? 'parcels_dupage' : 'parcels_cook'

  // Fetch IDs of parcels that still need a flood zone assigned
  const needsUpdate = await db.execute(sql`
    SELECT id FROM ${sql.raw(tableName)}
    WHERE flood_zone IS NULL AND geometry IS NOT NULL
  `)
  const ids: string[] = (needsUpdate as any).rows.map((r: any) => r.id)
  console.log(`[pipeline] Flood zone update: ${ids.length} parcels to process`)

  // Process in batches of 300 — keeps each ST_Intersects well within Neon's timeout
  const FLOOD_BATCH = 300
  for (let i = 0; i < ids.length; i += FLOOD_BATCH) {
    const batch = ids.slice(i, i + FLOOD_BATCH)
    const idValues = batch.map(id => sql`(${id}::uuid)`)
    try {
      await db.execute(sql`
        UPDATE ${sql.raw(tableName)} p
        SET flood_zone = COALESCE(
          sf.attributes->>'ZONE_CODE',
          sf.attributes->>'FLD_ZONE',
          sf.attributes->>'ZONE_',
          sf.attributes->>'FLOOD_ZONE',
          'X'
        )
        FROM spatial_features sf
        WHERE sf.layer_type = 'flood'
          AND sf.county_id = ${countyId}
          AND ST_Intersects(p.geometry, sf.geometry)
          AND p.id IN (SELECT id FROM (VALUES ${sql.join(idValues, sql`,`)}) AS v(id))
      `)
    } catch (err) {
      console.warn(`[pipeline] Flood zone batch ${i}–${i + FLOOD_BATCH} failed:`, err)
    }
  }
  console.log(`[pipeline] Flood zone update complete for ${countyId}`)
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runIngestion(opts: RunIngestionOptions): Promise<{ jobIds: string[] }> {
  const targets: Array<'dupage' | 'cook'> = opts.countyId === 'all'
    ? ['dupage', 'cook']
    : [opts.countyId]

  const allJobIds: string[] = []

  for (const countyId of targets) {
    console.log(`\n═══ Starting ingestion for ${countyId} (${opts.jobType}) ═══`)

    // ── Step 2: Discover layers ──────────────────────────────────────────────
    await runDiscovery(countyId)

    // ── Step 3: Ingest parcel layers ─────────────────────────────────────────
    // Pick only the primary parcel layer — the one with the highest record count.
    // Multiple parcel layers exist (viewer, report, search) with different schemas;
    // the highest-count one is the authoritative full dataset.
    const allParcelLayers = await db.select().from(dataLayers).where(
      and(
        eq(dataLayers.countyId, countyId),
        eq(dataLayers.layerType, 'parcel'),
      ),
    )

    const parcelLayers = allParcelLayers
      .filter(l => l.recordCount !== null)
      .sort((a, b) => (b.recordCount ?? 0) - (a.recordCount ?? 0))
      .slice(0, 1)

    if (parcelLayers.length === 0 && allParcelLayers.length > 0) {
      // No record count available — fall back to first discovered
      parcelLayers.push(allParcelLayers[0])
    }

    console.log(`[pipeline] Using parcel layer: ${parcelLayers[0]?.serviceUrl} (${parcelLayers[0]?.recordCount ?? '?'} records)`)

    for (const layer of parcelLayers) {
      try {
        await ingestParcelLayerWithGeometry(
          countyId,
          { id: layer.id, serviceUrl: layer.serviceUrl, fieldMapping: layer.fieldMapping, recordCount: layer.recordCount },
          opts.jobType,
        )
      } catch (err) {
        console.error(`[pipeline] Parcel layer failed (${layer.serviceUrl}):`, err)
      }
    }

    // ── Step 5a: Ingest municipality boundary overlay ────────────────────────
    const muniLayers = await db.select().from(dataLayers).where(
      and(
        eq(dataLayers.countyId, countyId),
        eq(dataLayers.layerType, 'municipality'),
      ),
    )

    await Promise.allSettled(
      muniLayers.map(layer =>
        ingestOverlayLayer(countyId, layer, 'municipality').catch(err =>
          console.error(`[pipeline] Municipality layer failed (${layer.serviceUrl}):`, err)
        )
      )
    )

    // ── Step 4: Spatial join after municipality boundaries are loaded ─────────
    await runMunicipalityJoin(countyId)

    // ── Steps 5b–7b: Ingest flood and zoning overlays in parallel ────────────
    const [floodLayers, zoningLayers] = await Promise.all([
      db.select().from(dataLayers).where(and(eq(dataLayers.countyId, countyId), eq(dataLayers.layerType, 'flood'))),
      db.select().from(dataLayers).where(and(eq(dataLayers.countyId, countyId), eq(dataLayers.layerType, 'zoning'))),
    ])

    await Promise.all([
      Promise.allSettled(
        floodLayers.map(layer =>
          ingestOverlayLayer(countyId, layer, 'flood').catch(err =>
            console.error(`[pipeline] Flood layer failed (${layer.serviceUrl}):`, err)
          )
        )
      ),
      Promise.allSettled(
        zoningLayers.map(layer =>
          ingestOverlayLayer(countyId, layer, 'zoning').catch(err =>
            console.error(`[pipeline] Zoning layer failed (${layer.serviceUrl}):`, err)
          )
        )
      ),
    ])

    // ── Step 3.5: Repair all spatial geometries once, after all overlays are loaded ──
    await repairSpatialGeometries(countyId)

    // ── Spatial joins: stamp flood_zone and zoning_code in parallel ───────────
    await Promise.all([
      floodLayers.length > 0 ? runFloodZoneUpdate(countyId) : Promise.resolve(),
      zoningLayers.length > 0 ? runZoningCodeUpdate(countyId) : Promise.resolve(),
    ])

    console.log(`═══ Ingestion complete for ${countyId} ═══\n`)
  }

  return { jobIds: allJobIds }
}
