// PdfDirectAdapter
// Used for municipalities that host zoning ordinance chapters as individual
// PDFs on their own website (e.g. Wheaton — 34 chapter PDFs at /DocumentCenter/View/{ID}).
// Access: HTTP GET → pdf-parse → plain text. No browser rendering needed.

import type { ZoningAdapter, TOCNode } from './interface'

export class PdfDirectAdapter implements ZoningAdapter {
  // TODO: implement
  async fetchTableOfContents(_municipalityId: string): Promise<TOCNode[]> {
    throw new Error('PdfDirectAdapter not yet implemented')
  }

  async fetchSection(_node: TOCNode): Promise<string> {
    throw new Error('PdfDirectAdapter not yet implemented')
  }
}
