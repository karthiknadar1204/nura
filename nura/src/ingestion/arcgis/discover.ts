import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { DUPAGE_FIELD_MAPPING, COOK_FIELD_MAPPING } from './normalize'

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferLayerType(name: string): string {
  const n = name.toLowerCase()
  if (/parcel/.test(n))                        return 'parcel'
  if (/flood/.test(n))                         return 'flood'
  if (/wetland/.test(n))                       return 'wetland'
  if (/school/.test(n))                        return 'school'
  if (/munic|boundary|boundaries|village|city/.test(n)) return 'municipality'
  if (/zoning/.test(n))                        return 'zoning'
  if (/road|street|highway/.test(n))           return 'road'
  return 'misc'
}

async function fetchWithTimeout(url: string, timeoutMs = 15_000): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ── Phase A: DCAT feed ────────────────────────────────────────────────────────

interface DCATDataset {
  title: string
  description?: string
  distribution?: Array<{ title?: string; accessURL?: string; format?: string }>
}

async function discoverFromDCAT(countyId: string, dcatUrl: string): Promise<number> {
  console.log(`[discover] Fetching DCAT feed for ${countyId}: ${dcatUrl}`)
  const feed = await fetchWithTimeout(dcatUrl)
  if (!feed) {
    console.warn(`[discover] DCAT feed unavailable for ${countyId}`)
    return 0
  }

  const datasets: DCATDataset[] = feed.dataset ?? []
  let inserted = 0

  for (const ds of datasets) {
    // Only accept actual ArcGIS REST service URLs — skip web page URLs (/maps/, /datasets/)
    const arcgisDist = ds.distribution?.find(
      d => (d.accessURL?.includes('/FeatureServer') || d.accessURL?.includes('/MapServer')) &&
           !d.accessURL?.includes('/maps/') &&
           !d.accessURL?.includes('/datasets/'),
    )
    if (!arcgisDist?.accessURL) continue

    // Normalise to the layer endpoint (strip /query or trailing params)
    const serviceUrl = arcgisDist.accessURL.replace(/\/query.*$/, '')
    const layerType  = inferLayerType(ds.title)
    const defaultMapping = countyId === 'dupage' ? DUPAGE_FIELD_MAPPING : COOK_FIELD_MAPPING

    await db.execute(sql`
      INSERT INTO data_layers (id, county_id, layer_name, layer_type, service_url, field_mapping, metadata)
      VALUES (
        gen_random_uuid(),
        ${countyId},
        ${ds.title},
        ${layerType},
        ${serviceUrl},
        ${JSON.stringify(defaultMapping)},
        ${JSON.stringify({ source: 'dcat', description: ds.description ?? null })}
      )
      ON CONFLICT (county_id, service_url) DO NOTHING
    `)
    inserted++
  }

  console.log(`[discover] DCAT: ${inserted} layers for ${countyId}`)
  return inserted
}

// ── Phase B: ArcGIS REST walk ─────────────────────────────────────────────────

interface ArcGISServiceEntry { name: string; type: string }

async function walkArcGISServices(baseUrl: string): Promise<string[]> {
  const urls: string[] = []

  const root = await fetchWithTimeout(`${baseUrl}?f=json`)
  if (!root) return urls

  const services: ArcGISServiceEntry[] = root.services ?? []
  for (const svc of services) {
    if (svc.type === 'MapServer' || svc.type === 'FeatureServer') {
      urls.push(`${baseUrl}/${svc.name}/${svc.type}/0`)
    }
  }

  const folders: string[] = root.folders ?? []
  for (const folder of folders) {
    const fdata = await fetchWithTimeout(`${baseUrl}/${folder}?f=json`, 10_000)
    if (!fdata) continue
    for (const svc of (fdata.services ?? []) as ArcGISServiceEntry[]) {
      if (svc.type === 'MapServer' || svc.type === 'FeatureServer') {
        urls.push(`${baseUrl}/${svc.name}/${svc.type}/0`)
      }
    }
  }

  return urls
}

async function discoverFromArcGIS(countyId: string, baseUrl: string): Promise<number> {
  console.log(`[discover] Walking ArcGIS REST for ${countyId}: ${baseUrl}`)
  const serviceUrls = await walkArcGISServices(baseUrl)
  let inserted = 0
  const defaultMapping = countyId === 'dupage' ? DUPAGE_FIELD_MAPPING : COOK_FIELD_MAPPING

  for (const serviceUrl of serviceUrls) {
    // Derive a human name from the full service path (e.g. DuPage_County_IL/Municipality)
    const namePart = serviceUrl.split('/services/')[1]
      ?.replace(/\/(MapServer|FeatureServer)\/\d+$/, '') ?? serviceUrl
    const layerType = inferLayerType(namePart)

    // Get record count without fetching all features
    let recordCount: number | null = null
    const countData = await fetchWithTimeout(
      `${serviceUrl}/query?where=1%3D1&returnCountOnly=true&f=json`,
      10_000,
    )
    if (countData?.count !== undefined) recordCount = countData.count

    await db.execute(sql`
      INSERT INTO data_layers (id, county_id, layer_name, layer_type, service_url, field_mapping, record_count, metadata)
      VALUES (
        gen_random_uuid(),
        ${countyId},
        ${namePart},
        ${layerType},
        ${serviceUrl},
        ${JSON.stringify(defaultMapping)},
        ${recordCount},
        ${JSON.stringify({ source: 'arcgis_walk' })}
      )
      ON CONFLICT (county_id, service_url) DO NOTHING
    `)
    inserted++
  }

  console.log(`[discover] ArcGIS walk: ${inserted} layers for ${countyId}`)
  return inserted
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Runs both DCAT feed discovery and ArcGIS REST walk for a county.
 * Writes results to data_layers table.
 * Existing rows are left untouched (ON CONFLICT DO NOTHING).
 * Returns total number of layers found.
 */
export async function discoverLayers(
  countyId: string,
  arcgisBaseUrl: string,
  dcatUrl?: string,
): Promise<number> {
  let total = 0
  if (dcatUrl) total += await discoverFromDCAT(countyId, dcatUrl)
  total += await discoverFromArcGIS(countyId, arcgisBaseUrl)
  console.log(`[discover] Total for ${countyId}: ${total} layers`)
  return total
}
