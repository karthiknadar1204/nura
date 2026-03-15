import { Hono } from 'hono'

const layers = new Hono()

// GET /layers
// Returns all ingested data layers across both counties.
// Query: ?county=cook|dupage&type=parcel|flood|zoning|... (optional filters)
layers.get('/', async (c) => {
  // TODO: query data_layers table with optional county + type filters
  return c.json({ message: 'layers — not yet implemented' }, 501)
})

// GET /layers/counties
// Returns the list of all counties with their metadata.
layers.get('/counties', async (c) => {
  // TODO: query counties table
  return c.json({ message: 'counties — not yet implemented' }, 501)
})

// GET /layers/municipalities
// Returns municipalities, optionally filtered by county.
// Query: ?county=cook|dupage
layers.get('/municipalities', async (c) => {
  // TODO: query municipalities table
  return c.json({ message: 'municipalities — not yet implemented' }, 501)
})

// GET /layers/:layerId
// Returns metadata + sample records for a specific layer.
layers.get('/:layerId', async (c) => {
  // TODO: query data_layers + spatial_features for this layer
  return c.json({ message: 'layer detail — not yet implemented' }, 501)
})

export default layers
