import { Hono } from 'hono'
import { db } from '../db/client'
import { sql } from 'drizzle-orm'

const search = new Hono()

// GET /search/parcels?q=123+main+st&county=dupage&limit=10
// Fuzzy address/owner/PIN search using pg_trgm similarity
search.get('/parcels', async (c) => {
  const q       = c.req.query('q')?.trim()
  const county  = c.req.query('county') ?? 'dupage'
  const limit   = Math.min(parseInt(c.req.query('limit') ?? '10'), 50)

  if (!q || q.length < 3) {
    return c.json({ error: 'Query must be at least 3 characters' }, 400)
  }

  const table = county === 'cook' ? 'parcels_cook' : 'parcels_dupage'

  const rows = await db.execute(sql`
    SELECT
      pin,
      address,
      owner_name,
      assessed_value,
      land_value,
      building_value,
      lot_area_sqft,
      building_sqft,
      year_built,
      zoning_code,
      land_use_code,
      municipality_id,
      flood_zone,
      GREATEST(
        similarity(LOWER(address),    LOWER(${q})),
        similarity(LOWER(owner_name), LOWER(${q})),
        similarity(LOWER(pin),        LOWER(${q}))
      ) AS score
    FROM ${sql.raw(table)}
    WHERE
      LOWER(address)    % LOWER(${q})
      OR LOWER(owner_name) % LOWER(${q})
      OR LOWER(pin)        % LOWER(${q})
    ORDER BY score DESC
    LIMIT ${limit}
  `)

  return c.json({ results: rows.rows, count: rows.rows.length })
})

export default search
