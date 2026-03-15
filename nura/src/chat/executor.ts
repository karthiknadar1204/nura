// Tool call dispatcher — executes SQL queries for each tool.

import { db } from '../db/client'
import { sql, SQL } from 'drizzle-orm'

export async function lookup_parcel(args: { query: string; county?: string; limit?: number }) {
  const { query, county = 'dupage', limit = 5 } = args
  const table = county === 'cook' ? 'parcels_cook' : 'parcels_dupage'
  const cap = Math.min(limit, 20)

  const result = await db.execute(sql`
    SELECT
      pin, address, owner_name, ownership_type,
      assessed_value, zoning_code, land_use_code,
      municipality_id, flood_zone, lot_area_sqft, building_sqft, year_built,
      GREATEST(
        similarity(LOWER(address),    LOWER(${query})),
        similarity(LOWER(owner_name), LOWER(${query})),
        similarity(LOWER(pin),        LOWER(${query}))
      ) AS score
    FROM ${sql.raw(table)}
    WHERE
      LOWER(address)    % LOWER(${query})
      OR LOWER(owner_name) % LOWER(${query})
      OR LOWER(pin)        % LOWER(${query})
    ORDER BY score DESC
    LIMIT ${cap}
  `)

  return { results: result.rows, count: result.rows.length }
}

export async function filter_parcels(args: {
  county?: string
  municipality?: string
  flood_zone?: string
  in_flood_zone?: boolean
  owner_type?: string
  zoning_code?: string
  min_value?: number
  max_value?: number
  min_year_built?: number
  max_year_built?: number
  limit?: number
}) {
  const {
    county = 'dupage', municipality, flood_zone, in_flood_zone,
    owner_type, zoning_code, min_value, max_value,
    min_year_built, max_year_built, limit = 10,
  } = args
  const table = county === 'cook' ? 'parcels_cook' : 'parcels_dupage'
  const cap = Math.min(limit, 50)

  const conditions: SQL[] = []

  if (municipality) {
    const munId = municipality.toLowerCase().replace(/\s+/g, '_')
    conditions.push(sql`LOWER(municipality_id) = ${munId}`)
  }
  if (flood_zone) {
    conditions.push(sql`LOWER(flood_zone) = LOWER(${flood_zone})`)
  }
  if (in_flood_zone === true)  conditions.push(sql`flood_zone IS NOT NULL`)
  if (in_flood_zone === false) conditions.push(sql`flood_zone IS NULL`)
  if (owner_type)              conditions.push(sql`ownership_type = ${owner_type}`)
  if (zoning_code)             conditions.push(sql`LOWER(zoning_code) = LOWER(${zoning_code})`)
  if (min_value !== undefined) conditions.push(sql`assessed_value >= ${min_value}`)
  if (max_value !== undefined) conditions.push(sql`assessed_value <= ${max_value}`)
  if (min_year_built !== undefined) conditions.push(sql`year_built >= ${min_year_built}`)
  if (max_year_built !== undefined) conditions.push(sql`year_built <= ${max_year_built}`)

  const whereClause = conditions.length > 0
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``

  const result = await db.execute(sql`
    SELECT pin, address, owner_name, ownership_type, assessed_value,
           zoning_code, land_use_code, municipality_id, flood_zone,
           lot_area_sqft, building_sqft, year_built
    FROM ${sql.raw(table)}
    ${whereClause}
    LIMIT ${cap}
  `)

  return { results: result.rows, count: result.rows.length }
}

export async function get_parcel_detail(args: { pin: string; county?: string }) {
  const { pin, county = 'dupage' } = args
  const table = county === 'cook' ? 'parcels_cook' : 'parcels_dupage'

  const result = await db.execute(sql`
    SELECT * FROM ${sql.raw(table)} WHERE pin = ${pin} LIMIT 1
  `)

  if (result.rows.length === 0) return { error: `No parcel found with PIN ${pin}` }
  return { parcel: result.rows[0] }
}

export async function get_county_stats(args: { county?: string; municipality?: string }) {
  const { county = 'dupage', municipality } = args
  const table = county === 'cook' ? 'parcels_cook' : 'parcels_dupage'
  const munId = municipality?.toLowerCase().replace(/\s+/g, '_')
  const whereClause = munId ? sql`WHERE LOWER(municipality_id) = ${munId}` : sql``

  const result = await db.execute(sql`
    SELECT
      COUNT(*)                                                AS total_parcels,
      COUNT(*) FILTER (WHERE flood_zone IS NOT NULL)          AS in_flood_zone,
      COUNT(*) FILTER (WHERE flood_zone IS NULL)              AS not_in_flood_zone,
      COUNT(*) FILTER (WHERE ownership_type = 'individual')   AS individual_owned,
      COUNT(*) FILTER (WHERE ownership_type = 'corporate')    AS corporate_owned,
      COUNT(*) FILTER (WHERE ownership_type = 'trust')        AS trust_owned,
      COUNT(*) FILTER (WHERE ownership_type = 'government')   AS government_owned,
      ROUND(AVG(assessed_value)::numeric, 2)                  AS avg_assessed_value,
      ROUND(AVG(land_value)::numeric, 2)                      AS avg_land_value,
      ROUND(AVG(building_value)::numeric, 2)                  AS avg_building_value
    FROM ${sql.raw(table)}
    ${whereClause}
  `)

  return { stats: result.rows[0], county, municipality: municipality ?? 'all' }
}

export async function spatial_query(args: {
  lat?: number
  lng?: number
  address_pin?: string
  radius_meters?: number
  county?: string
  flood_zone?: string
  in_flood_zone?: boolean
  owner_type?: string
  limit?: number
}) {
  const {
    lat, lng, address_pin,
    radius_meters = 500,
    county = 'dupage',
    flood_zone, in_flood_zone, owner_type,
    limit = 10,
  } = args
  const table = county === 'cook' ? 'parcels_cook' : 'parcels_dupage'
  const cap = Math.min(limit, 50)

  // Resolve center point — either from explicit lat/lng or by looking up a PIN/address
  let centerLat: number
  let centerLng: number

  if (lat !== undefined && lng !== undefined) {
    centerLat = lat
    centerLng = lng
  } else if (address_pin) {
    // Try PIN first, then fuzzy address
    const ref = await db.execute(sql`
      SELECT ST_Y(ST_Centroid(geometry)) AS lat, ST_X(ST_Centroid(geometry)) AS lng
      FROM ${sql.raw(table)}
      WHERE pin = ${address_pin}
         OR LOWER(address) % LOWER(${address_pin})
      ORDER BY similarity(LOWER(address), LOWER(${address_pin})) DESC
      LIMIT 1
    `)
    if (ref.rows.length === 0) return { error: `Could not locate reference point for: ${address_pin}` }
    const row = ref.rows[0] as any
    centerLat = parseFloat(row.lat)
    centerLng = parseFloat(row.lng)
  } else {
    return { error: 'Provide either lat/lng or address_pin to define the center point' }
  }

  const conditions: SQL[] = []
  if (flood_zone)              conditions.push(sql`LOWER(flood_zone) = LOWER(${flood_zone})`)
  if (in_flood_zone === true)  conditions.push(sql`flood_zone IS NOT NULL`)
  if (in_flood_zone === false) conditions.push(sql`flood_zone IS NULL`)
  if (owner_type)              conditions.push(sql`ownership_type = ${owner_type}`)

  const extraWhere = conditions.length > 0
    ? sql`AND ${sql.join(conditions, sql` AND `)}`
    : sql``

  const result = await db.execute(sql`
    SELECT
      pin, address, owner_name, ownership_type,
      municipality_id, flood_zone, assessed_value,
      ROUND(ST_Distance(
        geometry::geography,
        ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)::geography
      )::numeric, 0) AS distance_meters
    FROM ${sql.raw(table)}
    WHERE ST_DWithin(
      geometry::geography,
      ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)::geography,
      ${radius_meters}
    )
    ${extraWhere}
    ORDER BY distance_meters
    LIMIT ${cap}
  `)

  return {
    center: { lat: centerLat, lng: centerLng },
    radius_meters,
    results: result.rows,
    count: result.rows.length,
  }
}

export async function executeTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'lookup_parcel':     return lookup_parcel(args)
    case 'filter_parcels':    return filter_parcels(args)
    case 'get_parcel_detail': return get_parcel_detail(args)
    case 'get_county_stats':  return get_county_stats(args)
    case 'spatial_query':     return spatial_query(args)
    default: return { error: `Unknown tool: ${name}` }
  }
}
