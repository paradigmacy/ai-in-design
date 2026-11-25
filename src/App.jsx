// The page: loads the city kit, finds the walking route, runs the lava game, and shows the 3D map with its controls.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import City, { USE_COLOURS, HEIGHT_STEPS, HIGHLIGHT, Highlights, splitBuildings, useOf, heightStep } from './City.jsx'
import CameraRig from './CameraRig.jsx'
import Block, { MY_BLOCK, isMine } from './Block.jsx'
import { useVolcano, VolcanoEffects, VolcanoPanel, VolcanoSays } from './Volcano.jsx'
import Lava, { LAVA_M_PER_S } from './Lava.jsx'
import { BAUHAUS, STATION, HALF_WIDTH_M, WALK_M_PER_MIN, toMetres, toWorld } from './geo.js'
import { nearestNode, shortestRoute } from './route.js'
import {
  buildJumpNetwork,
  escapePath,
  tallerJumps,
  survivalOdds,
  JUMP_GAP_M,
  CLIMB_M,
  LAVA_MAX_M,
} from './jumps.js'

const FILES = ['kit.json', 'buildings.geojson', 'streets.geojson', 'streets.graph.json']
const SPEEDS = [1, 2, 5]
export const VOLCANO_SKY = '#2b0f0c' // dark basalt red behind the model

const label = (use) => use.replaceAll('_', ' ')
const metres = (m) => `${Math.round(m).toLocaleString('en')} m`
const percent = (p) => `${Math.round(p * 100)} %`
const newStopHeight = () => Math.random() * LAVA_MAX_M // the secret: where the lava will stop this game

// The four camera views, worked out from the route. World axes: x = east, y = up, z = south.
function cameraViews(routeMetres) {
  const xs = routeMetres.map((p) => p[0])
  const ys = routeMetres.map((p) => p[1])
  const mid = toWorld([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2])
  const span = Math.max(Math.max(...ys) - Math.min(...ys), Math.max(...xs) - Math.min(...xs)) + 2 * HALF_WIDTH_M
  const close = (lonLat) => {
    const t = toWorld(toMetres(lonLat))
    return { target: t, pos: [t[0] + 170, 150, t[2] + 220] } // from the south-east, a little above the roofs
  }
  return {
    whole: { target: mid, pos: [mid[0] + 0.45 * span, 0.55 * span, mid[2] + 0.55 * span] },
    bauhaus: close(BAUHAUS),
    station: close(STATION),
    plan: { target: mid, pos: [mid[0], 1.25 * span, mid[2] + 1] }, // straight down, north at the top
    block: { target: [168, 8, -297], pos: [298, 90, -137] }, // my Session 2 block, from the south-east
  }
}

const VIEW_BUTTONS = [
  ['whole', 'Whole area'],
  ['bauhaus', 'Bauhaus'],
  ['station', 'Station'],
  ['plan', 'Plan'],
  ['block', 'My block'],
]

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [colourMode, setColourMode] = useState('use')
  const [view, setView] = useState({ name: 'whole', n: 0 })

  // The lava game. The ref is read and moved every frame by <Lava>; `lava` is a copy for the panel, 10 times a second.
  const game = useRef({ lava: 0, playing: false, speed: 1, stopAt: newStopHeight() })
  const [lava, setLava] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [stoppedAt, setStoppedAt] = useState(null)

  useEffect(() => {
    Promise.all(
      FILES.map((name) =>
        fetch(`${import.meta.env.BASE_URL}data/${name}`).then((r) => {
          if (!r.ok) throw new Error(`data/${name}: ${r.status}`)
          return r.json()
        }),
      ),
    )
      .then(([kit, buildings, streets, graph]) =>
        setData({ kit, buildings: { ...buildings, features: [...buildings.features, MY_BLOCK] }, streets, graph }),
      )
      .catch((e) => setError(e.message))
  }, [])

  // The route, the buildings along it, the camera views, the counts for the legend, and the jump network.
  const model = useMemo(() => {
    if (!data) return null
    const start = nearestNode(data.graph, BAUHAUS)
    const end = nearestNode(data.graph, STATION)
    const route = shortestRoute(data.graph, start.node.id, end.node.id)
    if (!route) return { error: 'The street network has no route between the Bauhaus and the station.' }
    const routeMetres = route.line.map(toMetres)
    // My block is drawn by <Block> from block.glb, so the city leaves it out; it still counts for the jumps.
    const { inside, outside } = splitBuildings({ ...data.buildings, features: data.buildings.features.filter((f) => !isMine(f)) }, routeMetres)
    const byUse = {}
    const byHeight = HEIGHT_STEPS.map(() => 0)
    for (const f of inside) {
      byUse[useOf(f)] = (byUse[useOf(f)] ?? 0) + 1
      byHeight[heightStep(f)]++
    }
    const jumps = buildJumpNetwork(data.buildings.features)
    return { start, end, route, inside, outside, byUse, byHeight, jumps, views: cameraViews(routeMetres) }
  }, [data])

  // Where you can go from the roof you stand on, at the current lava height.
  const net = model?.jumps
  const here = selected && net ? net.index.get(selected.feature) : null
  const targetIds = here == null ? [] : tallerJumps(net, here, lava)
  const pathIds = here == null ? [] : (escapePath(net, here, lava) ?? [])
  // Only hand new lists to the 3D view when they really change, not on every lava tick.
  const targetKey = targetIds.join(',')
  const pathKey = pathIds.join(',')
  const targets = useMemo(() => targetIds.map((i) => net.features[i]), [net, targetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const path = useMemo(() => pathIds.map((i) => net.features[i]), [net, pathKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Heights are a secret until you pick a roof: the Height colours stay locked until then,
  // and switch on by themselves the moment your first roof (and its odds) is revealed.
  const hadRoof = useRef(false)
  useEffect(() => {
    if (selected && !hadRoof.current) setColourMode('height')
    hadRoof.current = !!selected
  }, [selected])
  const shownMode = colourMode === 'height' && !selected ? 'use' : colourMode

  const onSelect = useCallback((feature, nearRoute) => setSelected(feature ? { feature, nearRoute } : null), [])
  const onTick = useCallback((l) => setLava(l), [])
  const onStop = useCallback((l) => {
    setLava(Math.round(l * 10) / 10)
    setPlaying(false)
    setStoppedAt(l)
  }, [])
  const clearSelection = useCallback(() => setSelected(null), [])

  // The volcano that thinks: watches the game, asks Claude (only on this laptop) and acts.
  const volcano = useVolcano({ game, playing, stoppedAt, selected, targets, path })

  const play = () => {
    game.current.playing = !playing
    setPlaying(!playing)
  }
  const changeSpeed = (s) => {
    game.current.speed = s
    setSpeed(s)
  }
  const newGame = () => {
    Object.assign(game.current, { lava: 0, playing: false, stopAt: newStopHeight() })
    setLava(0)
    setPlaying(false)
    setStoppedAt(null)
    setSelected(null) // hides the heights again
    volcano.reset()
  }

  if (error) return <p className="message error">The city kit didn't load ({error}).</p>
  if (!model) return <p className="message">Loading the city kit…</p>
  if (model.error) return <p className="message error">{model.error}</p>

  const { route, views } = model
  const legend =
    shownMode === 'use'
      ? Object.keys(USE_COLOURS)
          .filter((u) => model.byUse[u])
          .map((u) => ({ key: u, colour: USE_COLOURS[u], name: label(u), count: model.byUse[u] }))
      : HEIGHT_STEPS.map((s, i) => ({ key: s.label, colour: s.colour, name: s.label, count: model.byHeight[i] }))

  return (
    <div className="app">
      <Canvas camera={{ position: views.whole.pos, fov: 40, near: 1, far: 20000 }}>
        <color attach="background" args={[VOLCANO_SKY]} />
        <City
          kit={data.kit}
          streets={data.streets}
          inside={model.inside}
          outside={model.outside}
          route={route}
          colourMode={shownMode}
          onSelect={onSelect}
        />
        <Highlights selected={selected?.feature} targets={targets} path={path} />
        <Suspense fallback={null}>
          <Block onSelect={onSelect} />
        </Suspense>
        <Lava kit={data.kit} game={game} onTick={onTick} onStop={onStop} onClick={clearSelection} />
        <VolcanoEffects game={game} />
        <OrbitControls target={views.whole.target} maxPolarAngle={Math.PI / 2.1} makeDefault />
        <CameraRig views={views} view={view} />
      </Canvas>
      <VolcanoSays volcano={volcano} />

      <aside className="panel">
        <section className="lava-tab">
        <h1>
          <span aria-hidden="true">🔥</span> <span className="fire-text">Floor is lava</span>
        </h1>

        <div className="lava-counter">
          <span className="lava-swatch" />
          <div>
            Lava <strong>{lava.toFixed(1)} m</strong>
            <span className="muted"> · rising {LAVA_M_PER_S * speed} m/s</span>
          </div>
        </div>
        <div className="buttons">
          <button className={playing ? 'on' : ''} onClick={play} disabled={stoppedAt != null}>
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => changeSpeed(s)}>
              {s}×
            </button>
          ))}
          <button onClick={newGame}>↺ New game</button>
        </div>

        <VolcanoPanel volcano={volcano} />

        {stoppedAt != null && (
          <p className={`outcome ${selected && selected.feature.properties.height > stoppedAt ? 'safe' : 'caught'}`}>
            The lava stopped at {stoppedAt.toFixed(1)} m.{' '}
            {selected
              ? selected.feature.properties.height > stoppedAt
                ? `You survived on building ${selected.feature.properties.id}!`
                : 'The lava got you.'
              : 'Click a roof to see if it stayed dry.'}
          </p>
        )}

        {selected ? (
          <RoofInfo
            feature={selected.feature}
            lava={lava}
            speed={speed}
            stopped={stoppedAt != null}
            targets={targets.length}
            path={path}
          />
        ) : (
          <p className="note">Click a roof to stand on it. The lava stops at a secret height, somewhere between the ground and {LAVA_MAX_M} m.</p>
        )}

        <p className="note">
          Jumps: a gap of up to {JUMP_GAP_M} m between buildings, landing at most {CLIMB_M} m higher; you can drop down
          any height. Heights are the measured roof tops from the LoD2 models. Your odds are the chance the lava stops
          below your roof, if its stop height is equally likely anywhere from its current level to {LAVA_MAX_M} m.
        </p>
        </section>

        <h2 className="section">Bauhaus to station</h2>
        <div className="route">
          <span className="route-line" />
          <div>
            <strong>{metres(route.length)}</strong> shortest walk
            <br />
            about {Math.round(route.length / WALK_M_PER_MIN)} min at 4.8 km/h
          </div>
        </div>
        <p className="note">
          Measured along the pedestrian network between the junctions nearest the main building (
          {metres(model.start.distance)} away) and the station hall ({metres(model.end.distance)} away), shown dashed.
        </p>

        <div className="group">
          <span className="group-label">Camera</span>
          <div className="buttons">
            {VIEW_BUTTONS.map(([key, text]) => (
              <button
                key={key}
                className={view.name === key ? 'on' : ''}
                onClick={() => setView((v) => ({ name: key, n: v.n + 1 }))}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        <div className="group">
          <span className="group-label">Colour by</span>
          <div className="buttons">
            {[
              ['use', 'Use'],
              ['height', 'Height'],
            ].map(([key, text]) => (
              <button
                key={key}
                className={shownMode === key ? 'on' : ''}
                onClick={() => setColourMode(key)}
                disabled={key === 'height' && !selected}
                title={key === 'height' && !selected ? 'Pick a roof first' : undefined}
              >
                {key === 'height' && !selected ? '🔒 Height' : text}
              </button>
            ))}
          </div>
        </div>

        <p className="lead">
          {model.inside.length} buildings within {HALF_WIDTH_M} m of the route,{' '}
          {shownMode === 'use' ? 'by the use with the largest floor area' : 'by height to the top of the roof'}. The
          rest of the kit is grey.
          {!selected && ' Heights stay hidden until you pick a roof.'}
        </p>
        <ul className="legend">
          {legend.map((row) => (
            <li key={row.key}>
              <span className="swatch" style={{ background: row.colour }} />
              <span className="name">{row.name}</span>
              <span className="count">{row.count}</span>
            </li>
          ))}
        </ul>
        <p className="hint">Drag to orbit · right-drag to pan · scroll to zoom · click a building</p>
      </aside>

      <footer className="credit">
        Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov,
        InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder
        (dl-de/by-2-0).
      </footer>
    </div>
  )
}

// The panel for the roof you stand on: odds, time left, jumps and escape path, then the building's data.
function RoofInfo({ feature, lava, speed, stopped, targets, path }) {
  const p = feature.properties
  const odds = stopped ? (p.height > lava ? 1 : 0) : survivalOdds(p.height, lava)
  const drowned = p.height <= lava
  const best = path[path.length - 1]
  const bestOdds = best && (stopped ? 1 : survivalOdds(best.properties.height, lava))
  const secondsLeft = (p.height - lava) / (LAVA_M_PER_S * speed)

  return (
    <div className="info">
      <h2>
        You're on building {p.id}, {p.height} m
      </h2>
      {drowned ? (
        <p className="outcome caught">This roof is already under the lava.</p>
      ) : (
        <>
          <div className="odds">
            <span>Odds of staying alive</span>
            <strong>{percent(odds)}</strong>
          </div>
          <div className="odds-bar">
            <span style={{ width: `${odds * 100}%` }} />
          </div>
          {!stopped && (
            <p className="muted small">
              {(p.height - lava).toFixed(1)} m above the lava; it reaches this roof in about {Math.round(secondsLeft)} s at{' '}
              {speed}× if it doesn't stop first.
            </p>
          )}
          <p className="small">
            <span className="dot" style={{ background: HIGHLIGHT.target }} /> {targets} taller{' '}
            {targets === 1 ? 'roof' : 'roofs'} you can jump to
          </p>
          <p className="small">
            <span className="dot" style={{ background: HIGHLIGHT.path }} />{' '}
            {path.length > 1
              ? `Escape: ${path.length - 1} ${path.length === 2 ? 'jump' : 'jumps'} to building ${best.properties.id}, ${best.properties.height} m — odds there ${percent(bestOdds)}. Follow the gold arcs.`
              : 'This is already the highest roof you can reach by jumping.'}
          </p>
        </>
      )}
      <dl>
        <dt>Main use</dt>
        <dd>{label(useOf(feature))}</dd>
        <dt>Floors</dt>
        <dd>{p.floors ?? '–'}</dd>
        {Object.entries(p.floor_area_m2 ?? {}).map(([u, a]) => (
          <FloorArea key={u} use={label(u)} area={a} />
        ))}
      </dl>
    </div>
  )
}

function FloorArea({ use, area }) {
  return (
    <>
      <dt>Floor area, {use}</dt>
      <dd>{Math.round(area).toLocaleString('en')} m²</dd>
    </>
  )
}
