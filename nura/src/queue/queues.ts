import { Queue } from 'bullmq'
import redis from './redis'

// Queue for county-level ArcGIS parcel + overlay ingestion
export const pipelineQueue = new Queue('ingestion-pipeline', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})

// Queue for municipal ordinance scraping + zoning extraction
export const municipalQueue = new Queue('ingestion-municipal', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
})