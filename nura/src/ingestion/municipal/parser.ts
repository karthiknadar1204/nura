// Zoning ordinance text parser.
// Takes raw plain text from any adapter and extracts structured data using
// LLM-assisted extraction. Output schema is identical regardless of source.
// Writes to: zoning_districts, permitted_uses, development_standards (Postgres)
// and chunks text for document_chunks (embedded separately in Step 9).

import { randomUUID } from 'crypto'
import OpenAI from 'openai'
import { sql } from 'drizzle-orm'
import { db } from '../../db/client'
import {
  zoningDistricts,
  permittedUses,
  developmentStandards,
  documentChunks,
} from '../../db/schema'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── Text chunking ─────────────────────────────────────────────────────────────
// ~500 tokens ≈ 2000 chars, 50-token overlap ≈ 200 chars

export function chunkText(text: string, maxChars = 2000, overlapChars = 200): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length)
    chunks.push(text.slice(start, end).trim())
    if (end === text.length) break
    start = end - overlapChars
  }
  return chunks.filter(c => c.length > 50)  // skip trivially short chunks
}

// ── Structured extraction via OpenAI ─────────────────────────────────────────

interface ExtractedDistrict {
  code:        string   // e.g. "R-1"
  name:        string   // e.g. "Single Family Residential District"
  category:    string   // residential | commercial | industrial | mixed | overlay | special
  description: string
}

interface ExtractedPermittedUse {
  district_code:   string
  use_description: string
  permit_type:     'by_right' | 'conditional' | 'prohibited' | 'accessory'
  use_category:    string   // residential | commercial | civic | industrial | etc.
  conditions:      string | null
}

interface ExtractedStandard {
  district_code: string
  standard_type: string   // min_lot_sqft | front_setback_ft | max_height_ft | etc.
  value:         number | null
  unit:          string   // sqft | ft | % | units_per_acre
  conditions:    string | null
}

interface ExtractionResult {
  districts:            ExtractedDistrict[]
  permitted_uses:       ExtractedPermittedUse[]
  development_standards: ExtractedStandard[]
}

const EXTRACTION_SYSTEM = `You are a zoning ordinance data extraction assistant.
Given the text of a zoning ordinance chapter, extract structured information as JSON.

Return an object with these keys:
- "districts": array of zoning districts defined in this chapter
- "permitted_uses": array of permitted, conditional, or prohibited uses per district
- "development_standards": array of dimensional/development standards per district

For development_standards, use these standard_type values:
  min_lot_sqft, min_lot_width_ft, front_setback_ft, rear_setback_ft,
  side_setback_ft, max_height_ft, max_lot_coverage_pct, floor_area_ratio,
  max_density, min_unit_size_sqft

For district category use one of: residential, commercial, industrial, mixed, overlay, special, institutional

If the chapter does not define any specific districts (e.g. Table of Contents, Definitions),
return empty arrays. Extract only what is actually present — do not hallucinate values.`

export async function extractStructuredData(
  chapterTitle: string,
  text: string,
): Promise<ExtractionResult> {
  // Truncate to ~12k chars to stay within context limits (~3k tokens for the text)
  const truncated = text.slice(0, 12_000)

  const resp = await openai.chat.completions.create({
    model:           'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM },
      {
        role:    'user',
        content: `Chapter: "${chapterTitle}"\n\n${truncated}`,
      },
    ],
    temperature: 0,
  })

  try {
    const raw = JSON.parse(resp.choices[0].message.content ?? '{}')
    return {
      districts:             Array.isArray(raw.districts)             ? raw.districts             : [],
      permitted_uses:        Array.isArray(raw.permitted_uses)        ? raw.permitted_uses        : [],
      development_standards: Array.isArray(raw.development_standards) ? raw.development_standards : [],
    }
  } catch {
    return { districts: [], permitted_uses: [], development_standards: [] }
  }
}

// ── DB writers ────────────────────────────────────────────────────────────────

export async function storeChunks(
  municipalityId: string,
  sectionId:      string,
  sourceUrl:      string,
  text:           string,
): Promise<number> {
  // Idempotent: skip if chunks for this section already exist
  const existing = await db.execute(
    sql`SELECT 1 FROM document_chunks WHERE municipality_id = ${municipalityId} AND section_id = ${sectionId} LIMIT 1`
  )
  if (existing.rows.length > 0) {
    console.log(`[parser] Chunks for ${municipalityId}/${sectionId} already exist — skipping`)
    return 0
  }

  const chunks = chunkText(text)
  for (const chunk of chunks) {
    await db.insert(documentChunks).values({
      id:             randomUUID(),
      municipalityId,
      sourceType:     'zoning_ordinance',
      chunkText:      chunk,
      sectionId,
      sourceUrl,
    })
  }
  return chunks.length
}

export async function storeStructuredData(
  municipalityId: string,
  extracted:      ExtractionResult,
): Promise<void> {
  // Upsert each district
  for (const d of extracted.districts) {
    if (!d.code) continue

    await db.execute(sql`
      INSERT INTO zoning_districts (id, municipality_id, district_code, district_name, category, description)
      VALUES (gen_random_uuid(), ${municipalityId}, ${d.code}, ${d.name ?? null}, ${d.category ?? null}, ${d.description ?? null})
      ON CONFLICT (municipality_id, district_code) DO UPDATE SET
        district_name = EXCLUDED.district_name,
        category      = EXCLUDED.category,
        description   = EXCLUDED.description
    `)
  }

  // For uses and standards, look up the district row ID by code
  for (const use of extracted.permitted_uses) {
    if (!use.district_code || !use.use_description) continue

    const rows = await db.execute(sql`
      SELECT id FROM zoning_districts
      WHERE municipality_id = ${municipalityId} AND district_code = ${use.district_code}
      LIMIT 1
    `)
    if (rows.rows.length === 0) continue
    const districtId = (rows.rows[0] as any).id

    await db.insert(permittedUses).values({
      districtId,
      useCategory:    use.use_category   ?? null,
      useDescription: use.use_description,
      permitType:     use.permit_type    ?? 'by_right',
      conditions:     use.conditions     ?? null,
    }).onConflictDoNothing()
  }

  for (const std of extracted.development_standards) {
    if (!std.district_code || !std.standard_type) continue

    const rows = await db.execute(sql`
      SELECT id FROM zoning_districts
      WHERE municipality_id = ${municipalityId} AND district_code = ${std.district_code}
      LIMIT 1
    `)
    if (rows.rows.length === 0) continue
    const districtId = (rows.rows[0] as any).id

    await db.insert(developmentStandards).values({
      districtId,
      standardType: std.standard_type,
      value:        std.value != null ? String(std.value) : null,
      unit:         std.unit         ?? null,
      conditions:   std.conditions   ?? null,
    }).onConflictDoNothing()
  }
}
