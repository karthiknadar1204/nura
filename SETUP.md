# Nura — Setup Guide

## Example

![Nura chat UI](./Screenshot%202026-03-16%20at%204.09.35%20PM.png)

---

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Node.js](https://nodejs.org) >= 18 (for the Next.js frontend)
- [Redis](https://redis.io) running locally on port 6379 (used by BullMQ workers)
- A [Neon](https://neon.tech) Postgres database with the PostGIS extension enabled
- A [Pinecone](https://pinecone.io) account with an index created (dimension 1536, metric cosine)
- An [OpenAI](https://platform.openai.com) API key
- A [Firecrawl](https://firecrawl.dev) API key (used for ordinance scraping)

---

## Backend (`nura/`)

### 1. Install dependencies

```bash
cd nura
bun install
```

### 2. Environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

```env
# Neon Postgres (PostGIS required)
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# OpenAI — used by the chat agent and embeddings
OPENAI_API_KEY=sk-...

# Pinecone — vector store for ordinance RAG
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX_NAME=nura          # name of your index (dimension 1536, cosine)

# Firecrawl — used to scrape zoning ordinance pages
FIRECRAWL_API_KEY=fc-...

# Redis — used by BullMQ ingestion queue
REDIS_URL=redis://localhost:6379
```

### 3. Run database migrations and seed

```bash
bun run db:migrate     # applies all Drizzle migrations
bun run db:seed        # inserts counties + municipalities reference data
```

### 4. Start the API server

```bash
bun run dev            # hot-reload on port 3004
```

The API will be available at `http://localhost:3004`.

#### Available endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Chat with the agent — `{ "message": "..." }` |
| `POST` | `/ingest/trigger` | Trigger a full ingestion run — `{ "countyId": "dupage", "jobType": "full" }` |
| `GET` | `/layers` | List discovered GIS layers |
| `GET` | `/search` | Direct parcel search |

### 5. Start the ingestion worker (separate terminal)

The ingestion pipeline runs as a BullMQ worker. It must be running for `/ingest/trigger` to process jobs.

```bash
bun run worker:pipeline
```

### 6. (Optional) Run an ingestion

With both the API server and worker running:

```bash
curl -X POST http://localhost:3004/ingest/trigger \
  -H "Content-Type: application/json" \
  -d '{"countyId": "dupage", "jobType": "full"}'
```

This will:
1. Discover all GIS layers from the DuPage ArcGIS REST endpoint + DCAT feed
2. Fetch 10,000 parcel records in parallel (10 concurrent pages)
3. Upsert parcels with geometry via batch SQL
4. Ingest municipality, flood zone, and zoning overlay layers in parallel
5. Run spatial joins to stamp `municipality_id`, `flood_zone`, and `zoning_code` on parcels

---

## Frontend (`client/`)

### 1. Install dependencies

```bash
cd client
npm install       # or: bun install
```

### 2. Environment variables

The frontend has no required environment variables — it connects directly to the backend at `http://localhost:3004`.

If you need to change the backend URL, edit the fetch call in `app/page.tsx`:

```ts
const res = await fetch('http://localhost:3004/chat', { ... })
```

### 3. Start the dev server

```bash
npm run dev       # starts Next.js on port 3000
```

The chat UI will be available at `http://localhost:3000`.

---

## Running everything together

Open three terminals:

```bash
# Terminal 1 — backend API
cd nura && bun run dev

# Terminal 2 — ingestion worker
cd nura && bun run worker:pipeline

# Terminal 3 — frontend
cd client && npm run dev
```

Then open `http://localhost:3000` and start asking questions.
