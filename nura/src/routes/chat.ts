import { Hono } from 'hono'
import { runAgent, type Message } from '../chat/agent'

const chat = new Hono()

// POST /chat
// Body: { message: string, history?: Message[] }
chat.post('/', async (c) => {
  const body = await c.req.json()
  const { message, history = [] } = body

  if (!message?.trim()) {
    return c.json({ error: 'message is required' }, 400)
  }

  const reply = await runAgent(message, history)
  return c.json({ reply })
})

export default chat
