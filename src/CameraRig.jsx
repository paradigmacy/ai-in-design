// Glides the camera to a chosen view. Grabbing the map with the mouse stops the glide.
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// `views` holds the camera spots; `view` is { name, n }. It changes only when a camera button is pressed
// (n counts the presses, so pressing the same button again flies back after you've moved away).
export default function CameraRig({ views, view }) {
  const { camera, controls } = useThree()
  const goal = useRef(null)

  useEffect(() => {
    const v = views[view.name]
    goal.current = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) }
  }, [views, view])

  useEffect(() => {
    if (!controls) return
    const stop = () => (goal.current = null)
    controls.addEventListener('start', stop)
    return () => controls.removeEventListener('start', stop)
  }, [controls])

  useFrame((_, dt) => {
    const g = goal.current
    if (!g || !controls) return
    const k = 1 - Math.exp(-dt * 4) // ease: about 1 second to arrive
    camera.position.lerp(g.pos, k)
    controls.target.lerp(g.target, k)
    controls.update()
    if (camera.position.distanceTo(g.pos) < 0.5 && controls.target.distanceTo(g.target) < 0.5) goal.current = null
  })

  return null
}
