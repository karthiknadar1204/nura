import { Hono } from 'hono'

const ingest = new Hono()

// POST /ingest/trigger
// Kicks off a full or delta ingestion run for a given county + layer.
// Body: { county: 'cook' | 'dupage', layer?: string, type: 'full' | 'delta' }
ingest.post('/trigger', async (c) => {
  // TODO: implement ingestion pipeline trigger
  return c.json({ message: 'ingest trigger — not yet implemented' }, 501)
})

// GET /ingest/status
// Returns the status of all ingestion jobs (or a specific job by id).
// Query: ?job_id=uuid (optional)
ingest.get('/status', async (c) => {
  // TODO: query ingestion_jobs table and return status
  return c.json({ message: 'ingest status — not yet implemented' }, 501)
})

// GET /ingest/layers
// Lists all discovered data layers from the registry.
// Query: ?county=cook|dupage (optional filter)
ingest.get('/layers', async (c) => {
  // TODO: query data_layers table
  return c.json({ message: 'ingest layers — not yet implemented' }, 501)
})

export default ingest
