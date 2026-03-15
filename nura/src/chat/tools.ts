// Tool definitions for OpenAI function calling format.

export const toolDefinitions = [
  {
    type: 'function' as const,
    function: {
      name: 'lookup_parcel',
      description: 'Search for parcels by address, owner name, or PIN using fuzzy matching. Use when the user mentions a specific address, owner name, or parcel ID.',
      parameters: {
        type: 'object',
        properties: {
          query:  { type: 'string', description: 'Address, owner name, or PIN to search for' },
          county: { type: 'string', enum: ['dupage', 'cook'], description: 'County to search in (default: dupage)' },
          limit:  { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'filter_parcels',
      description: 'Filter parcels by structured criteria: municipality, flood zone, owner type, zoning code, assessed value range, or year built. Use for broad queries like "all flood zone parcels in Addison" or "corporate-owned properties worth over $500k".',
      parameters: {
        type: 'object',
        properties: {
          county:         { type: 'string', enum: ['dupage', 'cook'] },
          municipality:   { type: 'string', description: 'Municipality name e.g. "Addison", "Downers Grove"' },
          flood_zone:     { type: 'string', description: 'Specific FEMA flood zone code e.g. "AE", "X", "FW"' },
          in_flood_zone:  { type: 'boolean', description: 'true = only parcels in any flood zone, false = only parcels not in flood zone' },
          owner_type:     { type: 'string', enum: ['individual', 'corporate', 'trust', 'government'] },
          zoning_code:    { type: 'string', description: 'Zoning code e.g. "R-1", "B-3"' },
          min_value:      { type: 'number', description: 'Minimum assessed value in dollars' },
          max_value:      { type: 'number', description: 'Maximum assessed value in dollars' },
          min_year_built: { type: 'number', description: 'Minimum year built' },
          max_year_built: { type: 'number', description: 'Maximum year built' },
          limit:          { type: 'number', description: 'Max results (default 10, max 50)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_parcel_detail',
      description: 'Get full details for a specific parcel by exact PIN number.',
      parameters: {
        type: 'object',
        properties: {
          pin:    { type: 'string', description: 'Parcel identification number' },
          county: { type: 'string', enum: ['dupage', 'cook'] },
        },
        required: ['pin'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'spatial_query',
      description: 'Find parcels within a radius of a point. The center can be given as lat/lng coordinates OR as an address/PIN string. Optionally filter results by flood zone, owner type, etc.',
      parameters: {
        type: 'object',
        properties: {
          address_pin:    { type: 'string', description: 'Address or PIN to use as the center point (alternative to lat/lng)' },
          lat:            { type: 'number', description: 'Latitude of center point' },
          lng:            { type: 'number', description: 'Longitude of center point' },
          radius_meters:  { type: 'number', description: 'Search radius in meters (default 500)' },
          county:         { type: 'string', enum: ['dupage', 'cook'] },
          flood_zone:     { type: 'string', description: 'Filter by specific flood zone code' },
          in_flood_zone:  { type: 'boolean', description: 'true = only flood zone parcels, false = only non-flood zone' },
          owner_type:     { type: 'string', enum: ['individual', 'corporate', 'trust', 'government'] },
          limit:          { type: 'number', description: 'Max results (default 10)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_county_stats',
      description: 'Get aggregate statistics for a county or municipality: total parcels, flood zone breakdown, ownership type breakdown, average assessed values.',
      parameters: {
        type: 'object',
        properties: {
          county:       { type: 'string', enum: ['dupage', 'cook'] },
          municipality: { type: 'string', description: 'Optionally narrow stats to a specific municipality' },
        },
        required: [],
      },
    },
  },
]

export const tools = toolDefinitions
