// Tool call dispatcher — routes tool calls to the appropriate handler.

import {
  searchParcels,
  getFloodZoneSummary,
  listZoningDistricts,
  getPermittedUses,
  getDevelopmentStandards,
  compareDistricts,
  searchOrdinanceText,
  getParcelsInFloodZone,
  listAvailableLayers,
  getMunicipalitySummary,
} from '../tools/handlers'

export async function executeTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'search_parcels':           return searchParcels(args)
    case 'get_flood_zone_summary':   return getFloodZoneSummary(args)
    case 'list_zoning_districts':    return listZoningDistricts(args)
    case 'get_permitted_uses':       return getPermittedUses(args)
    case 'get_development_standards':return getDevelopmentStandards(args)
    case 'compare_districts':        return compareDistricts(args)
    case 'search_ordinance_text':    return searchOrdinanceText(args)
    case 'get_parcels_in_flood_zone':return getParcelsInFloodZone(args)
    case 'list_available_layers':    return listAvailableLayers(args)
    case 'get_municipality_summary': return getMunicipalitySummary(args)
    default: return { error: `Unknown tool: ${name}` }
  }
}
