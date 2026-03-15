import { db } from './client'
import { counties, municipalities } from './schema'

const COUNTIES = [
  {
    id: 'dupage',
    name: 'DuPage County',
    state: 'IL',
    fips: '17043',
    gisBaseUrl: 'https://gis.dupageco.org/arcgis/rest/services',
    portalType: 'arcgis',
    metadata: {
      openDataPortal: 'https://gisdata-dupage.opendata.arcgis.com',
      dcatFeedUrl: 'https://gisdata-dupage.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
      parcelServiceUrl: 'https://gis.dupageco.org/arcgis/rest/services/Parcel/MapServer/0',
    },
  },
  {
    id: 'cook',
    name: 'Cook County',
    state: 'IL',
    fips: '17031',
    gisBaseUrl: 'https://hub-cookcountyil.opendata.arcgis.com',
    portalType: 'socrata',
    metadata: {
      openDataPortal: 'https://hub-cookcountyil.opendata.arcgis.com',
      dcatFeedUrl: 'https://hub-cookcountyil.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
      socrataBaseUrl: 'https://datacatalog.cookcountyil.gov',
      note: 'gis12.cookcountyil.gov ArcGIS server times out — use Open Data Hub fallback',
    },
  },
]

// Key municipalities only — the spatial join step will fill municipality_id on
// parcels automatically using PostGIS. Add more rows as needed.
const MUNICIPALITIES = [
  // ── DuPage County ────────────────────────────────────────────────────────
  { id: 'wheaton',          countyId: 'dupage', name: 'Wheaton',          state: 'IL', zoningSource: 'pdf_direct', zoningUrl: 'https://www.wheaton.il.us/1461/Zoning-Ordinance' },
  { id: 'naperville',       countyId: 'dupage', name: 'Naperville',       state: 'IL', zoningSource: 'municode',   zoningUrl: 'https://library.municode.com/il/naperville' },
  { id: 'downers_grove',    countyId: 'dupage', name: 'Downers Grove',    state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'elmhurst',         countyId: 'dupage', name: 'Elmhurst',         state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'glen_ellyn',       countyId: 'dupage', name: 'Glen Ellyn',       state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'lisle',            countyId: 'dupage', name: 'Lisle',            state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'carol_stream',     countyId: 'dupage', name: 'Carol Stream',     state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'bloomingdale',     countyId: 'dupage', name: 'Bloomingdale',     state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'bartlett',         countyId: 'dupage', name: 'Bartlett',         state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'addison',          countyId: 'dupage', name: 'Addison',          state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'villa_park',       countyId: 'dupage', name: 'Villa Park',       state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'lombard',          countyId: 'dupage', name: 'Lombard',          state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'glendale_heights', countyId: 'dupage', name: 'Glendale Heights', state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'bolingbrook',      countyId: 'dupage', name: 'Bolingbrook',      state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'darien',           countyId: 'dupage', name: 'Darien',           state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'westmont',         countyId: 'dupage', name: 'Westmont',         state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'woodridge',        countyId: 'dupage', name: 'Woodridge',        state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'oak_brook',        countyId: 'dupage', name: 'Oak Brook',        state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'warrenville',      countyId: 'dupage', name: 'Warrenville',      state: 'IL', zoningSource: null,         zoningUrl: null },
  // ── Cook County ──────────────────────────────────────────────────────────
  { id: 'chicago',          countyId: 'cook',   name: 'Chicago',          state: 'IL', zoningSource: 'amlegal',    zoningUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-1' },
  { id: 'evanston',         countyId: 'cook',   name: 'Evanston',         state: 'IL', zoningSource: 'municode',   zoningUrl: 'https://library.municode.com/il/evanston' },
  { id: 'oak_park',         countyId: 'cook',   name: 'Oak Park',         state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'cicero',           countyId: 'cook',   name: 'Cicero',           state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'berwyn',           countyId: 'cook',   name: 'Berwyn',           state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'skokie',           countyId: 'cook',   name: 'Skokie',           state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'des_plaines',      countyId: 'cook',   name: 'Des Plaines',      state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'palatine',         countyId: 'cook',   name: 'Palatine',         state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'schaumburg',       countyId: 'cook',   name: 'Schaumburg',       state: 'IL', zoningSource: null,         zoningUrl: null },
  { id: 'orland_park',      countyId: 'cook',   name: 'Orland Park',      state: 'IL', zoningSource: null,         zoningUrl: null },
]

async function seed() {
  console.log('Seeding counties...')
  await db.insert(counties).values(COUNTIES).onConflictDoNothing()

  console.log('Seeding municipalities...')
  await db.insert(municipalities).values(MUNICIPALITIES).onConflictDoNothing()

  console.log('Seed complete.')
}

seed().catch(console.error).finally(() => process.exit(0))
