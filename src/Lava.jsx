// The lava: a glowing orange layer over the kit area, and the clock that makes it rise.
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { toMetres } from './geo.js'

export const LAVA_M_PER_S = 0.1 // rising speed at 1×; 37 m takes about 6 minutes

// A small painted texture of hot blobs on dark orange, repeated over the lava.
function lavaTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')
  g.fillStyle = '#b3260b'
  g.fillRect(0, 0, size, size)
  for (let n = 0; n < 70; n++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 8 + Math.random() * 34
    const hot = Math.random() < 0.3 ? '255,214,90' : '255,120,30'
    // Draw each blob nine times, shifted by one tile, so the repeated texture has no seams.
    for (const dx of [-size, 0, size])
      for (const dy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        grad.addColorStop(0, `rgba(${hot},0.9)`)
        grad.addColorStop(1, `rgba(${hot},0)`)
        g.fillStyle = grad
        g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r)
      }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// `game` is a ref shared with the page: { lava, playing, speed, stopAt }.
// Every frame the lava rises if playing; ten times a second it tells the page the new height,
// and once it reaches the secret stop height it calls onStop.
export default function Lava({ kit, game, onTick, onStop, onClick }) {
  const mesh = useRef()
  const material = useRef()
  const since = useRef(0)
  const texture = useMemo(lavaTexture, [])

  const [w, s, e, n] = kit.bbox
  const [x0, y0] = toMetres([w, s])
  const [x1, y1] = toMetres([e, n])
  texture.repeat.set((x1 - x0) / 220, (y1 - y0) / 220)

  useFrame(({ clock }, dt) => {
    const g = game.current
    if (g.playing) {
      g.lava = Math.min(g.stopAt, g.lava + LAVA_M_PER_S * g.speed * dt)
      if (g.lava >= g.stopAt) {
        g.playing = false
        onStop(g.lava)
      }
    }
    since.current += dt
    if (since.current > 0.1) {
      since.current = 0
      onTick(Math.round(g.lava * 10) / 10)
    }

    mesh.current.position.y = g.lava
    mesh.current.visible = g.lava > 0.02
    texture.offset.x += dt * 0.01 // the lava drifts slowly
    texture.offset.y += dt * 0.006
    material.current.emissiveIntensity = 1 + 0.18 * Math.sin(clock.elapsedTime * 2.2) // and gently pulses
  })

  return (
    <mesh
      ref={mesh}
      rotation-x={-Math.PI / 2}
      position={[(x0 + x1) / 2, 0, -(y0 + y1) / 2]}
      renderOrder={1}
      onClick={(ev) => {
        ev.stopPropagation()
        onClick()
      }}
    >
      <planeGeometry args={[x1 - x0, y1 - y0]} />
      <meshStandardMaterial
        ref={material}
        color="#ff5a1f"
        map={texture}
        emissive="#ff4a10"
        emissiveMap={texture}
        transparent
        opacity={0.88}
        depthWrite={false}
        roughness={0.6}
      />
    </mesh>
  )
}
