// Worker process for municipal ordinance ingestion jobs.
// Run with: bun run src/workers/municipal.worker.ts

import { Worker } from 'bullmq'
import redis from '../queue/redis'
import { runMunicipalIngestion } from '../ingestion/municipal/pipeline'

const worker = new Worker(
  'ingestion-municipal',
  async (job) => {
    const { municipalityId } = job.data
    console.log(`[municipal-worker] Starting job ${job.id}: municipality=${municipalityId}`)
    const result = await runMunicipalIngestion(municipalityId)
    console.log(`[municipal-worker] Completed job ${job.id}: municipality=${municipalityId}`)
    return result
  },
  {
    connection: redis,
    concurrency: 2,   // two municipalities in parallel is fine
  },
)

worker.on('completed', (job) => {
  console.log(`[municipal-worker] Job ${job.id} completed`)
})

worker.on('failed', (job, err) => {
  console.error(`[municipal-worker] Job ${job?.id} failed:`, err.message)
})

console.log('[municipal-worker] Listening for ingestion-municipal jobs...')