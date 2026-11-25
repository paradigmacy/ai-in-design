// The shortest walking route through streets.graph.json, using each edge's length in metres.
import { toMetres } from './geo.js'

// The junction (node) closest to a point, and how far away it is in metres.
export function nearestNode(graph, lonLat) {
  const [px, py] = toMetres(lonLat)
  let best = null
  let bestD = Infinity
  for (const n of graph.nodes) {
    const [x, y] = toMetres([n.lon, n.lat])
    const d = Math.hypot(x - px, y - py)
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return { node: best, distance: bestD }
}

// Dijkstra's shortest path from node id `from` to node id `to`, along walkable edges.
// Returns the total length in metres and the line as [lon, lat] points, or null if there is no route.
export function shortestRoute(graph, from, to) {
  const links = new Map() // node id -> edges touching it
  for (const e of graph.edges) {
    if (!e.walkable) continue
    for (const id of [e.from, e.to]) {
      if (!links.has(id)) links.set(id, [])
      links.get(id).push(e)
    }
  }

  const dist = new Map([[from, 0]])
  const via = new Map() // node id -> the edge we arrived by
  const done = new Set()
  const queue = [[0, from]] // small priority queue, kept sorted; plenty for ~1000 junctions

  while (queue.length) {
    const [d, id] = queue.shift()
    if (done.has(id)) continue
    done.add(id)
    if (id === to) break
    for (const e of links.get(id) ?? []) {
      const next = e.from === id ? e.to : e.from
      const nd = d + e.length
      if (nd < (dist.get(next) ?? Infinity)) {
        dist.set(next, nd)
        via.set(next, e)
        let i = queue.findIndex(([qd]) => qd > nd)
        if (i < 0) i = queue.length
        queue.splice(i, 0, [nd, next])
      }
    }
  }
  if (!done.has(to)) return null

  // Walk back from the end to the start, collecting the edge lines in the right direction.
  const pieces = []
  let id = to
  while (id !== from) {
    const e = via.get(id)
    pieces.push(e.to === id ? e.coords : [...e.coords].reverse())
    id = e.to === id ? e.from : e.to
  }
  pieces.reverse()
  const line = [pieces[0][0]]
  for (const p of pieces) line.push(...p.slice(1))
  return { length: dist.get(to), line, edges: pieces.length }
}
