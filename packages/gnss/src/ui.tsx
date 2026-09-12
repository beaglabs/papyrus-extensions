import { useState } from 'react'
import type { FC } from 'react'
import type { ExtensionUiProvider } from 'papyrus-extension-sdk'

/**
 * papyrus-gnss/ui
 *
 * Renderers for the orbital / GNSS / geodetic `kind`-tagged tool outputs
 * (orbit_view, sp3_view, nmea_view, sinex_view) produced by the parsers in
 * papyrus-gnss/tools.
 *
 * Everything here is dependency-free inline SVG: no Plotly (multi-MB) and no
 * Leaflet (needs external tile servers, which breaks the air-gapped image). Maps
 * are equirectangular projections with a graticule, not a slippy basemap. Colors
 * come from the shadcn theme tokens so the cards follow light/dark automatically.
 */

interface GroundTrackPoint { lat: number; lon: number; altKm: number; t: string }
interface OrbitalElements {
  inclinationDeg: number; raanDeg: number; eccentricity: number; argPerigeeDeg: number
  meanAnomalyDeg: number; meanMotionRevPerDay: number; periodMin: number; bstar: number
}
interface OrbitView {
  kind: 'orbit_view'; source: 'tle' | 'omm'
  object: { name: string | null; noradId: number }
  elements: OrbitalElements; groundTrack: GroundTrackPoint[]; subpoint: GroundTrackPoint; propagation: 'sgp4'
}
interface Sp3View {
  kind: 'sp3_view'
  header: { epochCount: number; satelliteCount: number; satelliteIds: string[] }
  satellites: Array<{ id: string; points: Array<{ t: string; xKm: number; yKm: number; zKm: number; clockUs: number | null }> }>
}
interface NmeaView {
  kind: 'nmea_view'
  track: Array<{ lat: number; lon: number }>
  satellites: Array<{ prn: string; elevationDeg: number | null; azimuthDeg: number | null; snrDbHz: number }>
  series: { time: string[]; altitudeM: Array<number | null>; speedKmh: number[] }
  fixCount: number; satCount: number
}
interface SinexView {
  kind: 'sinex_view'
  stations: Array<{ code: string; x: number; y: number; z: number; latDeg: number; lonDeg: number; heightM: number; sigma3dMm: number }>
}

const CHART = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'] as const
const chartColor = (i: number): string => CHART[i % CHART.length] ?? 'var(--primary)'
const BORDER = 'hsl(var(--border))'
const MUTED = 'hsl(var(--muted-foreground))'
const FG = 'hsl(var(--foreground))'
const ACCENT = 'hsl(var(--chart-1))'
const GOOD = 'hsl(var(--chart-2))'

const shell: React.CSSProperties = {
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: 12,
  margin: '8px 0',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--card-foreground))',
}
const heading: React.CSSProperties = {
  fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, margin: '0 0 8px', fontWeight: 600,
}

function fmt(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—'
}

/** Dispatch a `kind`-tagged orbital output to its renderer. */
export function OrbitalCard({ output }: { output: Record<string, unknown> }) {
  switch (output['kind']) {
    case 'orbit_view': return <OrbitViewCard view={output as unknown as OrbitView} />
    case 'sp3_view': return <Sp3ViewCard view={output as unknown as Sp3View} />
    case 'nmea_view': return <NmeaViewCard view={output as unknown as NmeaView} />
    case 'sinex_view': return <SinexViewCard view={output as unknown as SinexView} />
    default: return null
  }
}

/* ---------------- shared projection / svg helpers ---------------- */

const MAP_W = 720
const MAP_H = 360
const equirect = (lat: number, lon: number): [number, number] => [((lon + 180) / 360) * MAP_W, ((90 - lat) / 180) * MAP_H]

function Graticule() {
  const lines: React.ReactNode[] = []
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * MAP_W
    lines.push(<line key={`v${lon}`} x1={x} y1={0} x2={x} y2={MAP_H} stroke={BORDER} strokeWidth={lon === 0 ? 1 : 0.5} opacity={0.6} />)
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    const y = ((90 - lat) / 180) * MAP_H
    lines.push(<line key={`h${lat}`} x1={0} y1={y} x2={MAP_W} y2={y} stroke={BORDER} strokeWidth={lat === 0 ? 1 : 0.5} opacity={0.6} />)
  }
  return <g>{lines}</g>
}

/** Split a lat/lon path at antimeridian crossings so polylines don't wrap. */
function splitAntimeridian<T extends { lat: number; lon: number }>(points: T[]): T[][] {
  const segments: T[][] = []
  let seg: T[] = []
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]
    if (!p) continue
    const prev = points[i - 1]
    if (prev && Math.abs(p.lon - prev.lon) > 180) { segments.push(seg); seg = [] }
    seg.push(p)
  }
  if (seg.length) segments.push(seg)
  return segments
}

/* ---------------- orbit_view (TLE / OMM) ---------------- */

function OrbitViewCard({ view }: { view: OrbitView }) {
  const { object, elements, groundTrack, subpoint } = view
  const segments = splitAntimeridian(groundTrack)
  const [sx, sy] = equirect(subpoint.lat, subpoint.lon)
  const rows: Array<[string, string]> = [
    ['NORAD ID', String(object.noradId)],
    ['Inclination', `${fmt(elements.inclinationDeg, 4)}\u00b0`],
    ['RAAN', `${fmt(elements.raanDeg, 4)}\u00b0`],
    ['Eccentricity', fmt(elements.eccentricity, 7)],
    ['Arg of perigee', `${fmt(elements.argPerigeeDeg, 4)}\u00b0`],
    ['Mean anomaly', `${fmt(elements.meanAnomalyDeg, 4)}\u00b0`],
    ['Mean motion', `${fmt(elements.meanMotionRevPerDay, 6)} rev/day`],
    ['Period', `${fmt(elements.periodMin, 2)} min`],
  ]
  return (
    <div style={shell}>
      <p style={heading}>{object.name ?? `Satellite ${object.noradId}`} · ground track ({view.source.toUpperCase()} · SGP4)</p>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: '100%', height: 'auto', border: `1px solid ${BORDER}`, borderRadius: 8 }} role="img" aria-label="Ground track">
        <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="hsl(var(--muted))" opacity={0.25} />
        <Graticule />
        {segments.map((seg, i) => (
          <polyline key={i} fill="none" stroke={ACCENT} strokeWidth={2}
            points={seg.map((p) => equirect(p.lat, p.lon).join(',')).join(' ')} />
        ))}
        <circle cx={sx} cy={sy} r={5} fill={GOOD} stroke="hsl(var(--card))" strokeWidth={1.5} />
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '2px 16px', marginTop: 10 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', borderBottom: `1px solid ${BORDER}` }}>
            <span style={{ color: MUTED }}>{k}</span>
            <span style={{ fontFamily: 'ui-monospace, monospace', color: FG }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- sp3_view ---------------- */

function Sp3ViewCard({ view }: { view: Sp3View }) {
  const firstId = view.header.satelliteIds[0] ?? ''
  const [selected, setSelected] = useState(firstId)
  const sat = view.satellites.find((s) => s.id === selected) ?? view.satellites[0]

  // Isometric projection of every satellite's ECEF track, auto-scaled to fit.
  const W = 720, H = 380
  const project = (x: number, y: number, z: number): [number, number] => [(x - y) * 0.7071, (x + y) * 0.4082 - z * 0.8165]
  const projected = view.satellites.map((s) => s.points.map((p) => project(p.xKm, p.yKm, p.zKm)))
  const flat = projected.flat()
  const xs = flat.map((p) => p[0]); const ys = flat.map((p) => p[1])
  const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1)
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 1)
  const pad = 20
  const sc = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1))
  const tx = (x: number): number => pad + (x - minX) * sc
  const ty = (y: number): number => H - pad - (y - minY) * sc

  return (
    <div style={shell}>
      <p style={heading}>SP3 precise ephemeris · {view.header.satelliteCount} satellites · {view.header.epochCount} epochs</p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', border: `1px solid ${BORDER}`, borderRadius: 8 }} role="img" aria-label="3D trajectory (isometric, km)">
        {projected.map((pts, i) => (
          <polyline key={i} fill="none" stroke={chartColor(i)} strokeWidth={1.75}
            points={pts.map(([x, y]) => `${tx(x)},${ty(y)}`).join(' ')} />
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '8px 0', fontSize: 11.5 }}>
        {view.satellites.map((s, i) => (
          <span key={s.id} style={{ color: MUTED }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: chartColor(i), borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />{s.id}
          </span>
        ))}
      </div>
      <label style={{ fontSize: 12, color: MUTED }}>
        Satellite{' '}
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ background: 'hsl(var(--background))', color: FG, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 6px' }}>
          {view.header.satelliteIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      {sat && <TimeSeries points={sat.points} label={sat.id} />}
    </div>
  )
}

function TimeSeries({ points, label }: { points: Sp3View['satellites'][number]['points']; label: string }) {
  const W = 720, H = 220, pad = 34
  const axes: Array<['xKm' | 'yKm' | 'zKm', string]> = [['xKm', 'X'], ['yKm', 'Y'], ['zKm', 'Z']]
  const all = points.flatMap((p) => [p.xKm, p.yKm, p.zKm]).filter(Number.isFinite)
  const min = Math.min(...all, 0), max = Math.max(...all, 1)
  const n = Math.max(points.length - 1, 1)
  const px = (i: number): number => pad + (i / n) * (W - pad - 8)
  const py = (v: number): number => H - pad - ((v - min) / (max - min || 1)) * (H - pad - 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 8 }} role="img" aria-label={`${label} X/Y/Z time series`}>
      <line x1={pad} y1={H - pad} x2={W - 8} y2={H - pad} stroke={BORDER} />
      <line x1={pad} y1={8} x2={pad} y2={H - pad} stroke={BORDER} />
      {axes.map(([key, name], ai) => (
        <polyline key={key} fill="none" stroke={chartColor(ai)} strokeWidth={1.75}
          points={points.map((p, i) => `${px(i)},${py(p[key])}`).join(' ')}>
          <title>{name}</title>
        </polyline>
      ))}
      <text x={pad} y={16} fill={MUTED} fontSize={10}>{label} · X/Y/Z km (X {chartLabel(0)}, Y {chartLabel(1)}, Z {chartLabel(2)})</text>
    </svg>
  )
}
const chartLabel = (i: number): string => ['blue', 'green', 'amber', 'violet', 'red'][i] ?? 'series'

/* ---------------- nmea_view ---------------- */

function NmeaViewCard({ view }: { view: NmeaView }) {
  return (
    <div style={shell}>
      <p style={heading}>NMEA · {view.fixCount} fixes · {view.satCount} satellites in view</p>
      {view.track.length > 0 && <TrackMap track={view.track} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 10 }}>
        <Skyplot sats={view.satellites} />
        <SnrBars sats={view.satellites} />
      </div>
    </div>
  )
}

function TrackMap({ track }: { track: NmeaView['track'] }) {
  const W = 720, H = 260, pad = 16
  const lats = track.map((p) => p.lat); const lons = track.map((p) => p.lon)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLon = Math.min(...lons), maxLon = Math.max(...lons)
  const sx = (lon: number): number => pad + ((lon - minLon) / (maxLon - minLon || 1e-6)) * (W - 2 * pad)
  const sy = (lat: number): number => H - pad - ((lat - minLat) / (maxLat - minLat || 1e-6)) * (H - 2 * pad)
  const first = track[0]; const last = track[track.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', border: `1px solid ${BORDER}`, borderRadius: 8, background: 'hsl(var(--muted))' }} role="img" aria-label="Position track">
      <polyline fill="none" stroke={GOOD} strokeWidth={2.5} points={track.map((p) => `${sx(p.lon)},${sy(p.lat)}`).join(' ')} />
      {first && <circle cx={sx(first.lon)} cy={sy(first.lat)} r={4} fill={ACCENT} />}
      {last && <circle cx={sx(last.lon)} cy={sy(last.lat)} r={4} fill="hsl(var(--destructive))" />}
    </svg>
  )
}

function snrColor(snr: number): string {
  if (snr >= 40) return 'hsl(var(--chart-2))'
  if (snr >= 25) return 'hsl(var(--chart-4))'
  if (snr > 0) return 'hsl(var(--chart-5))'
  return MUTED
}

function Skyplot({ sats }: { sats: NmeaView['satellites'] }) {
  const S = 260, cx = S / 2, cy = S / 2, R = S / 2 - 18
  const place = (elev: number, az: number): [number, number] => {
    const r = R * (1 - Math.max(0, Math.min(90, elev)) / 90)
    const a = (az * Math.PI) / 180
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
  }
  return (
    <div>
      <svg viewBox={`0 0 ${S} ${S}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Skyplot">
        {[0, 30, 60].map((e) => <circle key={e} cx={cx} cy={cy} r={R * (1 - e / 90)} fill="none" stroke={BORDER} strokeWidth={0.75} />)}
        <line x1={cx} y1={cy - R} x2={cx} y2={cy + R} stroke={BORDER} strokeWidth={0.75} />
        <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke={BORDER} strokeWidth={0.75} />
        <text x={cx} y={cy - R - 5} fill={MUTED} fontSize={9} textAnchor="middle">N</text>
        <text x={cx + R + 6} y={cy + 3} fill={MUTED} fontSize={9} textAnchor="middle">E</text>
        {sats.map((s) => {
          const [x, y] = place(s.elevationDeg ?? 0, s.azimuthDeg ?? 0)
          return <g key={s.prn}><circle cx={x} cy={y} r={6} fill={snrColor(s.snrDbHz)} /><text x={x} y={y - 8} fill={MUTED} fontSize={8} textAnchor="middle">{s.prn}</text></g>
        })}
      </svg>
      <p style={{ fontSize: 10, color: MUTED, textAlign: 'center', margin: 0 }}>Skyplot · azimuth/elevation, colored by C/N0</p>
    </div>
  )
}

function SnrBars({ sats }: { sats: NmeaView['satellites'] }) {
  const ordered = [...sats].sort((a, b) => b.snrDbHz - a.snrDbHz)
  const W = 320, H = 220, pad = 24
  const n = Math.max(ordered.length, 1)
  const bw = (W - 2 * pad) / n
  const max = Math.max(...ordered.map((s) => s.snrDbHz), 50)
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="C/N0 per satellite">
        <line x1={pad} y1={H - pad} x2={W - 4} y2={H - pad} stroke={BORDER} />
        {ordered.map((s, i) => {
          const h = ((s.snrDbHz) / max) * (H - 2 * pad)
          return <g key={s.prn}>
            <rect x={pad + i * bw + 1} y={H - pad - h} width={Math.max(bw - 2, 1)} height={h} fill={snrColor(s.snrDbHz)} />
            <text x={pad + i * bw + bw / 2} y={H - pad + 10} fill={MUTED} fontSize={7} textAnchor="middle">{s.prn}</text>
          </g>
        })}
      </svg>
      <p style={{ fontSize: 10, color: MUTED, textAlign: 'center', margin: 0 }}>C/N0 per satellite (dB-Hz)</p>
    </div>
  )
}

/* ---------------- sinex_view ---------------- */

function SinexViewCard({ view }: { view: SinexView }) {
  const { stations } = view
  return (
    <div style={shell}>
      <p style={heading}>SINEX · {stations.length} station coordinate solutions</p>
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ width: '100%', height: 'auto', border: `1px solid ${BORDER}`, borderRadius: 8 }} role="img" aria-label="Station network">
        <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="hsl(var(--muted))" opacity={0.25} />
        <Graticule />
        {stations.map((s) => {
          const [x, y] = equirect(s.latDeg, s.lonDeg)
          return <g key={s.code}><circle cx={x} cy={y} r={5} fill={GOOD} stroke={ACCENT} strokeWidth={1} /><text x={x + 7} y={y + 3} fill={FG} fontSize={9}>{s.code}</text></g>
        })}
      </svg>
      <div style={{ overflowX: 'auto', marginTop: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
          <thead>
            <tr>{['Station', 'Lat', 'Lon', 'Height (m)', '3D sigma (mm)'].map((h) => (
              <th key={h} style={{ textAlign: h === 'Station' ? 'left' : 'right', color: MUTED, fontSize: 10, textTransform: 'uppercase', padding: '4px 8px', borderBottom: `1px solid ${BORDER}` }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.code}>
                <td style={{ padding: '4px 8px', borderBottom: `1px solid ${BORDER}` }}>{s.code}</td>
                <td style={{ padding: '4px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{fmt(s.latDeg, 5)}</td>
                <td style={{ padding: '4px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{fmt(s.lonDeg, 5)}</td>
                <td style={{ padding: '4px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{fmt(s.heightM, 3)}</td>
                <td style={{ padding: '4px 8px', borderBottom: `1px solid ${BORDER}`, textAlign: 'right' }}>{fmt(s.sigma3dMm, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * UI provider consumed by the Papyrus core through `buildCardRegistry`. A single
 * `OrbitalCard` handles all four kinds (it dispatches on `output.kind`), so it is
 * registered against each kind this extension produces.
 */
export type OrbitalCardComponent = FC<{ output: Record<string, unknown> }>

export const gnssUiProvider: ExtensionUiProvider<OrbitalCardComponent> = {
  name: 'papyrus-gnss',
  version: '0.1.0',
  cards: (['orbit_view', 'sp3_view', 'nmea_view', 'sinex_view'] as const).map((kind) => ({
    kind,
    component: OrbitalCard,
  })),
}
