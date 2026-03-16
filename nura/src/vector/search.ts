// Semantic search over Pinecone for ordinance text chunks.
// Embeds the query with text-embedding-3-small and queries the nura index.

import { Pinecone } from '@pinecone-database/pinecone'
import OpenAI from 'openai'

const EMBED_MODEL = 'text-embedding-3-small'

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY ?? '' })

export interface SemanticChunk {
  id:           string
  score:        number
  municipality: string
  section_id:   string
  source_url:   string
  source_type:  string
  chunk_text:   string
}

export async function semanticSearch(args: {
  query:         string
  municipality?: string   // naperville | evanston — omit to search both
  topK?:         number
}): Promise<SemanticChunk[]> {
  const { query, municipality, topK = 5 } = args
  const indexName = process.env.PINECONE_INDEX_NAME ?? 'nura'

  // Embed the query
  const embResp = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: query,
  })
  const vector = embResp.data[0].embedding

  // Build metadata filter
  const filter: Record<string, any> = {}
  if (municipality) filter['municipality'] = { $eq: municipality }

  const namespaces = municipality
    ? [municipality]
    : ['naperville', 'evanston']

  const allResults: SemanticChunk[] = []

  for (const ns of namespaces) {
    const index = pinecone.index(indexName).namespace(ns)
    const queryResp = await index.query({
      vector,
      topK: topK,
      includeMetadata: true,
    })

    for (const match of queryResp.matches ?? []) {
      const m = match.metadata as any
      allResults.push({
        id:           match.id,
        score:        match.score ?? 0,
        municipality: m?.municipality ?? ns,
        section_id:   m?.section_id  ?? '',
        source_url:   m?.source_url  ?? '',
        source_type:  m?.source_type ?? '',
        chunk_text:   m?.chunk_text  ?? '',
      })
    }
  }

  // Sort by score descending and return top K
  allResults.sort((a, b) => b.score - a.score)
  return allResults.slice(0, topK)
}
