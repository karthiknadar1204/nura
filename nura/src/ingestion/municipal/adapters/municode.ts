// MunicodeAdapter
// Used for municipalities hosted on library.municode.com (Naperville, Evanston).
// Municode is a JavaScript SPA — plain HTTP fetch returns 401.
// Access: Playwright headless browser → render TOC → walk chapter tree.

import type { ZoningAdapter, TOCNode } from './interface'

export class MunicodeAdapter implements ZoningAdapter {
  // TODO: implement with Playwright
  async fetchTableOfContents(_municipalityId: string): Promise<TOCNode[]> {
    throw new Error('MunicodeAdapter not yet implemented')
  }

  async fetchSection(_node: TOCNode): Promise<string> {
    throw new Error('MunicodeAdapter not yet implemented')
  }
}
