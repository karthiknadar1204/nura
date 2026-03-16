// PdfDirectAdapter
// Used for municipalities that host zoning ordinance chapters as individual
// PDFs on their own website (e.g. Wheaton — 34 chapter PDFs at /DocumentCenter/View/{ID}).
// Access: HTTP GET → pdf-parse → plain text. No browser rendering needed.

import type { ZoningAdapter, TOCNode } from './interface'
// pdf-parse v1 exports a plain CJS function — require it directly
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse')

// All confirmed Wheaton zoning ordinance chapter PDFs from API_INVENTORY.md
const WHEATON_CHAPTERS: Array<{ docId: string; title: string }> = [
  { docId: '1084',  title: 'Table of Contents' },
  { docId: '1087',  title: 'Ch 02: Definitions' },
  { docId: '1088',  title: 'Ch 03: Zoning Districts & General Regulations' },
  { docId: '1092',  title: 'Ch 07: R-1 Single Family Residential District' },
  { docId: '1093',  title: 'Ch 08: R-2 Single Family Residential District' },
  { docId: '1094',  title: 'Ch 09: R-3 Single Family Residential District' },
  { docId: '1095',  title: 'Ch 10: R-4 Multiple Family Residential District' },
  { docId: '1096',  title: 'Ch 11: R-5 Multiple Family Residential District' },
  { docId: '1097',  title: 'Ch 12: R-6 Multiple Family Residential District' },
  { docId: '1098',  title: 'Ch 13: R-7 Multiple Family Residential District' },
  { docId: '1099',  title: 'Ch 14: I-1 and I-2 Institutional Districts' },
  { docId: '1100',  title: 'Ch 15: O-R Office and Research District' },
  { docId: '1101',  title: 'Ch 16: C-1 Local Business District' },
  { docId: '1102',  title: 'Ch 17: C-2 Retail Core Business District' },
  { docId: '1103',  title: 'Ch 18: C-3 General Business District' },
  { docId: '1104',  title: 'Ch 19: C-4 CBD Perimeter Commercial District' },
  { docId: '1105',  title: 'Ch 20: C-5 Planned Commercial District' },
  { docId: '1106',  title: 'Ch 21: M-1 Manufacturing District' },
  { docId: '1107',  title: 'Ch 22: Off-Street Parking and Loading' },
  { docId: '1108',  title: 'Ch 23: Signs' },
  { docId: '1109',  title: 'Ch 24: Accessory Uses and Home Occupations' },
  { docId: '1110',  title: 'Ch 25: Performance Standards' },
  { docId: '1112',  title: 'Ch 27: Downtown Design Review Overlay District' },
  { docId: '1113',  title: 'Ch 28: Northside Residential Overlay District' },
  { docId: '17507', title: 'Ch 31: Roosevelt Road Corridor District' },
  { docId: '17921', title: 'Ch 32: DuPage County Governmental Center District' },
]

const BASE_URL = 'https://www.wheaton.il.us/DocumentCenter/View'

export class PdfDirectAdapter implements ZoningAdapter {
  async fetchTableOfContents(_municipalityId: string): Promise<TOCNode[]> {
    return WHEATON_CHAPTERS.map(ch => ({
      id:    ch.docId,
      title: ch.title,
      url:   `${BASE_URL}/${ch.docId}`,
    }))
  }

  async fetchSection(node: TOCNode): Promise<string> {
    const res = await fetch(node.url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${node.url}`)

    const buffer = Buffer.from(await res.arrayBuffer())
    const data   = await pdfParse(buffer)

    // Normalize whitespace: collapse runs of whitespace, preserve paragraph breaks
    return data.text
      .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace
      .replace(/\n{3,}/g, '\n\n')        // at most two consecutive newlines
      .trim()
  }
}
