// My block from Session 2: the Grasshopper design, exported from Rhino as public/data/block.glb.
// Exported in the app's coordinates (metres east/north of the kit centre, Rhino's Z up mapped to y up),
// so it sits on its plot without any moving here.
// Rhino's glTF export drops transparency and only keeps render materials, so the see-through and
// special materials are restored here by their names (one material per Grasshopper preview colour).
import { useMemo } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'

const URL = `${import.meta.env.BASE_URL}data/block.glb`

// My block as a building of the game, so you can stand on its roof and jump to and from it.
// Outline = the outer and courtyard edge from Grasshopper (footprint script), in longitude/latitude;
// height = floors x floor height. Exported together with block.glb; export both again after a design change.
export const MY_BLOCK = {
  "type": "Feature",
  "properties": {
    "id": "my block",
    "height": 27.2,
    "height_source": "design",
    "floors": 8,
    "use": "residential",
    "floor_area_m2": {
      "residential": 19037
    },
    "mine": true
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [
          11.3264267,
          50.9854547
        ],
        [
          11.3266547,
          50.9852911
        ],
        [
          11.3278549,
          50.9850437
        ],
        [
          11.3278559,
          50.9855722
        ],
        [
          11.3264267,
          50.9854547
        ]
      ],
      [
        [
          11.3268439,
          50.9853731
        ],
        [
          11.3276725,
          50.9852022
        ],
        [
          11.327673,
          50.9854412
        ],
        [
          11.3268439,
          50.9853731
        ]
      ]
    ]
  }
}
export const isMine = (f) => f.properties.mine === true

// Only the building itself is a roof you can click; trees, benches and planting let clicks through.
const NOT_CLICKABLE = /^(tree|snow|LED|landscape|courtyard|planting)/

// Opacity per material name, from the alpha of each colour swatch in Grasshopper.
const OPACITY = {
  'facade glass': 0.27,
  'lobby glass': 0.43,
  sunshades: 0.92,
}

function restore(material) {
  const m = material.clone()
  const name = material.name
  if (OPACITY[name] != null) {
    m.transparent = true
    m.opacity = OPACITY[name]
    m.depthWrite = false
    m.side = THREE.DoubleSide
  }
  if (name === 'metal bands') {
    m.metalness = 0.85
    m.roughness = 0.3
  }
  if (name === 'LED lights') {
    m.emissive = new THREE.Color('#ffd06e')
    m.emissiveIntensity = 1.5
  }
  if (name === 'facade glass' || name === 'lobby glass') {
    m.metalness = 0.1
    m.roughness = 0.05
  }
  return m
}

export default function Block({ onSelect }) {
  const { scene } = useGLTF(URL)
  const model = useMemo(() => {
    const copy = scene.clone(true)
    copy.traverse((o) => {
      if (o.isMesh) {
        o.material = Array.isArray(o.material) ? o.material.map(restore) : restore(o.material)
        if (NOT_CLICKABLE.test(o.material.name)) o.raycast = () => null // clicks go through to the city underneath
      }
    })
    return copy
  }, [scene])
  const click = (e) => {
    e.stopPropagation()
    onSelect?.(MY_BLOCK, false)
  }
  return <primitive object={model} onClick={click} />
}

useGLTF.preload(URL)
