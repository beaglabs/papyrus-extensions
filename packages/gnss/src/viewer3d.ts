import type { OrbitView } from './parsers.js'

interface Viewer3DVector {
  x: number
  y: number
  z: number
}

interface Viewer3DView {
  kind: 'viewer_3d'
  renderer: string
  title: string
  scene: {
    units: 'km'
    frame: 'ECEF'
    objects: Array<
      | { type: 'sphere'; id: string; label?: string; color?: string; center: Viewer3DVector; radiusKm: number }
      | { type: 'path'; id: string; label?: string; color?: string; points: Viewer3DVector[] }
      | { type: 'points'; id: string; label?: string; color?: string; points: Viewer3DVector[] }
    >
    camera: { target: Viewer3DVector; distanceKm: number }
  }
  source: { extension: 'papyrus-gnss'; tool: string }
}

const EARTH_RADIUS_KM = 6371.0088

function llhToEcef(latDeg: number, lonDeg: number, altitudeKm: number): Viewer3DVector {
  const lat = latDeg * Math.PI / 180
  const lon = lonDeg * Math.PI / 180
  const radius = EARTH_RADIUS_KM + altitudeKm
  const cosLat = Math.cos(lat)
  return {
    x: radius * cosLat * Math.cos(lon),
    y: radius * cosLat * Math.sin(lon),
    z: radius * Math.sin(lat),
  }
}

function surfacePoint(latDeg: number, lonDeg: number): Viewer3DVector {
  return llhToEcef(latDeg, lonDeg, 4)
}

/**
 * Convert the deterministic SGP4 orbit view into the renderer-neutral viewer_3d
 * scene contract. The path is expressed in Earth-fixed coordinates so the globe,
 * ground track, and propagated spacecraft positions all share the same frame.
 */
export function orbitToViewer3d(orbit: OrbitView, tool: string): Viewer3DView {
  const label = orbit.object.name?.trim() || `NORAD ${orbit.object.noradId}`
  const orbitPoints = orbit.groundTrack.map((point) => llhToEcef(point.lat, point.lon, point.altKm))
  const groundTrack = orbit.groundTrack.map((point) => surfacePoint(point.lat, point.lon))
  const current = orbitPoints[0]
  if (!current) throw new Error('Orbit has no propagated positions for 3D visualization.')
  const maxRadius = orbit.groundTrack.reduce((value, point) => Math.max(value, EARTH_RADIUS_KM + point.altKm), EARTH_RADIUS_KM)

  return {
    kind: 'viewer_3d',
    renderer: 'papyrus-webgl',
    title: `${label} · 3D orbit`,
    scene: {
      units: 'km',
      frame: 'ECEF',
      camera: { target: { x: 0, y: 0, z: 0 }, distanceKm: Math.max(17_000, maxRadius * 2.55) },
      objects: [
        {
          type: 'sphere',
          id: 'earth',
          label: 'Earth',
          color: '#1769aa',
          center: { x: 0, y: 0, z: 0 },
          radiusKm: EARTH_RADIUS_KM,
        },
        {
          type: 'path',
          id: 'ground-track',
          label: 'Ground track',
          color: '#5fd7ff',
          points: groundTrack,
        },
        {
          type: 'path',
          id: 'orbit',
          label,
          color: '#ff7a18',
          points: orbitPoints,
        },
        {
          type: 'points',
          id: 'spacecraft',
          label: `${label} current propagated position`,
          color: '#ffd166',
          points: [current],
        },
      ],
    },
    source: { extension: 'papyrus-gnss', tool },
  }
}
