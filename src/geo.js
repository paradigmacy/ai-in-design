// Turning longitude/latitude into metres, and measuring distances to the walking route.

// The two ends of the walk, as [longitude, latitude].
// Bauhaus: centre of the main building (buildings 15399 and 18208 in buildings.geojson).
// Station: centre of the station hall (building 22132, use "transport", at the north edge of the kit).
export const BAUHAUS = [11.32935, 50.97428]
export const STATION = [11.32632, 50.99122]

// Buildings within this many metres of the walking route are shown in colour.
export const HALF_WIDTH_M = 250

// Walking speed, 4.8 km/h.
export const WALK_M_PER_MIN = 80

// The projection: metres east and north of the kit centre. Good to well under 1 % over 2 km.
const ORIGIN = [11.324797, 50.982663]
const M_PER_DEG_LAT = 111_132
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN[1] * Math.PI) / 180)

export function toMetres([lon, lat]) {
  return [(lon - ORIGIN[0]) * M_PER_DEG_LON, (lat - ORIGIN[1]) * M_PER_DEG_LAT]
}

// Metres east/north to the 3D world: x = east, y = up, z = south.
export const toWorld = ([x, y], up = 0) => [x, up, -y]

// Shortest distance in metres from a point to a line made of points (all in metres).
export function distanceToPolyline([px, py], pts) {
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[i + 1]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
  }
  return best
}

// Centre of a ring of points in metres (the average of its corners is close enough here).
export function centre(ring) {
  let x = 0
  let y = 0
  for (const p of ring) {
    x += p[0]
    y += p[1]
  }
  return [x / ring.length, y / ring.length]
}
