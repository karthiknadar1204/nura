import { createHash } from 'crypto'

// FieldMapping: normalized key → raw source field name
// Stored in data_layers.field_mapping as JSONB so it's county-specific and
// can be updated without code changes when a county renames fields.
export type FieldMapping = Record<string, string>

export interface NormalizedParcel {
  pin:              string
  address:          string | null
  ownerName:        string | null
  ownerAddress:     string | null
  legalDescription: string | null
  landUseCode:      string | null
  zoningCode:       string | null
  assessedValue:    string | null
  landValue:        string | null
  buildingValue:    string | null
  lotAreaSqft:      string | null
  buildingSqft:     string | null
  yearBuilt:        number | null
  ownershipType:    'individual' | 'corporate' | 'trust' | 'government' | null
  geometryGeoJson:  string | null  // GeoJSON string for ST_GeomFromGeoJSON()
  rawAttributes:    Record<string, unknown>
  dataHash:         string          // MD5 of sorted rawAttributes — delta detection
}

// ── Default field mappings ────────────────────────────────────────────────────
// These are our best guess before discovery confirms actual field names.
// Discovery overwrites data_layers.field_mapping with verified fields.

export const DUPAGE_FIELD_MAPPING: FieldMapping = {
  pin:              'PIN',
  // Address is split across multiple fields in DuPage — assembled in normalizeFeature
  addressStNum:     'PROPSTNUM',
  addressDir:       'PROPSTDIR',
  addressStreet:    'PROPSTNAME',
  addressApt:       'PROPAPT',
  addressCity:      'PROPCITY',
  addressZip:       'PROPZIP',
  ownerName:        'PROPNAME',
  ownerAddress:     'BILLADDRL1',
  ownerAddress2:    'BILLADDRL2',
  // Assessment fields — DuPage uses FCVTOTAL/FCVLAND/FCVIMP, lot in ACREAGE
  legalDescription: 'LEGALDES1',
  landUseCode:      'PROPCLASS',
  zoningCode:       'ZONING_CLASS',
  assessedValue:    'FCVTOTAL',
  landValue:        'FCVLAND',
  buildingValue:    'FCVIMP',
  lotAreaSqft:      'ACREAGE',   // acres — converted to sqft in normalizeFeature
  buildingSqft:     'BLDG_SQFT', // not present in this layer; stays null
  yearBuilt:        'YR_BUILT',  // not present in this layer; stays null
}

export const COOK_FIELD_MAPPING: FieldMapping = {
  pin:              'PIN',
  address:          'PROPERTY_ADDR',
  ownerName:        'TAXPAYER_NAME',
  ownerAddress:     'TAXPAYER_ADDR',
  legalDescription: 'LEGAL_DESC',
  landUseCode:      'LANDUSE_DESC',
  zoningCode:       'ZONING',
  assessedValue:    'ASSESSED_VALUE',
  landValue:        'LAND_VALUE',
  buildingValue:    'BUILDING_VALUE',
  lotAreaSqft:      'LOT_SIZE',
  buildingSqft:     'BUILDING_SQFT',
  yearBuilt:        'YEAR_BUILT',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pick(attrs: Record<string, unknown>, field: string | undefined): string | null {
  if (!field) return null
  const val = attrs[field]
  if (val === null || val === undefined || val === '') return null
  return String(val).trim() || null
}

function classifyOwnership(name: string | null): NormalizedParcel['ownershipType'] {
  if (!name) return null
  const u = name.toUpperCase()
  if (/\b(CITY|VILLAGE|TOWN|COUNTY|STATE|UNITED STATES|SCHOOL|DISTRICT|BOARD|PARK DISTRICT|TOWNSHIP)\b/.test(u)) {
    return 'government'
  }
  if (/\b(TRUST|TR\b|LAND TRUST|LIVING TRUST|REVOCABLE)\b/.test(u)) {
    return 'trust'
  }
  if (/\b(LLC|INC|CORP|LTD|LP\b|LLP|COMPANY|CO\.|ASSOCIATION|BANK|CREDIT UNION|REALTY|PROPERTIES|HOLDINGS|VENTURES|PARTNERS|INVESTMENTS|ENTERPRISES)\b/.test(u)) {
    return 'corporate'
  }
  return 'individual'
}

export function arcgisGeometryToGeoJson(geometry: any): string | null {
  if (!geometry) return null
  if (geometry.rings) {
    return JSON.stringify({ type: 'Polygon', coordinates: geometry.rings })
  }
  if (geometry.x !== undefined && geometry.y !== undefined) {
    return JSON.stringify({ type: 'Point', coordinates: [geometry.x, geometry.y] })
  }
  if (geometry.paths) {
    return JSON.stringify({ type: 'MultiLineString', coordinates: geometry.paths })
  }
  return null
}

function hashAttributes(attrs: Record<string, unknown>): string {
  const sorted = Object.keys(attrs)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => { acc[k] = attrs[k]; return acc }, {})
  return createHash('md5').update(JSON.stringify(sorted)).digest('hex')
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Normalizes one raw ArcGIS feature into a parcel row.
 * Returns null if the feature has no PIN (unidentifiable parcel — skip).
 */
export function normalizeFeature(
  attributes: Record<string, unknown>,
  geometry: any,
  fieldMapping: FieldMapping,
): NormalizedParcel | null {
  const pin = pick(attributes, fieldMapping['pin'])
  if (!pin) return null

  const name1 = pick(attributes, fieldMapping['ownerName'])
  const name2 = pick(attributes, fieldMapping['ownerName2'])
  const ownerName = [name1, name2].filter(Boolean).join(' ').trim() || null

  // Address: try single field first, then assemble from parts
  let address = pick(attributes, fieldMapping['address'])
  if (!address) {
    const streetPart = [
      pick(attributes, fieldMapping['addressStNum']),
      pick(attributes, fieldMapping['addressDir']),
      pick(attributes, fieldMapping['addressStreet']),
      pick(attributes, fieldMapping['addressApt']),
    ].filter(Boolean).join(' ')
    const cityPart = [
      pick(attributes, fieldMapping['addressCity']),
      pick(attributes, fieldMapping['addressZip']),
    ].filter(Boolean).join(' ')
    const full = [streetPart, cityPart].filter(Boolean).join(', ')
    address = full || null
  }

  // Owner address: try single field, then combine two lines
  const ownerAddr1 = pick(attributes, fieldMapping['ownerAddress'])
  const ownerAddr2 = pick(attributes, fieldMapping['ownerAddress2'])
  const ownerAddress = [ownerAddr1, ownerAddr2].filter(Boolean).join(', ') || null

  return {
    pin,
    address,
    ownerName,
    ownerAddress,
    legalDescription: pick(attributes, fieldMapping['legalDescription']),
    landUseCode:      pick(attributes, fieldMapping['landUseCode']),
    zoningCode:       pick(attributes, fieldMapping['zoningCode']),
    assessedValue:    pick(attributes, fieldMapping['assessedValue']),
    landValue:        pick(attributes, fieldMapping['landValue']),
    buildingValue:    pick(attributes, fieldMapping['buildingValue']),
    lotAreaSqft:      (() => {
      const raw = pick(attributes, fieldMapping['lotAreaSqft'])
      if (!raw) return null
      const n = parseFloat(raw)
      if (isNaN(n)) return null
      // DuPage stores lot size in acres (ACREAGE field) — convert to sqft
      const isAcres = fieldMapping['lotAreaSqft'] === 'ACREAGE'
      return String(isAcres ? Math.round(n * 43560) : n)
    })(),
    buildingSqft:     pick(attributes, fieldMapping['buildingSqft']),
    yearBuilt:        (() => {
      const y = pick(attributes, fieldMapping['yearBuilt'])
      if (!y) return null
      const n = parseInt(y, 10)
      return isNaN(n) || n < 1600 || n > 2100 ? null : n
    })(),
    ownershipType:    classifyOwnership(ownerName),
    geometryGeoJson:  arcgisGeometryToGeoJson(geometry),
    rawAttributes:    attributes,
    dataHash:         hashAttributes(attributes),
  }
}
