// ZoningAdapter — one interface, four implementations.
// Every adapter returns the same shape regardless of source system.

export interface TOCNode {
  id: string
  title: string
  url: string
  children?: TOCNode[]
}

export interface ZoningAdapter {
  // Returns the table of contents tree for the municipality's zoning ordinance
  fetchTableOfContents(municipalityId: string): Promise<TOCNode[]>
  // Returns plain text content for a single section
  fetchSection(node: TOCNode): Promise<string>
}
