// OpenAI function-calling format tool definitions.
// Derived from src/tools/definitions.ts (Anthropic input_schema → OpenAI parameters).

export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'search_parcels',
      description:
        'Search DuPage County parcel records by address, owner name, municipality, flood zone, ownership type, ' +
        'assessed value range, lot size, building sqft, or year built. ' +
        'Returns PIN, address, owner, municipality, flood zone, assessed value, lot area, building sqft, and year built for each matching parcel.',
      parameters: {
        type: 'object',
        properties: {
          address:      { type: 'string', description: 'Partial address to search (e.g. "Goldenrod Dr")' },
          owner:        { type: 'string', description: 'Partial owner name (e.g. "Forest Preserve")' },
          municipality: { type: 'string', description: 'Municipality ID: naperville | wheaton | elmhurst | downers_grove | lombard | glen_ellyn | villa_park | carol_stream | warrenville | westmont' },
          flood_zone:   { type: 'string', description: 'FEMA flood zone code: A | AE | FW | X' },
          ownership_type: { type: 'string', enum: ['individual', 'corporate', 'trust', 'government'], description: 'Filter by ownership type' },
          min_assessed_value: { type: 'number', description: 'Minimum assessed value in dollars' },
          max_assessed_value: { type: 'number', description: 'Maximum assessed value in dollars' },
          min_lot_sqft:       { type: 'number', description: 'Minimum lot area in square feet' },
          max_lot_sqft:       { type: 'number', description: 'Maximum lot area in square feet' },
          min_building_sqft:  { type: 'number', description: 'Minimum building square footage' },
          max_building_sqft:  { type: 'number', description: 'Maximum building square footage' },
          min_year_built:     { type: 'number', description: 'Minimum year the structure was built' },
          max_year_built:     { type: 'number', description: 'Maximum year the structure was built' },
          limit:        { type: 'number', description: 'Max results to return (default 20)' },
        },
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'get_flood_zone_summary',
      description:
        'Summarise how many parcels fall in each flood zone across DuPage County, ' +
        'optionally filtered to a single municipality.',
      parameters: {
        type: 'object',
        properties: {
          municipality: { type: 'string', description: 'Optional municipality ID to narrow the summary' },
        },
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'list_zoning_districts',
      description:
        "List all zoning districts defined in a municipality's zoning ordinance. " +
        'Returns district code, full name, and category (residential/commercial/industrial/mixed/overlay).',
      parameters: {
        type: 'object',
        properties: {
          municipality: { type: 'string', description: 'Municipality ID: naperville | evanston' },
        },
        required: ['municipality'],
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'get_permitted_uses',
      description:
        'Return uses permitted in a specific zoning district — by right, conditional, prohibited, or accessory. ' +
        'Use this to answer "what can I build/operate in zone X?" questions.',
      parameters: {
        type: 'object',
        properties: {
          municipality:  { type: 'string', description: 'Municipality ID: naperville | evanston' },
          district_code: { type: 'string', description: 'Zoning district code, e.g. R1A, B1, RD' },
          permit_type: {
            type: 'string',
            enum: ['by_right', 'conditional', 'prohibited', 'accessory'],
            description: 'Filter by permit type (omit to return all)',
          },
        },
        required: ['municipality', 'district_code'],
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'get_development_standards',
      description:
        'Return dimensional/development standards for a zoning district: minimum lot size, ' +
        'setbacks, max height, max lot coverage, floor area ratio, density, etc.',
      parameters: {
        type: 'object',
        properties: {
          municipality:  { type: 'string', description: 'Municipality ID: naperville | evanston' },
          district_code: { type: 'string', description: 'Zoning district code, e.g. R1A, B1, RD' },
        },
        required: ['municipality', 'district_code'],
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'compare_districts',
      description:
        'Side-by-side comparison of development standards between two zoning districts. ' +
        'Districts may be in the same or different municipalities.',
      parameters: {
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
  },

  {
    type: 'function' as const,
    function: {
      name: 'search_ordinance_text',
      description:
        'Semantic search across ingested zoning ordinance text for Naperville and Evanston. ' +
        'Use this to answer nuanced questions not covered by structured tables — e.g. home occupation rules, ' +
        'sign regulations, parking ratios, ADU requirements, cannabis use rules, PUDs, nonconforming uses.',
      parameters: {
        type: 'object',
        properties: {
          query:        { type: 'string', description: 'Keyword or phrase to search for' },
          municipality: { type: 'string', description: 'Optional: naperville | evanston — omit to search both' },
          limit:        { type: 'number', description: 'Max chunks to return (default 5)' },
        },
        required: ['query'],
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'find_parcels_near',
      description:
        'Find parcels within a given radius (in metres) of a lat/lng point. ' +
        'Returns parcels sorted by distance ascending. Optionally filter by flood zone or ownership type.',
      parameters: {
        type: 'object',
        properties: {
          lat:            { type: 'number', description: 'Latitude of the centre point' },
          lon:            { type: 'number', description: 'Longitude of the centre point' },
          radius_meters:  { type: 'number', description: 'Search radius in metres (e.g. 500 for half a kilometre)' },
          flood_zone:     { type: 'string', description: 'Optional FEMA flood zone filter: A | AE | FW | X' },
          ownership_type: { type: 'string', enum: ['individual', 'corporate', 'trust', 'government'], description: 'Optional ownership type filter' },
          limit:          { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['lat', 'lon', 'radius_meters'],
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'get_parcels_in_flood_zone',
      description:
        'Return parcels in a specific FEMA flood zone (A, AE, FW, X), optionally filtered by municipality.',
      parameters: {
        type: 'object',
        properties: {
          flood_zone:   { type: 'string', description: 'FEMA flood zone code: A | AE | FW | X' },
          municipality: { type: 'string', description: 'Optional municipality ID to narrow results' },
          limit:        { type: 'number', description: 'Max results (default 20)' },
        },
        required: ['flood_zone'],
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'list_available_layers',
      description:
        'List all GIS data layers discovered and registered from DuPage County ArcGIS. ' +
        'Shows layer name, type (parcel/flood/road/school/wetland/zoning), and record count.',
      parameters: {
        type: 'object',
        properties: {
          county:     { type: 'string', description: 'County ID: dupage | cook' },
          layer_type: { type: 'string', description: 'Filter by type: parcel | flood | road | school | wetland | zoning | municipality | misc' },
        },
      },
    },
  },

  {
    type: 'function' as const,
    function: {
      name: 'get_municipality_summary',
      description:
        'High-level overview for a municipality: county, parcel count, zoning district count, ' +
        'ordinance chunk count, zoning source, and last scrape time.',
      parameters: {
        type: 'object',
        properties: {
          municipality: { type: 'string', description: 'Municipality ID: naperville | evanston | wheaton | elmhurst | downers_grove' },
        },
        required: ['municipality'],
      },
    },
  },
]

export const tools = toolDefinitions
