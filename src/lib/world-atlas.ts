import { geoArea } from 'd3-geo'
import { feature, mesh } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from 'geojson'

const ATLAS_NAMES: Record<string, string> = {
  'United States': 'United States of America',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
  'North Macedonia': 'Macedonia',
  'Czech Republic': 'Czechia',
}

export type CountryFeature = Feature<Polygon | MultiPolygon, { name: string }>

export type Atlas = {
  land: Feature | FeatureCollection
  borders: MultiLineString
  countries: Map<string, CountryFeature>
}

export function atlasFromTopology(topology: Topology): Atlas {
  const countries = topology.objects.countries as GeometryCollection<{ name: string }>
  const collection = feature(topology, countries) as FeatureCollection<
    Polygon | MultiPolygon,
    { name: string }
  >
  return {
    land: feature(topology, topology.objects.land),
    borders: mesh(topology, countries, (a, b) => a !== b),
    countries: new Map(collection.features.map(country => [country.properties.name, country])),
  }
}

export async function loadAtlas(): Promise<Atlas> {
  const { default: topology } = await import('world-atlas/countries-50m.json')
  return atlasFromTopology(topology as unknown as Topology)
}

export function atlasCountry(atlas: Atlas, name: string | null): CountryFeature | undefined {
  return name ? atlas.countries.get(ATLAS_NAMES[name] ?? name) : undefined
}

export function mainland(country: CountryFeature): Polygon {
  const { geometry } = country
  if (geometry.type === 'Polygon') return geometry
  const polygons = geometry.coordinates.map(
    coordinates => ({ type: 'Polygon', coordinates }) as Polygon
  )
  return polygons.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a))
}
