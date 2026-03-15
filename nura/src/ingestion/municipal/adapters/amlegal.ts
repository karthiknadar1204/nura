// AMLegalAdapter
// Used for municipalities hosted on codelibrary.amlegal.com (Chicago — Title 17).
// Also a JavaScript SPA — requires Playwright headless browser.

import type { ZoningAdapter, TOCNode } from './interface'

export class AMLegalAdapter implements ZoningAdapter {
  // TODO: implement with Playwright
  async fetchTableOfContents(_municipalityId: string): Promise<TOCNode[]> {
    throw new Error('AMLegalAdapter not yet implemented')
  }

  async fetchSection(_node: TOCNode): Promise<string> {
    throw new Error('AMLegalAdapter not yet implemented')
  }
}
