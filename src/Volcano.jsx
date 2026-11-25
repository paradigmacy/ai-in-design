// The volcano that thinks. It watches the lava game, asks Claude what to do (on this laptop only),
// carries the answer out and shows its reasoning.
// The loop: every 10 s while the lava rises, soon after you pick a roof, and when the lava stops,
// the page sends what is happening to /api/volcano (see volcano-server.js). Claude answers with one
// action from a fixed list and a reason; the page does it and writes it into "The volcano's thoughts".
import { useCallback, useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { LAVA_MAX_M } from './jumps.js'

export const THINK_EVERY_S = 10
const EFFECT_S = 15 // how long speed_up and slow_down last
const LOCAL = import.meta.env.DEV // the endpoint only exists with `npm run dev` on this laptop

const ACTION_LABEL = {
  speed_up: '\u{1F525} Speeds up the lava',
  slow_down: '\u{1F9CA} Slows the lava',
  taunt: '\u{1F4AC} Taunts you',
  rumble: '〰️ Rumbles',
  mercy: '\u{1F54A}\u{FE0F} Shows mercy',
  wait: '… Waits',
  error: '⚠️ Could not think',
}

// `game` is the shared ref { lava, playing, speed, stopAt }; the volcano adds { volcano, volcanoUntil, rumbleUntil }.
export function useVolcano({ game, playing, stoppedAt, selected, targets, path }) {
  const [log, setLog] = useState([])
  const [thinking, setThinking] = useState(false)
  const busy = useRef(false)
  const lastMove = useRef(performance.now())
  const started = useRef(null)
  const latest = useRef({})
  latest.current = { selected, targets, path, log }

  useEffect(() => {
    lastMove.current = performance.now()
  }, [selected])
  useEffect(() => {
    if (playing && started.current == null) started.current = performance.now()
  }, [playing])

  const apply = useCallback(
    (answer, best) => {
      const g = game.current
      const now = performance.now()
      if (answer.action === 'speed_up' || answer.action === 'slow_down') {
        g.volcano = answer.action === 'speed_up' ? 1.8 : 0.4
        g.volcanoUntil = now + EFFECT_S * 1000
      }
      if (answer.action === 'rumble') g.rumbleUntil = now + 1500
      if (answer.action === 'mercy')
        answer.hint = best
          ? `Hint: your best escape is building ${best.properties.id}, ${best.properties.height} m.`
          : 'Hint: pick a roof first, then look for the gold arcs.'
    },
    [game],
  )

  const think = useCallback(
    async (trigger) => {
      if (!LOCAL || busy.current) return
      const s = latest.current
      const g = game.current
      const roof = s.selected?.feature
      const best = s.path.length > 1 ? s.path[s.path.length - 1] : null
      // What the volcano notices.
      const state = {
        trigger,
        seconds_played: started.current ? Math.round((performance.now() - started.current) / 1000) : 0,
        lava_height_m: Math.round(g.lava * 10) / 10,
        lava_rises_m_per_s: Math.round(0.1 * g.speed * (g.volcano ?? 1) * 100) / 100,
        lava_never_goes_above_m: LAVA_MAX_M,
        player: roof
          ? {
              roof: String(roof.properties.id),
              roof_height_m: roof.properties.height,
              metres_above_lava: Math.round((roof.properties.height - g.lava) * 10) / 10,
              taller_roofs_in_jump_reach: s.targets.length,
              best_escape: best
                ? { roof: String(best.properties.id), height_m: best.properties.height, jumps: s.path.length - 1 }
                : 'none, already on the highest reachable roof',
            }
          : 'has not picked a roof yet',
        seconds_since_player_moved: Math.round((performance.now() - lastMove.current) / 1000),
        my_last_actions: s.log.slice(0, 3).map((e) => e.action),
      }
      busy.current = true
      setThinking(true)
      try {
        const r = await fetch('/api/volcano', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
        })
        const answer = await r.json()
        if (!r.ok) throw new Error(answer.error || `status ${r.status}`)
        apply(answer, best)
        setLog((l) => [{ ...answer, trigger, at: state.seconds_played, lava: state.lava_height_m, id: Date.now() }, ...l].slice(0, 30))
      } catch (e) {
        setLog((l) =>
          [{ action: 'error', reason: String(e.message || e), trigger, at: state.seconds_played, lava: state.lava_height_m, id: Date.now() }, ...l].slice(0, 30),
        )
      } finally {
        busy.current = false
        setThinking(false)
      }
    },
    [game, apply],
  )

  // When does it think: every 10 s while the lava rises (and once right away) ...
  useEffect(() => {
    if (!LOCAL || !playing) return
    think('the lava started rising')
    const id = setInterval(() => think(`${THINK_EVERY_S} seconds passed`), THINK_EVERY_S * 1000)
    return () => clearInterval(id)
  }, [playing, think])
  // ... soon after you pick or change your roof ...
  useEffect(() => {
    if (!LOCAL || !selected) return
    const id = setTimeout(() => think('the player picked a roof'), 800)
    return () => clearTimeout(id)
  }, [selected, think])
  // ... and once when the lava stops.
  useEffect(() => {
    if (!LOCAL || stoppedAt == null) return
    const id = setTimeout(() => think('the lava stopped: say goodbye or admit defeat'), 300)
    return () => clearTimeout(id)
  }, [stoppedAt, think])

  const reset = useCallback(() => {
    setLog([])
    started.current = null
    Object.assign(game.current, { volcano: 1, volcanoUntil: 0, rumbleUntil: 0 })
  }, [game])

  return { log, thinking, reset, local: LOCAL }
}

// Inside the 3D canvas: ends speed effects on time, and shakes the camera while the volcano rumbles.
export function VolcanoEffects({ game }) {
  const { camera } = useThree()
  const shake = useRef([0, 0, 0])
  useFrame(() => {
    const g = game.current
    const now = performance.now()
    if (g.volcanoUntil && now > g.volcanoUntil) {
      g.volcano = 1
      g.volcanoUntil = 0
    }
    const [ox, oy, oz] = shake.current
    camera.position.set(camera.position.x - ox, camera.position.y - oy, camera.position.z - oz)
    shake.current = g.rumbleUntil && now < g.rumbleUntil ? [0, 0, 0].map(() => (Math.random() - 0.5) * 2.4) : [0, 0, 0]
    camera.position.set(camera.position.x + shake.current[0], camera.position.y + shake.current[1], camera.position.z + shake.current[2])
  })
  return null
}

// In the side panel: the volcano's reasoning, newest first.
export function VolcanoPanel({ volcano }) {
  if (!volcano.local)
    return (
      <p className="note volcano-off">
        {'\u{1F30B}'} The volcano only thinks on localhost: it runs on its maker's own Claude account, on their laptop.
      </p>
    )
  return (
    <div className="volcano">
      <h3>
        {'\u{1F30B}'} The volcano's thoughts {volcano.thinking && <span className="thinking">thinking…</span>}
      </h3>
      {volcano.log.length === 0 ? (
        <p className="muted small">
          Press Play. Every {THINK_EVERY_S} s, and whenever you pick a roof, the volcano looks at the game and decides
          what to do.
        </p>
      ) : (
        <ol className="volcano-log">
          {volcano.log.map((e) => (
            <li key={e.id} className={`volcano-entry ${e.action}`}>
              <div className="volcano-head">
                <span className="badge">{ACTION_LABEL[e.action] ?? e.action}</span>
                <span className="muted small">
                  {e.at} s · lava {e.lava} m{e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s to think` : ''}
                </span>
              </div>
              {e.say && <p className="say">“{e.say}”</p>}
              {e.hint && <p className="small hint">{e.hint}</p>}
              {e.noticed && (
                <p className="small">
                  <b>Noticed:</b> {e.noticed}
                </p>
              )}
              <p className="small">
                <b>Why:</b> {e.reason}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// Over the map: the volcano's latest line, for a few seconds.
export function VolcanoSays({ volcano }) {
  const last = volcano.log[0]
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!last?.say) return
    setShow(true)
    const t = setTimeout(() => setShow(false), 6000)
    return () => clearTimeout(t)
  }, [last?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!show || !last?.say) return null
  return (
    <div className={`volcano-says ${last.action}`}>
      <span aria-hidden="true">{'\u{1F30B}'}</span> {last.say}
    </div>
  )
}
