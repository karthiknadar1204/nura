// LLM agent loop — multi-turn tool calling with OpenAI.

import OpenAI from 'openai'
import { toolDefinitions } from './tools'
import { executeTool } from './executor'
import { buildSystemPrompt } from './prompt'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: any[]
}

export async function runAgent(userMessage: string, history: Message[] = []): Promise<string> {
  const systemPrompt = await buildSystemPrompt()

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ]

  // Agent loop — keep calling until no more tool calls
  for (let i = 0; i < 5; i++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
    })

    const choice = response.choices[0]
    const msg = choice.message
    messages.push(msg)

    // No tool calls — we have the final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content ?? ''
    }

    // Execute all tool calls in parallel
    const toolResults = await Promise.all(
      msg.tool_calls.map(async (tc: any) => {
        const args = JSON.parse(tc.function.arguments)
        console.log(`\n[tool:call] ${tc.function.name}`, JSON.stringify(args, null, 2))
        const result = await executeTool(tc.function.name, args)
        console.log(`[tool:result] ${tc.function.name} →`, JSON.stringify(result, null, 2))
        return {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        }
      }),
    )

    messages.push(...toolResults)
  }

  return 'I was unable to complete the request after multiple attempts.'
}
