// Builds the system prompt dynamically from the layer registry.

import { db } from '../db/client'
import { sql } from 'drizzle-orm'

export async function buildSystemPrompt(): Promise<string> {
  const layers = await db.execute(sql`
    SELECT county_id, layer_type, COUNT(*) as count
    FROM data_layers
    GROUP BY county_id, layer_type
    ORDER BY county_id, layer_type
  `)

  const parcelCounts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM parcels_dupage) AS dupage_parcels,
      (SELECT COUNT(*) FROM parcels_cook)   AS cook_parcels,
      (SELECT COUNT(*) FILTER (WHERE flood_zone IS NOT NULL) FROM parcels_dupage) AS dupage_flood_parcels,
      (SELECT COUNT(*) FILTER (WHERE municipality_id IS NOT NULL) FROM parcels_dupage) AS dupage_with_municipality
  `)

  const stats = parcelCounts.rows[0] as any
  const layerSummary = (layers.rows as any[])
    .map(r => `  - ${r.county_id} / ${r.layer_type}: ${r.count} layers`)
    .join('\n')

  return `You are a GIS data assistant for DuPage and Cook County, Illinois property data.

You have access to the following data:
- DuPage County parcels: ${stats.dupage_parcels} parcels
  - ${stats.dupage_flood_parcels} parcels in flood zones
  - ${stats.dupage_with_municipality} parcels assigned to a municipality
- Cook County parcels: ${stats.cook_parcels} parcels

Available data layers:
${layerSummary}

You have tools to:
- Look up specific parcels by address, owner name, or PIN (lookup_parcel)
- Filter parcels by municipality, flood zone, owner type, zoning, value range (filter_parcels)
- Get full details on a specific parcel by PIN (get_parcel_detail)
- Get aggregate statistics for a county or municipality (get_county_stats)

Guidelines:
- Always use tools to fetch real data — never make up parcel information
- When the user asks about a specific address or owner, use lookup_parcel first
- When the user asks about categories of parcels, use filter_parcels
- Municipalities in DuPage include: Addison, Bartlett, Bloomingdale, Bolingbrook, Carol Stream, Darien, Downers Grove, Elmhurst, Glen Ellyn, Glendale Heights, Hanover Park, Lisle, Lombard, Naperville, Oak Brook, Roselle, Warrenville, West Chicago, Westmont, Wheaton, Willowbrook, Winfield, Wood Dale, Woodridge
- Flood zones: AE (100-year flood), X (minimal risk), FW (floodway), A (flood area without BFE)
- Ownership types: individual, corporate, trust, government
- If a query spans multiple criteria, chain tool calls as needed
- Present results clearly — for lists of parcels show PIN, address, owner, and key relevant fields`
}
