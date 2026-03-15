import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'

import chat from './routes/chat'
import ingest from './routes/ingest'
import layers from './routes/layers'

const app = new Hono()

app.use('*', logger())
app.use('*', cors())

app.get('/', (c) => c.json({ status: 'ok', service: 'nura-api' }))

app.route('/chat', chat)
app.route('/ingest', ingest)
app.route('/layers', layers)

export default app
