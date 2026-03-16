// MunicodeAdapter
// Used for municipalities hosted on library.municode.com (Evanston, Naperville).
// Uses Firecrawl to render JS-heavy SPA pages and return clean markdown text.
// Chapter URLs are hardcoded per municipality — discovered manually from the TOC.

import FirecrawlApp from '@mendable/firecrawl-js'
import type { ZoningAdapter, TOCNode } from './interface'

const BASE = 'https://library.municode.com'

// ── Evanston: TITLE 6 - ZONING (19 chapters) ──────────────────────────────────
const EVANSTON_CHAPTERS: Array<{ nodeId: string; title: string }> = [
  { nodeId: 'TIT6ZO_CH1TIPUIN',    title: 'Ch 1: Title, Purpose and Intent' },
  { nodeId: 'TIT6ZO_CH2RUINLEEF',  title: 'Ch 2: Rules of Interpretation and Legal Effect' },
  { nodeId: 'TIT6ZO_CH3IMAD',      title: 'Ch 3: Implementation and Administration' },
  { nodeId: 'TIT6ZO_CH4GEPR',      title: 'Ch 4: General Provisions' },
  { nodeId: 'TIT6ZO_CH5HOOC',      title: 'Ch 5: Home Occupations' },
  { nodeId: 'TIT6ZO_CH6NOUSNOST',  title: 'Ch 6: Nonconforming Uses and Noncomplying Structures' },
  { nodeId: 'TIT6ZO_CH7ZODIMA',    title: 'Ch 7: Zoning Districts and Map' },
  { nodeId: 'TIT6ZO_CH8REDI',      title: 'Ch 8: Residential Districts' },
  { nodeId: 'TIT6ZO_CH9BUDI',      title: 'Ch 9: Business Districts' },
  { nodeId: 'TIT6ZO_CH10CODI',     title: 'Ch 10: Commercial Districts' },
  { nodeId: 'TIT6ZO_CH11DODI',     title: 'Ch 11: Downtown Districts' },
  { nodeId: 'TIT6ZO_CH12REPADI',   title: 'Ch 12: Research Park District' },
  { nodeId: 'TIT6ZO_CH13TRMADI',   title: 'Ch 13: Transitional Manufacturing Districts' },
  { nodeId: 'TIT6ZO_CH14INDI',     title: 'Ch 14: Industrial Districts' },
  { nodeId: 'TIT6ZO_CH15SPPUOVDI', title: 'Ch 15: Special Purpose and Overlay Districts' },
  { nodeId: 'TIT6ZO_CH16OREPALO',  title: 'Ch 16: Off-Street Parking and Loading' },
  { nodeId: 'TIT6ZO_CH17LASC',     title: 'Ch 17: Landscaping and Screening' },
  { nodeId: 'TIT6ZO_CH18DE',       title: 'Ch 18: Definitions' },
  { nodeId: 'TIT6ZO_CH19SIRE',     title: 'Ch 19: Sign Regulations' },
]

// ── Naperville: TITLE 6 - ZONING REGULATIONS (16 chapters) ───────────────────
const NAPERVILLE_CHAPTERS: Array<{ nodeId: string; title: string }> = [
  { nodeId: 'TIT6ZORE_CH1ZOTIPUDE',    title: 'Ch 1: Zoning Title, Purpose, Definitions' },
  { nodeId: 'TIT6ZORE_CH2GEZOPR',      title: 'Ch 2: General Zoning Provisions' },
  { nodeId: 'TIT6ZORE_CH3ADEN',        title: 'Ch 3: Administration and Enforcement' },
  { nodeId: 'TIT6ZORE_CH4PLUNDE',      title: 'Ch 4: Planned Unit Developments' },
  { nodeId: 'TIT6ZORE_CH5ZODIMA',      title: 'Ch 5: Zoning Districts; Map' },
  { nodeId: 'TIT6ZORE_CH6REDI',        title: 'Ch 6: Residence Districts' },
  { nodeId: 'TIT6ZORE_CH7BUDI',        title: 'Ch 7: Business Districts' },
  { nodeId: 'TIT6ZORE_CH8INDI',        title: 'Ch 8: Industrial Districts' },
  { nodeId: 'TIT6ZORE_CH9OFSTPA',      title: 'Ch 9: Off Street Parking' },
  { nodeId: 'TIT6ZORE_CH10NOUS',       title: 'Ch 10: Nonconforming Uses' },
  { nodeId: 'TIT6ZORE_CH11HIPR',       title: 'Ch 11: Historic Preservation' },
  { nodeId: 'TIT6ZORE_CH12ADUS',       title: 'Ch 12: Adult Uses' },
  { nodeId: 'TIT6ZORE_CH13RETEFA',     title: 'Ch 13: Regulations for Telecommunication Facilities' },
  { nodeId: 'TIT6ZORE_CH14PEST',       title: 'Ch 14: Performance Standards' },
  { nodeId: 'TIT6ZORE_CH15SMWISOREENSY', title: 'Ch 15: Small Wind and Solar Renewable Energy Systems' },
  { nodeId: 'TIT6ZORE_CH16SI',         title: 'Ch 16: Signs' },
]

// Slug path per municipality on library.municode.com
const MUNICODE_PATHS: Record<string, { slug: string; chapters: Array<{ nodeId: string; title: string }> }> = {
  evanston:   { slug: 'il/evanston/codes/code_of_ordinances',   chapters: EVANSTON_CHAPTERS },
  naperville: { slug: 'il/naperville/codes/code_of_ordinances', chapters: NAPERVILLE_CHAPTERS },
}

export class MunicodeAdapter implements ZoningAdapter {
  private firecrawl: FirecrawlApp

  constructor() {
    this.firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY ?? '' })
  }

  async fetchTableOfContents(municipalityId: string): Promise<TOCNode[]> {
    const config = MUNICODE_PATHS[municipalityId]
    if (!config) throw new Error(`No Municode chapter list configured for: ${municipalityId}`)
    if (config.chapters.length === 0) throw new Error(`Empty chapter list for: ${municipalityId}`)

    return config.chapters.map(ch => ({
      id:    ch.nodeId,
      title: ch.title,
      url:   `${BASE}/${config.slug}?nodeId=${ch.nodeId}`,
    }))
  }

  async fetchSection(node: TOCNode): Promise<string> {
    console.log(`[municode] Scraping: ${node.url}`)

    const result = await this.firecrawl.scrape(node.url, {
      formats: ['markdown'],
    })

    const text = result.markdown ?? ''
    if (!text) {
      throw new Error(`Firecrawl returned no markdown for ${node.url}`)
    }
    return text.replace(/\s+/g, ' ').trim()
  }
}
