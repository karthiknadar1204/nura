import { Hono } from 'hono'

const chat = new Hono()

// POST /chat
// Accepts a user message, runs the LLM agent loop with tool calling,
// and streams back the response.
// Body: { message: string, thread_id?: string }
chat.post('/', async (c) => {
  // TODO: implement LLM agent loop with tool calling
  return c.json({ message: 'chat route — not yet implemented' }, 501)
})

export default chat
