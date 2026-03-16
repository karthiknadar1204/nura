// Municipal zoning ordinance ingestion pipeline (Step 8).
// Orchestrates: adapter → fetch section text → chunk + store → LLM extract + store.

import { eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { municipalities, ingestionJobs } from '../../db/schema'
import { MunicodeAdapter } from './adapters/municode'
import type { ZoningAdapter } from './adapters/interface'
import { storeChunks, storeStructuredData, extractStructuredData } from './parser'

const INTER_REQUEST_DELAY_MS = 300

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function getAdapter(zoningSource: string): ZoningAdapter {
  switch (zoningSource) {
    case 'municode': return new MunicodeAdapter()
    default:         throw new Error(`No adapter for zoning source: ${zoningSource}`)
  }
}

export async function runMunicipalIngestion(municipalityId: string): Promise<void> {
  const [muni] = await db.select().from(municipalities).where(eq(municipalities.id, municipalityId))
  if (!muni) throw new Error(`Municipality not found: ${municipalityId}`)
  if (!muni.zoningSource) throw new Error(`No zoning source configured for ${municipalityId}`)

  console.log(`\n[municipal] Starting ingestion for ${muni.name} (${muni.zoningSource})`)

  // Create tracking job
  const [job] = await db.insert(ingestionJobs).values({
    countyId:  muni.countyId,
    layerName: `zoning:${municipalityId}`,
    jobType:   'full',
    status:    'running',
    startedAt: new Date(),
  }).returning()

  let processed = 0
  let failed    = 0

  try {
    const adapter = getAdapter(muni.zoningSource)
    const toc     = await adapter.fetchTableOfContents(municipalityId)

    console.log(`[municipal:${municipalityId}] ${toc.length} chapters in TOC`)

    for (const node of toc) {
      console.log(`[municipal:${municipalityId}] Processing: ${node.title}`)

      try {
        const text = await adapter.fetchSection(node)
        if (!text || text.length < 100) {
          console.warn(`[municipal:${municipalityId}] Skipping ${node.title} — too short`)
          continue
        }

        // Store text chunks for RAG (document_chunks table)
        const chunkCount = await storeChunks(municipalityId, node.id, node.url, text)
        console.log(`[municipal:${municipalityId}]   → ${chunkCount} chunks stored`)

        // LLM structured extraction → zoning_districts, permitted_uses, development_standards
        const extracted = await extractStructuredData(node.title, text)
        await storeStructuredData(municipalityId, extracted)

        const { districts, permitted_uses, development_standards } = extracted
        if (districts.length > 0 || permitted_uses.length > 0 || development_standards.length > 0) {
          console.log(
            `[municipal:${municipalityId}]   → extracted: ` +
            `${districts.length} districts, ${permitted_uses.length} uses, ${development_standards.length} standards`
          )
        }

        processed++
      } catch (err) {
        console.error(`[municipal:${municipalityId}] Chapter failed (${node.title}):`, err)
        failed++
      }

      await sleep(INTER_REQUEST_DELAY_MS)
    }

    // Update last_scraped_at on municipality
    await db.update(municipalities)
      .set({ lastScrapedAt: new Date() })
      .where(eq(municipalities.id, municipalityId))

    // Complete job
    await db.update(ingestionJobs).set({
      status:           'completed',
      recordsProcessed: processed,
      recordsFailed:    failed,
      completedAt:      new Date(),
    }).where(eq(ingestionJobs.id, job.id))

    // Close browser if adapter holds one (Playwright-based adapters)
    if (typeof (adapter as any).close === 'function') {
      await (adapter as any).close()
    }

    console.log(`[municipal:${municipalityId}] Done. processed=${processed} failed=${failed}`)
  } catch (err) {
    if (typeof (adapter as any).close === 'function') {
      await (adapter as any).close().catch(() => {})
    }
    await db.update(ingestionJobs).set({
      status:      'failed',
      errorLog:    { message: String(err) },
      completedAt: new Date(),
    }).where(eq(ingestionJobs.id, job.id))
    throw err
  }
}
