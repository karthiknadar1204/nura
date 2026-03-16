// Tool handlers — execute the actual DB queries for each tool call.
// All functions return plain JS objects that get serialised as tool results.

import { eq, and, or, ilike, gte, lte, inArray, isNotNull, sql, asc, desc } from 'drizzle-orm'
import { db } from '../db/client'
import {
  parcelsDupage,
  spatialFeatures,
  zoningDistricts,
  permittedUses,
  developmentStandards,
  documentChunks,
  dataLayers,
  municipalities,
} from '../db/schema'

// ── 1. search_parcels ────────────────────────────────────────────────────────
// Look up parcels by address fragment, owner name, municipality, or flood zone.

export async function searchParcels(args: {
  address?:           string
  owner?:             string
  municipality?:      string
  flood_zone?:        string
  ownership_type?:    string
  min_assessed_value?: number
  max_assessed_value?: number
  min_lot_sqft?:       number
  max_lot_sqft?:       number
  min_building_sqft?:  number
  max_building_sqft?:  number
  min_year_built?:     number
  max_year_built?:     number
  sort_by?:           string
  sort_order?:        string
  limit?:             number
}) {
  const {
    address, owner, municipality, flood_zone, ownership_type,
    min_assessed_value, max_assessed_value,
    min_lot_sqft, max_lot_sqft,
    min_building_sqft, max_building_sqft,
    min_year_built, max_year_built,
    sort_by, sort_order = 'desc',
    limit = 20,
  } = args

  const conditions: any[] = []
  if (address)           conditions.push(ilike(parcelsDupage.address,       `%${address}%`))
  if (owner)             conditions.push(ilike(parcelsDupage.ownerName,      `%${owner}%`))
  if (municipality)      conditions.push(eq(parcelsDupage.municipalityId,    municipality))
  if (flood_zone)        conditions.push(eq(parcelsDupage.floodZone,         flood_zone))
  if (ownership_type)    conditions.push(eq(parcelsDupage.ownershipType,     ownership_type))
  if (min_assessed_value != null) conditions.push(gte(parcelsDupage.assessedValue, String(min_assessed_value)))
  if (max_assessed_value != null) conditions.push(lte(parcelsDupage.assessedValue, String(max_assessed_value)))
  if (min_lot_sqft != null)       conditions.push(gte(parcelsDupage.lotAreaSqft,   String(min_lot_sqft)))
  if (max_lot_sqft != null)       conditions.push(lte(parcelsDupage.lotAreaSqft,   String(max_lot_sqft)))
  if (min_building_sqft != null)  conditions.push(gte(parcelsDupage.buildingSqft,  String(min_building_sqft)))
  if (max_building_sqft != null)  conditions.push(lte(parcelsDupage.buildingSqft,  String(max_building_sqft)))
  if (min_year_built != null)     conditions.push(gte(parcelsDupage.yearBuilt,     min_year_built))
  if (max_year_built != null)     conditions.push(lte(parcelsDupage.yearBuilt,     max_year_built))

  const whereClause = conditions.length ? and(...conditions) : undefined

  const [{ total_count }] = await db
    .select({ total_count: sql<number>`COUNT(*)` })
    .from(parcelsDupage)
    .where(whereClause)

  const sortableColumns: Record<string, any> = {
    assessed_value: parcelsDupage.assessedValue,
    lot_area_sqft:  parcelsDupage.lotAreaSqft,
    building_sqft:  parcelsDupage.buildingSqft,
    year_built:     parcelsDupage.yearBuilt,
  }
  const sortCol = sort_by && sortableColumns[sort_by] ? sortableColumns[sort_by] : null
  const orderExpr = sortCol
    ? (sort_order === 'asc'
        ? sql`${sortCol}::numeric ASC NULLS LAST`
        : sql`${sortCol}::numeric DESC NULLS LAST`)
    : undefined

  const rows = await db
    .select({
      pin:            parcelsDupage.pin,
      address:        parcelsDupage.address,
      owner:          parcelsDupage.ownerName,
      municipality:   parcelsDupage.municipalityId,
      flood_zone:     parcelsDupage.floodZone,
      ownership_type: parcelsDupage.ownershipType,
      land_use:       parcelsDupage.landUseCode,
      assessed_value: parcelsDupage.assessedValue,
      lot_area_sqft:  parcelsDupage.lotAreaSqft,
      building_sqft:  parcelsDupage.buildingSqft,
      year_built:     parcelsDupage.yearBuilt,
    })
    .from(parcelsDupage)
    .where(whereClause)
    .orderBy(...(orderExpr ? [orderExpr] : [sql`1`]))
    .limit(limit)

  return {
    total_count:  Number(total_count),
    returned:     rows.length,
    truncated:    Number(total_count) > rows.length,
    parcels:      rows.map(p => ({ ...p, zoning_district: null })),
    data_note:    'zoning_district is null for all parcels — the parcel table has no zoning assignments. Never infer a zoning district from an address.',
  }
}

// ── 2. get_flood_zone_summary ────────────────────────────────────────────────
// Count parcels per flood zone, optionally filtered by municipality.

export async function getFloodZoneSummary(args: { municipality?: string }) {
  const { municipality } = args

  const baseWhere = and(
    isNotNull(parcelsDupage.floodZone),
    municipality ? eq(parcelsDupage.municipalityId, municipality) : undefined,
  )

  // Total per flood_zone (across all municipalities) — answers "how many AE in county?"
  const byZone = await db
    .select({
      flood_zone:  parcelsDupage.floodZone,
      total_count: sql<number>`COUNT(*)`,
    })
    .from(parcelsDupage)
    .where(baseWhere)
    .groupBy(parcelsDupage.floodZone)
    .orderBy(sql`COUNT(*) DESC`)

  // Total per municipality (across all zones) — answers "which municipality has most flood parcels?"
  const byMunicipality = await db
    .select({
      municipality: parcelsDupage.municipalityId,
      total_count:  sql<number>`COUNT(*)`,
    })
    .from(parcelsDupage)
    .where(baseWhere)
    .groupBy(parcelsDupage.municipalityId)
    .orderBy(sql`COUNT(*) DESC`)

  return { by_flood_zone: byZone, by_municipality: byMunicipality }
}

// ── 3. list_zoning_districts ─────────────────────────────────────────────────
// List all zoning districts for a municipality with category info.

export async function listZoningDistricts(args: { municipality: string }) {
  const rows = await db
    .select({
      code:        zoningDistricts.districtCode,
      name:        zoningDistricts.districtName,
      category:    zoningDistricts.category,
      description: zoningDistricts.description,
    })
    .from(zoningDistricts)
    .where(eq(zoningDistricts.municipalityId, args.municipality))
    .orderBy(zoningDistricts.districtCode)

  return { municipality: args.municipality, count: rows.length, districts: rows }
}

// ── 4. get_permitted_uses ────────────────────────────────────────────────────
// Get permitted uses for a specific district in a municipality.

export async function getPermittedUses(args: {
  municipality:  string
  district_code: string
  permit_type?:  'by_right' | 'conditional' | 'prohibited' | 'accessory'
}) {
  const { municipality, district_code, permit_type } = args

  const [district] = await db
    .select({ id: zoningDistricts.id, name: zoningDistricts.districtName })
    .from(zoningDistricts)
    .where(and(
      eq(zoningDistricts.municipalityId, municipality),
      eq(zoningDistricts.districtCode, district_code),
    ))
    .limit(1)

  if (!district) return { error: `District ${district_code} not found in ${municipality}` }

  const conditions: any[] = [eq(permittedUses.districtId, district.id)]
  if (permit_type) conditions.push(eq(permittedUses.permitType, permit_type))

  const uses = await db
    .select({
      use:         permittedUses.useDescription,
      permit_type: permittedUses.permitType,
      category:    permittedUses.useCategory,
      conditions:  permittedUses.conditions,
    })
    .from(permittedUses)
    .where(and(...conditions))
    .orderBy(permittedUses.permitType, permittedUses.useDescription)

  const note = uses.length === 0
    ? 'No structured permitted uses extracted for this district. Use search_ordinance_text to find permitted uses in the ordinance text.'
    : undefined

  return { municipality, district_code, district_name: district.name, count: uses.length, uses, ...(note ? { note } : {}) }
}

// ── 5. get_development_standards ────────────────────────────────────────────
// Get dimensional/development standards for a district.

export async function getDevelopmentStandards(args: {
  municipality:  string
  district_code: string
}) {
  const { municipality, district_code } = args

  const [district] = await db
    .select({ id: zoningDistricts.id, name: zoningDistricts.districtName })
    .from(zoningDistricts)
    .where(and(
      eq(zoningDistricts.municipalityId, municipality),
      eq(zoningDistricts.districtCode, district_code),
    ))
    .limit(1)

  if (!district) return { error: `District ${district_code} not found in ${municipality}` }

  const raw = await db
    .select({
      standard: developmentStandards.standardType,
      value:    developmentStandards.value,
      unit:     developmentStandards.unit,
      notes:    developmentStandards.conditions,
    })
    .from(developmentStandards)
    .where(eq(developmentStandards.districtId, district.id))
    .orderBy(developmentStandards.standardType)

  // Deduplicate rows with identical (standard, value, unit) — caused by re-ingestion runs
  const seen = new Set<string>()
  const standards = raw.filter(r => {
    const key = `${r.standard}|${r.value}|${r.unit}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const COMMON_STANDARDS = [
    'min_lot_sqft', 'min_lot_width_ft', 'front_setback_ft', 'side_setback_ft',
    'rear_setback_ft', 'max_height_ft', 'max_lot_coverage_pct', 'max_density', 'far',
  ]
  const presentTypes = new Set(standards.map(s => s.standard))
  const missingTypes = COMMON_STANDARDS.filter(t => !presentTypes.has(t))

  const note = standards.length === 0
    ? `No structured standards extracted for this district. Use search_ordinance_text with query "${district_code} area requirements" municipality "${municipality}" to find them in the ordinance text.`
    : missingTypes.length > 0
      ? `These standard types are not in structured data and must be looked up via search_ordinance_text: ${missingTypes.join(', ')}.`
      : undefined

  return { municipality, district_code, district_name: district.name, standards, ...(note ? { note } : {}) }
}

// ── 6. compare_districts ─────────────────────────────────────────────────────
// Compare development standards across two districts (same or different municipalities).

export async function compareDistricts(args: {
  municipality_a:  string
  district_code_a: string
  municipality_b:  string
  district_code_b: string
}) {
  const a = await getDevelopmentStandards({ municipality: args.municipality_a, district_code: args.district_code_a })
  const b = await getDevelopmentStandards({ municipality: args.municipality_b, district_code: args.district_code_b })
  return { district_a: a, district_b: b }
}

// ── 7. search_ordinance_text ─────────────────────────────────────────────────
// Semantic vector search over stored ordinance chunks (Pinecone).
// Falls back to keyword (ilike) search if Pinecone is unavailable.

export async function searchOrdinanceText(args: {
  query:         string
  municipality?: string
  limit?:        number
}) {
  const { query, municipality, limit = 5 } = args

  // Try semantic search via Pinecone first
  try {
    const { semanticSearch } = await import('../vector/search')
    const hits = await semanticSearch({ query, municipality, topK: limit })
    if (hits.length > 0) {
      return {
        query,
        search_type: 'semantic',
        count: hits.length,
        results: hits.map(h => ({
          municipality: h.municipality,
          section:      h.section_id,
          source_url:   h.source_url,
          score:        h.score,
          text:         h.chunk_text,
        })),
      }
    }
  } catch (_) {
    // Fall through to keyword search
  }

  // Keyword fallback
  const conditions: any[] = [ilike(documentChunks.chunkText, `%${query}%`)]
  if (municipality) conditions.push(eq(documentChunks.municipalityId, municipality))

  const rows = await db
    .select({
      municipality: documentChunks.municipalityId,
      section:      documentChunks.sectionId,
      source_url:   documentChunks.sourceUrl,
      text:         documentChunks.chunkText,
    })
    .from(documentChunks)
    .where(and(...conditions))
    .limit(limit)

  return { query, search_type: 'keyword', count: rows.length, results: rows }
}

// ── 8. find_parcels_near ─────────────────────────────────────────────────────
// Return parcels within a radius of a lat/lng point using ST_DWithin.

export async function findParcelsNear(args: {
  lat:           number
  lon:           number
  radius_meters: number
  flood_zone?:   string
  ownership_type?: string
  limit?:        number
}) {
  const { lat, lon, radius_meters, flood_zone, ownership_type, limit = 20 } = args

  const extraConditions: string[] = []
  if (flood_zone)     extraConditions.push(`AND flood_zone = '${flood_zone.replace(/'/g, "''")}'`)
  if (ownership_type) extraConditions.push(`AND ownership_type = '${ownership_type.replace(/'/g, "''")}'`)

  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS total_count
    FROM parcels_dupage
    WHERE ST_DWithin(
      geometry::geography,
      ST_SetSRID(ST_Point(${lon}, ${lat}), 4326)::geography,
      ${radius_meters}
    )
    ${sql.raw(extraConditions.join(' '))}
    AND geometry IS NOT NULL
  `)

  const total_count = Number((countResult.rows[0] as any)?.total_count ?? 0)

  const rows = await db.execute(sql`
    SELECT
      pin,
      address,
      owner_name,
      municipality_id,
      flood_zone,
      ownership_type,
      land_use_code,
      ROUND(ST_Distance(
        geometry::geography,
        ST_SetSRID(ST_Point(${lon}, ${lat}), 4326)::geography
      )::numeric, 1) AS distance_meters
    FROM parcels_dupage
    WHERE ST_DWithin(
      geometry::geography,
      ST_SetSRID(ST_Point(${lon}, ${lat}), 4326)::geography,
      ${radius_meters}
    )
    ${sql.raw(extraConditions.join(' '))}
    AND geometry IS NOT NULL
    ORDER BY distance_meters ASC
    LIMIT ${limit}
  `)

  return {
    lat,
    lon,
    radius_meters,
    total_count,
    returned:  rows.rows.length,
    truncated: total_count > rows.rows.length,
    parcels:   rows.rows,
  }
}

// ── 9. get_parcels_in_flood_zone ─────────────────────────────────────────────
// Return parcels in a given flood zone, optionally filtered by municipality.

export async function getParcelsInFloodZone(args: {
  flood_zone:    string
  municipality?: string
  limit?:        number
}) {
  const { flood_zone, municipality, limit = 20 } = args

  // Normalise common dirty-data variants (e.g. "ZONE X" → "X")
  const normalised = flood_zone.replace(/^ZONE\s+/i, '').trim().toUpperCase()

  const conditions: any[] = [
    sql`UPPER(TRIM(${parcelsDupage.floodZone})) = ${normalised}`,
  ]
  if (municipality) conditions.push(eq(parcelsDupage.municipalityId, municipality))

  const whereClause = and(...conditions)

  const [{ total_count }] = await db
    .select({ total_count: sql<number>`COUNT(*)` })
    .from(parcelsDupage)
    .where(whereClause)

  const rows = await db
    .select({
      pin:          parcelsDupage.pin,
      address:      parcelsDupage.address,
      owner:        parcelsDupage.ownerName,
      municipality: parcelsDupage.municipalityId,
      flood_zone:   parcelsDupage.floodZone,
    })
    .from(parcelsDupage)
    .where(whereClause)
    .limit(limit)

  return {
    flood_zone:   normalised,
    total_count:  Number(total_count),
    returned:     rows.length,
    truncated:    Number(total_count) > rows.length,
    parcels:      rows,
  }
}

// ── 10. list_available_layers ────────────────────────────────────────────────
// Show what GIS data layers have been discovered and ingested.

export async function listAvailableLayers(args: {
  county?:     string
  layer_type?: string
}) {
  const { county, layer_type } = args

  const conditions: any[] = []
  if (county)     conditions.push(eq(dataLayers.countyId,   county))
  if (layer_type) conditions.push(eq(dataLayers.layerType,  layer_type))

  const rows = await db
    .select({
      county:       dataLayers.countyId,
      name:         dataLayers.layerName,
      type:         dataLayers.layerType,
      record_count: dataLayers.recordCount,
      last_synced:  dataLayers.lastSyncedAt,
    })
    .from(dataLayers)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(dataLayers.countyId, dataLayers.layerType)
    .limit(50)

  return { count: rows.length, layers: rows }
}

// ── 11. get_municipality_summary ─────────────────────────────────────────────
// High-level overview of what data exists for a municipality.

export async function getMunicipalitySummary(args: { municipality: string }) {
  const { municipality } = args

  const [muniInfo] = await db
    .select()
    .from(municipalities)
    .where(eq(municipalities.id, municipality))
    .limit(1)

  if (!muniInfo) return { error: `Municipality not found: ${municipality}` }

  const [parcelCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(parcelsDupage)
    .where(eq(parcelsDupage.municipalityId, municipality))

  const [districtCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(zoningDistricts)
    .where(eq(zoningDistricts.municipalityId, municipality))

  const [chunkCount] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(documentChunks)
    .where(eq(documentChunks.municipalityId, municipality))

  return {
    municipality:   muniInfo.name,
    county:         muniInfo.countyId,
    zoning_source:  muniInfo.zoningSource,
    last_scraped:   muniInfo.lastScrapedAt,
    parcel_count:   Number(parcelCount?.count ?? 0),
    district_count: Number(districtCount?.count ?? 0),
    chunk_count:    Number(chunkCount?.count ?? 0),
  }
}
