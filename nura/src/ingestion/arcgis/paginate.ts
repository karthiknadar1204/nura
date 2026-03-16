export interface ArcGISFeature {
  attributes: Record<string, unknown>
  geometry?: {
    rings?: number[][][]   // polygon
    paths?: number[][][]   // polyline
    x?: number             // point
    y?: number
  }
}

export interface PaginateOptions {
  pageSize?: number
  outFields?: string
  where?: string
  outSR?: number
  retryLimit?: number
  maxRecords?: number   // stop after this many total features (for testing)
  onProgress?: (totalFetched: number) => void
}

/**
 * Async generator that pages through an ArcGIS FeatureServer/MapServer layer.
 * Yields one batch (array of features) per page.
 * Handles exceededTransferLimit, retries with exponential backoff.
 */
export async function* paginateLayer(
  serviceUrl: string,
  options: PaginateOptions = {},
): AsyncGenerator<ArcGISFeature[]> {
  const {
    pageSize    = 1000,
    outFields   = '*',
    where       = '1=1',
    outSR       = 4326,
    retryLimit  = 3,
    maxRecords  = Infinity,
    onProgress,
  } = options

  let offset       = 0
  let totalFetched = 0

  while (true) {
    const url = new URL(`${serviceUrl}/query`)
    url.searchParams.set('f',                  'json')
    url.searchParams.set('where',              where)
    url.searchParams.set('outFields',          outFields)
    url.searchParams.set('outSR',              String(outSR))
    url.searchParams.set('returnGeometry',     'true')
    url.searchParams.set('resultOffset',       String(offset))
    url.searchParams.set('resultRecordCount',  String(pageSize))

    // Fetch with retry + exponential backoff
    let response: any
    for (let attempt = 1; attempt <= retryLimit; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          signal: AbortSignal.timeout(30_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${serviceUrl}`)
        const text = await res.text()
        try {
          response = JSON.parse(text)
        } catch {
          throw new Error(`Non-JSON response from ${serviceUrl}: ${text.slice(0, 200)}`)
        }
        break
      } catch (err) {
        if (attempt === retryLimit) throw err
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }

    if (response.error) {
      throw new Error(`ArcGIS ${response.error.code}: ${response.error.message}`)
    }

    const features: ArcGISFeature[] = response.features ?? []
    if (features.length === 0) break

    totalFetched += features.length
    onProgress?.(totalFetched)
    yield features

    if (totalFetched >= maxRecords) break

    // ArcGIS signals more pages via exceededTransferLimit
    if (!response.exceededTransferLimit) break
    offset += features.length
  }
}

/**
 * Fetches all features from a layer in parallel pages.
 * Gets total count first, then fans out (concurrency) pages at once.
 * Falls back to sequential paginateLayer if count is unavailable.
 */
export async function fetchAllFeaturesParallel(
  serviceUrl: string,
  options: PaginateOptions & { knownCount?: number } = {},
  concurrency = 5,
): Promise<ArcGISFeature[]> {
  const {
    pageSize   = 1000,
    outFields  = '*',
    where      = '1=1',
    outSR      = 4326,
    retryLimit = 3,
    maxRecords = Infinity,
    onProgress,
    knownCount,
  } = options

  const total = Math.min(knownCount ?? (await getLayerCount(serviceUrl)) ?? 0, maxRecords)
  if (total === 0) {
    // count endpoint unsupported — fall back to sequential
    const all: ArcGISFeature[] = []
    for await (const batch of paginateLayer(serviceUrl, options)) all.push(...batch)
    return all
  }

  const offsets: number[] = []
  for (let o = 0; o < total; o += pageSize) offsets.push(o)

  async function fetchPage(offset: number): Promise<ArcGISFeature[]> {
    const url = new URL(`${serviceUrl}/query`)
    url.searchParams.set('f',                 'json')
    url.searchParams.set('where',             where)
    url.searchParams.set('outFields',         outFields)
    url.searchParams.set('outSR',             String(outSR))
    url.searchParams.set('returnGeometry',    'true')
    url.searchParams.set('resultOffset',      String(offset))
    url.searchParams.set('resultRecordCount', String(Math.min(pageSize, total - offset)))

    for (let attempt = 1; attempt <= retryLimit; attempt++) {
      try {
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${serviceUrl}`)
        const data = await res.json()
        if (data.error) throw new Error(`ArcGIS ${data.error.code}: ${data.error.message}`)
        return data.features ?? []
      } catch (err) {
        if (attempt === retryLimit) throw err
        await new Promise(r => setTimeout(r, 1000 * attempt))
      }
    }
    return []
  }

  const all: ArcGISFeature[] = []
  let fetched = 0

  for (let i = 0; i < offsets.length; i += concurrency) {
    const chunk = offsets.slice(i, i + concurrency)
    const pages = await Promise.all(chunk.map(o => fetchPage(o)))
    for (const page of pages) {
      all.push(...page)
      fetched += page.length
      onProgress?.(fetched)
    }
  }

  return all
}

/**
 * Fetches the total record count for a layer without downloading features.
 * Returns null on failure (count not supported by this service).
 */
export async function getLayerCount(serviceUrl: string): Promise<number | null> {
  try {
    const url = `${serviceUrl}/query?where=1%3D1&returnCountOnly=true&f=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.count === 'number' ? data.count : null
  } catch {
    return null
  }
}
