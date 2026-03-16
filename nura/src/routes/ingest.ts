import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/client'
import { ingestionJobs, dataLayers, municipalities } from '../db/schema'
import { pipelineQueue, municipalQueue } from '../queue/queues'

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

  const job = await pipelineQueue.add('run-pipeline', { countyId: county, jobType: type })

  return c.json({ message: 'Ingestion queued', county, type, jobId: job.id, status: 'queued' }, 202)
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

// POST /ingest/municipal
// Body: { municipality: 'wheaton' | 'naperville' | 'chicago' | 'evanston' | 'all' }
// Triggers zoning ordinance scraping and structured data extraction for the municipality.
ingest.post('/municipal', async (c) => {
  const body = await c.req.json().catch(() => null)
  const municipalityParam: string | undefined = body?.municipality

  if (!municipalityParam) {
    return c.json({ error: 'municipality is required' }, 400)
  }

  // Resolve which municipalities to run
  let targets: string[]
  if (municipalityParam === 'all') {
    const all = await db.select({ id: municipalities.id, zoningSource: municipalities.zoningSource })
      .from(municipalities)
    targets = all.filter(m => m.zoningSource).map(m => m.id)
  } else {
    targets = [municipalityParam]
  }

  const jobs = await Promise.all(
    targets.map(municipalityId =>
      municipalQueue.add('run-municipal', { municipalityId })
    )
  )

  return c.json({
    message: 'Municipal ingestion queued',
    municipalities: targets,
    jobIds: jobs.map(j => j.id),
    status: 'queued',
  }, 202)
})

// GET /ingest/jobs/:jobId
// Check BullMQ job state: waiting | active | completed | failed | delayed
ingest.get('/jobs/:jobId', async (c) => {
  const jobId = c.req.param('jobId')

  // Check both queues
  let job = await pipelineQueue.getJob(jobId)
  if (!job) job = await municipalQueue.getJob(jobId)
  if (!job) return c.json({ error: 'job not found' }, 404)

  const state  = await job.getState()
  const result = job.returnvalue ?? null
  const error  = job.failedReason ?? null

  return c.json({ jobId: job.id, state, result, error, data: job.data })
})

export default ingest
