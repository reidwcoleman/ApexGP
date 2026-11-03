// The starting cities: real street plans from OpenStreetMap, baked by tools/mogul_osm.mjs into public/mogul/<id>.json.
// Plain data only (the bake script imports this file straight from Node).
export interface CityDef {
  id: string;
  name: string;
  area: string;
  bbox: [number, number, number, number]; // south, west, north, east
  defaultH: number; // metres, for buildings OSM gives no height
  land: number; // $ per m² of floor, the property market's level
  crowd: number; // foot traffic multiplier
  sky: string; // the city's palette accent
}

export const CITIES: CityDef[] = [
  { id: 'nyc', name: 'New York', area: 'Midtown Manhattan', bbox: [40.7525, -73.9928, 40.7635, -73.9783], defaultH: 38, land: 1.0, crowd: 1.25, sky: '#ffb24a' },
  { id: 'london', name: 'London', area: 'Soho & Covent Garden', bbox: [51.507, -0.1397, 51.518, -0.1224], defaultH: 18, land: 0.95, crowd: 1.1, sky: '#9fb8ff' },
  { id: 'paris', name: 'Paris', area: 'Opéra & Grands Boulevards', bbox: [48.8655, 2.3288, 48.8765, 2.3452], defaultH: 21, land: 0.85, crowd: 1.0, sky: '#ff9ec4' },
  { id: 'tokyo', name: 'Tokyo', area: 'Shibuya', bbox: [35.654, 139.6938, 35.665, 139.7072], defaultH: 26, land: 0.9, crowd: 1.35, sky: '#ff6f91' },
  { id: 'sf', name: 'San Francisco', area: 'Union Square', bbox: [37.7825, -122.4143, 37.7935, -122.4007], defaultH: 24, land: 0.8, crowd: 0.95, sky: '#7fe0c4' },
];
