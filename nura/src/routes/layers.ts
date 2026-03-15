import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/client'
import { counties, municipalities, dataLayers } from '../db/schema'

const layers = new Hono()

// GET /layers
// ?county=cook|dupage  ?type=parcel|flood|...
layers.get('/', async (c) => {
  const county    = c.req.query('county')
  const layerType = c.req.query('type')

  const rows = await db.select().from(dataLayers)
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

  return c.json(rows)
})

// GET /layers/counties
layers.get('/counties', async (c) => {
  const rows = await db.select().from(counties)
  return c.json(rows)
})

// GET /layers/municipalities
// ?county=cook|dupage
layers.get('/municipalities', async (c) => {
  const county = c.req.query('county')
  const rows = await db.select().from(municipalities)
    .where(county ? eq(municipalities.countyId, county) : undefined)
  return c.json(rows)
})

// GET /layers/:layerId
// Returns layer metadata + count of spatial features ingested for it
layers.get('/:layerId', async (c) => {
  const layerId = c.req.param('layerId')

  const [layer] = await db.select().from(dataLayers).where(eq(dataLayers.id, layerId))
  if (!layer) return c.json({ error: 'layer not found' }, 404)

  return c.json(layer)
})

export default layers
