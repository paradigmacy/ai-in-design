// The 3D city: ground, streets, extruded buildings, the walking route and the two landmark labels.
import { memo, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Html, Line } from '@react-three/drei'
import { toMetres, toWorld, centre, distanceToPolyline, HALF_WIDTH_M, BAUHAUS, STATION } from './geo.js'

// A quiet palette, one colour per main use.
export const USE_COLOURS = {
  residential: '#e8d8b8',
  service: '#b9c7d6',
  office: '#8fa6bf',
  retail: '#e0a98c',
  food_and_drink: '#d98b7a',
  education: '#7fa98a',
  culture: '#a58fbf',
  civic: '#c2b27a',
  entertainment: '#cf9fb8',
  health: '#9cc4c0',
  accommodation: '#d6b77f',
  sport: '#a9c27f',
  transport: '#6f7f8f',
  light_industrial: '#a89a8a',
  undefined: '#cfccc6',
}

// Height in steps of 4 m, pale (low) to dark (tall). `below` is the upper limit of each step.
export const HEIGHT_STEPS = [
  { below: 4, label: 'under 4 m', colour: '#f4e9cf' },
  { below: 8, label: '4–8 m', colour: '#ecc99a' },
  { below: 12, label: '8–12 m', colour: '#dfa26c' },
  { below: 16, label: '12–16 m', colour: '#c8764a' },
  { below: 20, label: '16–20 m', colour: '#a24f36' },
  { below: Infinity, label: '20 m and over', colour: '#6e2f27' },
]

export const useOf = (f) => f.properties.use ?? 'undefined' // one building has no use; count it as undefined
export const heightStep = (f) => HEIGHT_STEPS.findIndex((s) => f.properties.height < s.below)

const colourBy = {
  use: (f) => USE_COLOURS[useOf(f)] ?? USE_COLOURS.undefined,
  height: (f) => HEIGHT_STEPS[heightStep(f)].colour,
}
const CONTEXT_COLOUR = '#9a8580' // smoky grey for buildings away from the route
const ROUTE_COLOUR = '#1f5fbf'

export function buildingGeometry(feature) {
  const rings = feature.geometry.coordinates.map((r) => r.map(toMetres))
  const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of rings.slice(1)) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))))
  const g = new THREE.ExtrudeGeometry(shape, { depth: feature.properties.height, bevelEnabled: false })
  g.rotateX(-Math.PI / 2) // stand the extrusion up: shape north becomes -z, height becomes +y
  return g
}

// Builds one merged mesh from many buildings, and remembers which triangles belong to which building.
function mergeBuildings(features) {
  const parts = []
  const ranges = [] // { first triangle, triangle count, building }
  let tri = 0
  for (const f of features) {
    const g = buildingGeometry(f).toNonIndexed()
    g.deleteAttribute('uv')
    const n = g.attributes.position.count / 3
    parts.push(g)
    ranges.push({ first: tri, count: n, feature: f })
    tri += n
  }
  const geometry = parts.length ? mergeGeometries(parts) : null
  parts.forEach((g) => g.dispose())
  if (geometry) {
    geometry.computeVertexNormals()
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tri * 9), 3))
  }
  return { geometry, ranges }
}

// Paints every building of a merged mesh with the colour `colourOf` gives it.
function paint({ geometry, ranges }, colourOf) {
  if (!geometry) return
  const attr = geometry.attributes.color
  const c = new THREE.Color()
  for (const r of ranges) {
    c.set(colourOf(r.feature))
    for (let v = r.first * 3; v < (r.first + r.count) * 3; v++) c.toArray(attr.array, v * 3)
  }
  attr.needsUpdate = true
}

function featureAtTriangle(ranges, face) {
  let lo = 0
  let hi = ranges.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ranges[mid].first <= face) lo = mid
    else hi = mid - 1
  }
  return ranges[lo].feature
}

// Splits the buildings into those near the route and the context around it.
export function splitBuildings(buildings, routeMetres) {
  const inside = []
  const outside = []
  for (const f of buildings.features) {
    const c = centre(f.geometry.coordinates[0].map(toMetres))
    ;(distanceToPolyline(c, routeMetres) <= HALF_WIDTH_M ? inside : outside).push(f)
  }
  return { inside, outside }
}

function Landmark({ lonLat, title, note }) {
  const height = 45
  return (
    <group position={toWorld(toMetres(lonLat))}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.6, 0.6, height, 8]} />
        <meshBasicMaterial color="#c0392b" />
      </mesh>
      <Html position={[0, height, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="landmark">
          <strong>{title}</strong>
          <span>{note}</span>
        </div>
      </Html>
    </group>
  )
}

// `memo`: the city is only rebuilt when its own inputs change, not every time the lava rises.
export default memo(function City({ kit, streets, inside, outside, route, colourMode, onSelect }) {
  const strip = useMemo(() => mergeBuildings(inside), [inside])
  const context = useMemo(() => mergeBuildings(outside), [outside])

  useEffect(() => paint(context, () => CONTEXT_COLOUR), [context])
  useEffect(() => paint(strip, colourBy[colourMode]), [strip, colourMode])

  const streetGeometry = useMemo(() => {
    const pts = []
    for (const f of streets.features) {
      const c = f.geometry.coordinates.map(toMetres)
      for (let i = 0; i < c.length - 1; i++) pts.push(...toWorld(c[i], 0.15), ...toWorld(c[i + 1], 0.15))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [streets])

  // The route line, lifted a little above the streets, and the short links from each building to the network.
  const routePoints = useMemo(() => route.line.map((p) => toWorld(toMetres(p), 0.8)), [route])
  const startLink = [toWorld(toMetres(BAUHAUS), 0.8), routePoints[0]]
  const endLink = [routePoints[routePoints.length - 1], toWorld(toMetres(STATION), 0.8)]

  const [w, s, e, n] = kit.bbox
  const [x0, y0] = toMetres([w, s])
  const [x1, y1] = toMetres([e, n])

  const pick = (ranges, nearRoute) => (ev) => {
    ev.stopPropagation()
    onSelect(featureAtTriangle(ranges, ev.faceIndex), nearRoute)
  }

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[-600, 900, 400]} intensity={1.6} />
      <hemisphereLight args={['#ffffff', '#5a2418', 0.4]} />

      {/* Pale ground the size of the kit; clicking it clears the selection */}
      <mesh rotation-x={-Math.PI / 2} position={[(x0 + x1) / 2, 0, -(y0 + y1) / 2]} onClick={() => onSelect(null)}>
        <planeGeometry args={[x1 - x0, y1 - y0]} />
        <meshBasicMaterial color="#45170f" /> {/* dark volcanic rock */}
      </mesh>

      <lineSegments geometry={streetGeometry}>
        <lineBasicMaterial color="#9a4a2c" />
      </lineSegments>

      <Line points={routePoints} color={ROUTE_COLOUR} lineWidth={4} />
      <Line points={startLink} color={ROUTE_COLOUR} lineWidth={2} dashed dashSize={3} gapSize={2} />
      <Line points={endLink} color={ROUTE_COLOUR} lineWidth={2} dashed dashSize={3} gapSize={2} />

      {context.geometry && (
        <mesh geometry={context.geometry} onClick={pick(context.ranges, false)}>
          <meshLambertMaterial vertexColors transparent opacity={0.7} />
        </mesh>
      )}
      {strip.geometry && (
        <mesh geometry={strip.geometry} onClick={pick(strip.ranges, true)}>
          <meshLambertMaterial vertexColors />
        </mesh>
      )}
      <Landmark lonLat={BAUHAUS} title="Bauhaus-Universität" note="main building" />
      <Landmark lonLat={STATION} title="Weimar Hbf" note="station" />
    </>
  )
})

// --- game highlights: your roof, the taller roofs in jump reach, and the escape path ---

const HIGHLIGHT = { selected: '#2b2b2b', target: '#17a398', path: '#f2b705' }

// Each building's 3D shape is made once and reused whenever it is highlighted again.
const shapes = new WeakMap()
function cachedGeometry(feature) {
  if (!shapes.has(feature)) shapes.set(feature, buildingGeometry(feature))
  return shapes.get(feature)
}

function Highlight({ feature, colour }) {
  if (feature.properties.mine) return null // my block is the glb model; no extruded box on top of it
  return (
    <mesh geometry={cachedGeometry(feature)}>
      <meshLambertMaterial color={colour} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  )
}

// A little hop from roof to roof: an arc that rises 4 m above the higher of the two roofs.
function hopPoints(a, b) {
  const [ax, ay] = centre(a.geometry.coordinates[0].map(toMetres))
  const [bx, by] = centre(b.geometry.coordinates[0].map(toMetres))
  const ha = a.properties.height
  const hb = b.properties.height
  const top = Math.max(ha, hb) + 4
  const pts = []
  for (let i = 0; i <= 16; i++) {
    const t = i / 16
    // A curve through the start roof, the top of the hop and the landing roof.
    const h = (1 - t) * (1 - t) * ha + 2 * t * (1 - t) * (2 * top - (ha + hb) / 2) + t * t * hb
    pts.push(toWorld([ax + (bx - ax) * t, ay + (by - ay) * t], h + 0.3))
  }
  return pts
}

// `selected`: the building you stand on; `targets` and `path`: lists of buildings.
export function Highlights({ selected, targets, path }) {
  const hops = useMemo(() => path.slice(1).map((b, i) => hopPoints(path[i], b)), [path])
  const onPath = new Set(path)
  return (
    <>
      {targets
        .filter((f) => !onPath.has(f))
        .map((f) => (
          <Highlight key={`t${f.properties.id}`} feature={f} colour={HIGHLIGHT.target} />
        ))}
      {path.slice(1).map((f) => (
        <Highlight key={`p${f.properties.id}`} feature={f} colour={HIGHLIGHT.path} />
      ))}
      {selected && <Highlight feature={selected} colour={HIGHLIGHT.selected} />}
      {hops.map((pts, i) => (
        <Line key={i} points={pts} color={HIGHLIGHT.path} lineWidth={3} />
      ))}
    </>
  )
}

export { HIGHLIGHT }
