// OpenAI / Claude tool definitions (JSON Schema format).
// Import these into any chat endpoint to enable tool calling.

export const TOOL_DEFINITIONS = [
  {
    name: 'search_parcels',
    description:
      'Search DuPage County parcel records by address, owner name, municipality, or flood zone. ' +
      'Returns PIN, address, owner, municipality, and flood zone for each matching parcel.',
    input_schema: {
      type: 'object',
      properties: {
        address:      { type: 'string', description: 'Partial address to search (e.g. "Goldenrod Dr")' },
        owner:        { type: 'string', description: 'Partial owner name (e.g. "Forest Preserve")' },
        municipality: { type: 'string', description: 'Municipality ID: naperville | wheaton | elmhurst | downers_grove | lombard | glen_ellyn | villa_park | carol_stream | warrenville | westmont' },
        flood_zone:   { type: 'string', description: 'FEMA flood zone code: A | AE | FW | X' },
        limit:        { type: 'number', description: 'Max results to return (default 20)' },
      },
    },
  },

  {
    name: 'get_flood_zone_summary',
    description:
      'Summarise how many parcels fall in each flood zone across DuPage County, ' +
      'optionally filtered to a single municipality.',
    input_schema: {
      type: 'object',
      properties: {
        municipality: { type: 'string', description: 'Optional municipality ID to narrow the summary' },
      },
    },
  },

  {
    name: 'list_zoning_districts',
    description:
      'List all zoning districts defined in a municipality\'s zoning ordinance. ' +
      'Returns district code, full name, and category (residential/commercial/industrial/mixed/overlay).',
    input_schema: {
      type: 'object',
      properties: {
        municipality: { type: 'string', description: 'Municipality ID: naperville | evanston' },
      },
      required: ['municipality'],
    },
  },

  {
    name: 'get_permitted_uses',
    description:
      'Return uses permitted in a specific zoning district — by right, conditional, prohibited, or accessory. ' +
      'Use this to answer "what can I build/operate in zone X?" questions.',
    input_schema: {
      type: 'object',
      properties: {
        municipality:  { type: 'string', description: 'Municipality ID: naperville | evanston' },
        district_code: { type: 'string', description: 'Zoning district code, e.g. R1A, B1, RD' },
        permit_type:   {
          type: 'string',
          enum: ['by_right', 'conditional', 'prohibited', 'accessory'],
          description: 'Filter by permit type (omit to return all)',
        },
      },
      required: ['municipality', 'district_code'],
    },
  },

  {
    name: 'get_development_standards',
    description:
      'Return dimensional/development standards for a zoning district: minimum lot size, ' +
      'setbacks, max height, max lot coverage, floor area ratio, density, etc.',
    input_schema: {
      type: 'object',
      properties: {
        municipality:  { type: 'string', description: 'Municipality ID: naperville | evanston' },
        district_code: { type: 'string', description: 'Zoning district code, e.g. R1A, B1, RD' },
      },
      required: ['municipality', 'district_code'],
    },
  },

  {
    name: 'compare_districts',
    description:
      'Side-by-side comparison of development standards between two zoning districts. ' +
      'Districts may be in the same or different municipalities.',
    input_schema: {
      type: 'object',
      properties: {
        municipality_a:  { type: 'string', description: 'Municipality ID for district A' },
        district_code_a: { type: 'string', description: 'District code for district A' },
        municipality_b:  { type: 'string', description: 'Municipality ID for district B' },
        district_code_b: { type: 'string', description: 'District code for district B' },
      },
      required: ['municipality_a', 'district_code_a', 'municipality_b', 'district_code_b'],
    },
  },

  {
    name: 'search_ordinance_text',
    description:
      'Full-text keyword search across ingested zoning ordinance chunks for Naperville and Evanston. ' +
      'Use this to answer nuanced questions not covered by structured tables — e.g. home occupation rules, ' +
      'sign regulations, parking ratios, ADU requirements, cannabis use rules.',
    input_schema: {
      type: 'object',
      properties: {
        query:        { type: 'string', description: 'Keyword or phrase to search for' },
        municipality: { type: 'string', description: 'Optional: naperville | evanston — omit to search both' },
        limit:        { type: 'number', description: 'Max chunks to return (default 5)' },
      },
      required: ['query'],
    },
  },

  {
    name: 'get_parcels_in_flood_zone',
    description:
      'Return parcels in a specific FEMA flood zone (A, AE, FW, X), optionally filtered by municipality.',
    input_schema: {
      type: 'object',
      properties: {
        flood_zone:   { type: 'string', description: 'FEMA flood zone code: A | AE | FW | X' },
        municipality: { type: 'string', description: 'Optional municipality ID to narrow results' },
        limit:        { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['flood_zone'],
    },
  },

  {
    name: 'list_available_layers',
    description:
      'List all GIS data layers discovered and registered from DuPage County ArcGIS. ' +
      'Shows layer name, type (parcel/flood/road/school/wetland/zoning), and record count.',
    input_schema: {
      type: 'object',
      properties: {
        county:     { type: 'string', description: 'County ID: dupage | cook' },
        layer_type: { type: 'string', description: 'Filter by type: parcel | flood | road | school | wetland | zoning | municipality | misc' },
      },
    },
  },

  {
    name: 'get_municipality_summary',
    description:
      'High-level overview for a municipality: county, parcel count, zoning district count, ' +
      'ordinance chunk count, zoning source, and last scrape time.',
    input_schema: {
      type: 'object',
      properties: {
        municipality: { type: 'string', description: 'Municipality ID: naperville | evanston | wheaton | elmhurst | downers_grove' },
      },
      required: ['municipality'],
    },
  },
] as const
