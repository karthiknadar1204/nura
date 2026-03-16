// Pinecone client + embedding pipeline.
// Called at the end of runMunicipalIngestion — embeds all unembedded chunks
// for a municipality and upserts them into the Pinecone index.
//
// Index:      nura  (1536-dim, text-embedding-3-small)
// Namespace:  municipality id (naperville | evanston)
// Vector ID:  document_chunks.id  (UUID — same key in both Postgres and Pinecone)

import { Pinecone } from '@pinecone-database/pinecone'
import OpenAI from 'openai'
import { eq, isNull, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { documentChunks, municipalities } from '../db/schema'

const EMBED_MODEL   = 'text-embedding-3-small'
const EMBED_DIM     = 1536
const BATCH_SIZE    = 100   // OpenAI embeddings + Pinecone upsert batch size

const openai   = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY ?? '' })

export async function embedAndUpsertChunks(municipalityId: string): Promise<number> {
  const indexName = process.env.PINECONE_INDEX_NAME ?? 'nura'
  const index     = pinecone.index(indexName).namespace(municipalityId)

  // Resolve county for metadata
  const [muni] = await db
    .select({ countyId: municipalities.countyId })
    .from(municipalities)
    .where(eq(municipalities.id, municipalityId))
    .limit(1)
  const countyId = muni?.countyId ?? 'unknown'

  // Fetch all unembedded chunks for this municipality
  const unembedded = await db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.municipalityId, municipalityId))

  if (unembedded.length === 0) {
    console.log(`[vector:${municipalityId}] All chunks already embedded`)
    return 0
  }

  console.log(`[vector:${municipalityId}] Embedding ${unembedded.length} chunks...`)

  let upserted = 0

  for (let i = 0; i < unembedded.length; i += BATCH_SIZE) {
    const batch = unembedded.slice(i, i + BATCH_SIZE)

    // 1. Embed
    const embResp = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: batch.map(c => c.chunkText),
    })

    // 2. Build Pinecone records
    const vectors = batch.map((chunk, idx) => ({
      id:       chunk.id,
      values:   embResp.data[idx].embedding,
      metadata: {
        municipality: chunk.municipalityId ?? '',
        county:       countyId,
        section_id:   chunk.sectionId      ?? '',
        source_url:   chunk.sourceUrl      ?? '',
        source_type:  chunk.sourceType     ?? '',
        chunk_text:   chunk.chunkText.slice(0, 1000), // Pinecone metadata limit
      },
    }))

    // 3. Upsert to Pinecone
    await index.upsert({ records: vectors })

    // 4. Mark this batch as embedded in Postgres
    const ids = batch.map(c => c.id)
    await db
      .update(documentChunks)
      .set({ embeddedAt: new Date() })
      .where(inArray(documentChunks.id, ids))

    upserted += batch.length
    console.log(`[vector:${municipalityId}] ${upserted}/${unembedded.length} upserted`)
  }

  return upserted
}
