// ECode360Adapter
// Used for municipalities hosted on ecode360.com.
// Returns 403 to plain HTTP — requires Playwright or their internal JSON API
// at /api/1/{municipality-code}/toc if it responds without auth.

import type { ZoningAdapter, TOCNode } from './interface'

export class ECode360Adapter implements ZoningAdapter {
  // TODO: implement — try JSON API first, fall back to Playwright
  async fetchTableOfContents(_municipalityId: string): Promise<TOCNode[]> {
    throw new Error('ECode360Adapter not yet implemented')
  }

  async fetchSection(_node: TOCNode): Promise<string> {
    throw new Error('ECode360Adapter not yet implemented')
  }
}
