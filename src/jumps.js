// The "floor is lava" rules: which roofs you can jump between, your odds, and the best escape path.
import { toMetres } from './geo.js'

export const JUMP_GAP_M = 4 // the widest gap between two footprints you can jump, edge to edge
export const CLIMB_M = 3 // you can land at most this much higher (about one floor); dropping down has no limit
export const LAVA_MAX_M = 37 // just above the tallest roof in the kit (36 m); the secret stop height lies below this

// The chance the lava stops below a roof of height h, given it has reached `lava` and is still rising.
// The stop height is picked evenly between 0 and LAVA_MAX_M at the start of each game.
export function survivalOdds(h, lava) {
  if (h <= lava) return 0
  return Math.min(1, (h - lava) / (LAVA_MAX_M - lava))
}

// --- distances between footprints, in metres ---

function pointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = side(c, d, a)
  const d2 = side(c, d, b)
  const d3 = side(a, b, c)
  const d4 = side(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function inside([x, y], ring) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

// Edge-to-edge distance between two outlines; 0 when they touch, cross or one sits inside the other.
function ringGap(r1, r2) {
  if (inside(r1[0], r2) || inside(r2[0], r1)) return 0
  let best = Infinity
  for (let i = 0; i < r1.length - 1; i++) {
    const a = r1[i]
    const b = r1[i + 1]
    for (let j = 0; j < r2.length - 1; j++) {
      const c = r2[j]
      const d = r2[j + 1]
      if (segmentsCross(a, b, c, d)) return 0
      best = Math.min(
        best,
        pointToSegment(a[0], a[1], c[0], c[1], d[0], d[1]),
        pointToSegment(b[0], b[1], c[0], c[1], d[0], d[1]),
        pointToSegment(c[0], c[1], a[0], a[1], b[0], b[1]),
        pointToSegment(d[0], d[1], a[0], a[1], b[0], b[1]),
      )
    }
  }
  return best
}

// --- the jump network ---

// For every building, the buildings whose footprint is within JUMP_GAP_M. Computed once.
// Returns { features, heights, neighbours: [[{ j, gap }]], index: Map(feature -> number) }.
export function buildJumpNetwork(features) {
  const CELL = 20
  const rings = features.map((f) => f.geometry.coordinates[0].map(toMetres))
  const boxes = rings.map((r) => {
    const xs = r.map((p) => p[0])
    const ys = r.map((p) => p[1])
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  })

  // Put each building into every 20 m grid square its box (grown by the jump gap) touches.
  const grid = new Map()
  boxes.forEach(([x0, y0, x1, y1], i) => {
    for (let gx = Math.floor((x0 - JUMP_GAP_M) / CELL); gx <= Math.floor((x1 + JUMP_GAP_M) / CELL); gx++)
      for (let gy = Math.floor((y0 - JUMP_GAP_M) / CELL); gy <= Math.floor((y1 + JUMP_GAP_M) / CELL); gy++) {
        const key = `${gx},${gy}`
        if (!grid.has(key)) grid.set(key, [])
        grid.get(key).push(i)
      }
  })

  const neighbours = features.map(() => [])
  const checked = new Set()
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const i = Math.min(list[a], list[b])
        const j = Math.max(list[a], list[b])
        const key = i * 100000 + j
        if (checked.has(key)) continue
        checked.add(key)
        const [ax0, ay0, ax1, ay1] = boxes[i]
        const [bx0, by0, bx1, by1] = boxes[j]
        const boxGap = Math.max(bx0 - ax1, ax0 - bx1, by0 - ay1, ay0 - by1, 0)
        if (boxGap > JUMP_GAP_M) continue
        const gap = ringGap(rings[i], rings[j])
        if (gap <= JUMP_GAP_M) {
          neighbours[i].push({ j, gap })
          neighbours[j].push({ j: i, gap })
        }
      }
  }

  return {
    features,
    heights: features.map((f) => f.properties.height),
    neighbours,
    index: new Map(features.map((f, i) => [f, i])),
  }
}

// Can you jump from building i to building j while the lava is at `lava`?
export function canJump(net, i, j, lava) {
  const hj = net.heights[j]
  return hj > lava && hj <= net.heights[i] + CLIMB_M
}

// Roofs you can jump to right now that are taller than the one you stand on.
export function tallerJumps(net, i, lava) {
  if (net.heights[i] <= lava) return []
  return net.neighbours[i].filter(({ j }) => canJump(net, i, j, lava) && net.heights[j] > net.heights[i]).map(({ j }) => j)
}

// The highest roof you can reach from building i by jumping, with the fewest jumps.
// Returns the list of building numbers from i to that roof, or null if i is already under the lava.
export function escapePath(net, start, lava) {
  if (net.heights[start] <= lava) return null
  const from = new Map([[start, -1]])
  const queue = [start]
  let best = start
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    // Breadth-first: the first time we see a height, it is with the fewest jumps.
    if (net.heights[i] > net.heights[best]) best = i
    for (const { j } of net.neighbours[i]) {
      if (from.has(j) || !canJump(net, i, j, lava)) continue
      from.set(j, i)
      queue.push(j)
    }
  }
  const path = []
  for (let i = best; i !== -1; i = from.get(i)) path.push(i)
  return path.reverse()
}
