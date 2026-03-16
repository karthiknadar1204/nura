// Worker process for county-level ingestion jobs.
// Run with: bun run src/workers/pipeline.worker.ts

import { Worker } from 'bullmq'
import redis from '../queue/redis'
import { runIngestion } from '../ingestion/pipeline'

const worker = new Worker(
  'ingestion-pipeline',
  async (job) => {
    const { countyId, jobType } = job.data
    console.log(`[pipeline-worker] Starting job ${job.id}: county=${countyId} type=${jobType}`)
    const result = await runIngestion({ countyId, jobType })
    console.log(`[pipeline-worker] Completed job ${job.id}`)
    return result
  },
  {
    connection: redis,
    concurrency: 1,   // one county at a time — ingestion is heavy
  },
)

worker.on('completed', (job) => {
  console.log(`[pipeline-worker] Job ${job.id} completed`)
})

worker.on('failed', (job, err) => {
  console.error(`[pipeline-worker] Job ${job?.id} failed:`, err.message)
})

console.log('[pipeline-worker] Listening for ingestion-pipeline jobs...')