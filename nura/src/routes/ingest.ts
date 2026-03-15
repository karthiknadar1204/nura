import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/client'
import { ingestionJobs, dataLayers } from '../db/schema'
import { runIngestion } from '../ingestion/pipeline'

const ingest = new Hono()

// POST /ingest/trigger
// Body: { county: 'cook' | 'dupage' | 'all', type: 'full' | 'delta' }
// Kicks off the full ingestion pipeline for the given county.
// Runs async — returns immediately with a 202 and the job tracking info.
ingest.post('/trigger', async (c) => {
  const body = await c.req.json().catch(() => null)

  const county = body?.county
  const type   = body?.type ?? 'full'

  if (!county || !['cook', 'dupage', 'all'].includes(county)) {
    return c.json({ error: 'county must be "cook", "dupage", or "all"' }, 400)
  }
  if (!['full', 'delta'].includes(type)) {
    return c.json({ error: 'type must be "full" or "delta"' }, 400)
  }

  // Fire and forget — client polls /ingest/status for progress
  runIngestion({ countyId: county, jobType: type }).catch(err => {
    console.error('[ingest/trigger] pipeline error:', err)
  })

  return c.json({ message: 'Ingestion started', county, type }, 202)
})

// GET /ingest/status
// ?job_id=uuid  — single job details
// ?county=cook|dupage  — all jobs for county
// no params — last 20 jobs
ingest.get('/status', async (c) => {
  const jobId  = c.req.query('job_id')
  const county = c.req.query('county')

  if (jobId) {
    const [job] = await db.select().from(ingestionJobs)
      .where(eq(ingestionJobs.id, jobId))
    if (!job) return c.json({ error: 'job not found' }, 404)
    return c.json(job)
  }

  const query = db.select().from(ingestionJobs)
  const jobs = county
    ? await query.where(eq(ingestionJobs.countyId, county)).limit(50)
    : await query.limit(20)

  return c.json(jobs)
})

// GET /ingest/layers
// ?county=cook|dupage  — filter by county
// ?type=parcel|flood|municipality|...  — filter by layer type
ingest.get('/layers', async (c) => {
  const county    = c.req.query('county')
  const layerType = c.req.query('type')

  const layers = await db.select().from(dataLayers)
    .where(
      county && layerType
        ? and(eq(dataLayers.countyId, county), eq(dataLayers.layerType, layerType))
        : county
        ? eq(dataLayers.countyId, county)
        : layerType
        ? eq(dataLayers.layerType, layerType)
        : undefined,
    )
    .limit(200)
  return c.json(layers)
})

export default ingest
