'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('http://localhost:3004/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? data.error ?? 'No response' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: could not reach backend.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold mb-4">Nura — Zoning & Parcel Assistant</h1>

      <ScrollArea className="flex-1 border rounded-lg p-4 mb-4 bg-zinc-50 dark:bg-zinc-900">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-400 text-center mt-8">
            Ask anything about DuPage County parcels, zoning, or flood zones.
          </p>
        )}
        <div className="flex flex-col gap-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black'
                    : 'bg-white border text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border rounded-lg px-4 py-2 text-sm text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
                Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="flex gap-2">
        <Textarea
          className="resize-none"
          rows={2}
          placeholder="Ask about parcels, zoning districts, flood zones… (Enter to send)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <Button onClick={send} disabled={loading || !input.trim()} className="self-end">
          Send
        </Button>
      </div>
    </div>
  )
}
