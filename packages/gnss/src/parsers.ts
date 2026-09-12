import * as satellite from 'satellite.js'

/**
 * Orbital, GNSS, and geodetic format parsers.
 *
 * Each parser is a pure, read-only function that returns a `kind`-tagged UI
 * object rendered by the cards in papyrus-gnss/ui. They hold no authority and
 * touch no network, so the host runtime can expose them (via papyrus-gnss/tools)
 * without widening the agent's action surface. Parsing is exact and
 * dependency-free; only SGP4 propagation (TLE/OMM ground tracks) uses
 * satellite.js.
 */

export interface GroundTrackPoint {
  lat: number
  lon: number
  altKm: number
  t: string
}

export interface OrbitalElements {
  inclinationDeg: number
  raanDeg: number
  eccentricity: number
  argPerigeeDeg: number
  meanAnomalyDeg: number
  meanMotionRevPerDay: number
  periodMin: number
  bstar: number
}

export interface OrbitView {
  kind: 'orbit_view'
  source: 'tle' | 'omm'
  object: { name: string | null; noradId: number }
  elements: OrbitalElements
  groundTrack: GroundTrackPoint[]
  subpoint: GroundTrackPoint
  propagation: 'sgp4'
}

export interface Sp3SatelliteTrack {
  id: string
  points: Array<{ t: string; xKm: number; yKm: number; zKm: number; clockUs: number | null }>
}

export interface Sp3View {
  kind: 'sp3_view'
  header: { epochCount: number; satelliteCount: number; satelliteIds: string[] }
  satellites: Sp3SatelliteTrack[]
}

export interface NmeaSatellite {
  prn: string
  elevationDeg: number | null
  azimuthDeg: number | null
  snrDbHz: number
}

export interface NmeaView {
  kind: 'nmea_view'
  track: Array<{ lat: number; lon: number }>
  satellites: NmeaSatellite[]
  series: { time: string[]; altitudeM: Array<number | null>; speedKmh: number[] }
  fixCount: number
  satCount: number
}

export interface SinexStation {
  code: string
  x: number
  y: number
  z: number
  latDeg: number
  lonDeg: number
  heightM: number
  sigma3dMm: number
}

export interface SinexView {
  kind: 'sinex_view'
  stations: SinexStation[]
}

export type OrbitalView = OrbitView | Sp3View | NmeaView | SinexView

/* ---------- shared helpers ---------- */

/** Parse a numeric field that may use Fortran-style D exponents (e.g. "1.23D-4"). */
function num(value: string): number {
  return Number.parseFloat(value.replace(/[Dd]/, 'E'))
}

/** WGS84 ECEF (meters) -> geodetic (degrees, meters). */
function ecefToGeodetic(x: number, y: number, z: number): { latDeg: number; lonDeg: number; heightM: number } {
  const a = 6378137
  const f = 1 / 298.257223563
  const b = a * (1 - f)
  const e2 = (a * a - b * b) / (a * a)
  const ep2 = (a * a - b * b) / (b * b)
  const p = Math.hypot(x, y)
  const th = Math.atan2(z * a, p * b)
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3)
  const lon = Math.atan2(y, x)
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2)
  return { latDeg: (lat * 180) / Math.PI, lonDeg: (lon * 180) / Math.PI, heightM: p / Math.cos(lat) - n }
}

/* ---------- OMM -> TLE reconstruction (feeds the same SGP4 pipeline) ---------- */

function padLeft(value: string | number, width: number): string {
  const s = String(value)
  return s.length >= width ? s.slice(0, width) : s.padStart(width)
}

function padRight(value: string | number, width: number): string {
  const s = String(value)
  return s.length >= width ? s.slice(0, width) : s.padEnd(width)
}

function tleChecksum(line: string): number {
  let sum = 0
  for (const ch of line) {
    if (ch >= '0' && ch <= '9') sum += Number(ch)
    else if (ch === '-') sum += 1
  }
  return sum % 10
}

function epochToTle(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`OMM has an invalid EPOCH: ${iso}`)
  const year = d.getUTCFullYear()
  const doy = (d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1
  return String(year).slice(-2) + doy.toFixed(8).padStart(12, '0')
}

function fmtNdot(v: number): string {
  const sign = v < 0 ? '-' : ' '
  return sign + Math.abs(v).toFixed(8).slice(1)
}

function fmtExp(v: number): string {
  if (!v) return ' 00000-0'
  const sign = v < 0 ? '-' : ' '
  let a = Math.abs(v)
  let e = 0
  while (a >= 1) { a /= 10; e += 1 }
  while (a < 0.1) { a *= 10; e -= 1 }
  let m = Math.round(a * 1e5)
  if (m >= 1e5) { m = Math.round(m / 10); e += 1 }
  return sign + String(m).padStart(5, '0') + (e < 0 ? '-' : '+') + Math.abs(e)
}

function fmtEcc(e: number): string {
  return String(Math.round(e * 1e7)).padStart(7, '0')
}

function parseOmmFields(text: string): Record<string, string> {
  const trimmed = text.trim()
  const fields: Record<string, string> = {}
  if (trimmed.startsWith('<')) {
    const re = /<([A-Za-z_]+)>\s*([^<]+?)\s*<\/\1>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(trimmed)) !== null) {
      const key = m[1]
      const value = m[2]
      if (key && value !== undefined) fields[key.toUpperCase()] = value.trim()
    }
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_]+)\s*=\s*(.+?)\s*$/.exec(line)
      if (m && m[1] && m[2] !== undefined) fields[m[1].toUpperCase()] = m[2].trim()
    }
  }
  const required = ['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'EPOCH']
  for (const key of required) if (!(key in fields)) throw new Error(`OMM is missing required field: ${key}`)
  return fields
}

function ommToTle(fields: Record<string, string>): [string, string] {
  const satnum = padLeft(fields['NORAD_CAT_ID'] ?? '00000', 5)
  const cls = (fields['CLASSIFICATION_TYPE'] ?? 'U').slice(0, 1)
  let intl = '        '
  const objectId = fields['OBJECT_ID']
  if (objectId && /^\d{4}-\d{3}/.test(objectId)) {
    const [year = '', rest = ''] = objectId.split('-')
    intl = padRight(year.slice(2) + rest, 8)
  }
  const epoch = epochToTle(fields['EPOCH'] ?? '')
  let l1 =
    '1 ' + satnum + cls + ' ' + intl + ' ' + epoch + ' ' +
    fmtNdot(num(fields['MEAN_MOTION_DOT'] ?? '0')) + ' ' +
    fmtExp(num(fields['MEAN_MOTION_DDOT'] ?? '0')) + ' ' +
    fmtExp(num(fields['BSTAR'] ?? '0')) + ' 0 ' + padLeft(fields['ELEMENT_SET_NO'] ?? '999', 4)
  l1 += tleChecksum(l1)
  let l2 =
    '2 ' + satnum + ' ' +
    padLeft(num(fields['INCLINATION'] ?? '0').toFixed(4), 8) + ' ' +
    padLeft(num(fields['RA_OF_ASC_NODE'] ?? '0').toFixed(4), 8) + ' ' +
    fmtEcc(num(fields['ECCENTRICITY'] ?? '0')) + ' ' +
    padLeft(num(fields['ARG_OF_PERICENTER'] ?? '0').toFixed(4), 8) + ' ' +
    padLeft(num(fields['MEAN_ANOMALY'] ?? '0').toFixed(4), 8) + ' ' +
    padLeft(num(fields['MEAN_MOTION'] ?? '0').toFixed(8), 11) + padLeft(fields['REV_AT_EPOCH'] ?? '0', 5)
  l2 += tleChecksum(l2)
  return [l1, l2]
}

/* ---------- SGP4 propagation ---------- */

function classicalElements(satrec: satellite.SatRec): OrbitalElements {
  const deg = (r: number): number => (r * 180) / Math.PI
  const meanMotionRevPerDay = (satrec.no * 1440) / (2 * Math.PI)
  return {
    inclinationDeg: deg(satrec.inclo),
    raanDeg: deg(satrec.nodeo),
    eccentricity: satrec.ecco,
    argPerigeeDeg: deg(satrec.argpo),
    meanAnomalyDeg: deg(satrec.mo),
    meanMotionRevPerDay,
    periodMin: 1440 / meanMotionRevPerDay,
    bstar: satrec.bstar,
  }
}

function propagateGroundTrack(line1: string, line2: string, samples = 160): { satrec: satellite.SatRec; track: GroundTrackPoint[] } {
  const satrec = satellite.twoline2satrec(line1, line2)
  const meanMotionRevPerDay = (satrec.no * 1440) / (2 * Math.PI)
  const periodMin = 1440 / meanMotionRevPerDay
  const start = new Date()
  const track: GroundTrackPoint[] = []
  for (let i = 0; i <= samples; i += 1) {
    const t = new Date(start.getTime() + (i / samples) * periodMin * 60_000)
    const propagated = satellite.propagate(satrec, t)
    const position = propagated.position
    if (!position || typeof position === 'boolean') continue
    const geo = satellite.eciToGeodetic(position, satellite.gstime(t))
    track.push({
      lat: satellite.degreesLat(geo.latitude),
      lon: satellite.degreesLong(geo.longitude),
      altKm: geo.height,
      t: t.toISOString(),
    })
  }
  return { satrec, track }
}

/* ---------- parsers ---------- */

/** Parse a TLE and propagate one orbital period with SGP4. */
export function parseTle(tle: string): OrbitView {
  const lines = tle.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const line1 = lines.find((l) => l.startsWith('1 '))
  const line2 = lines.find((l) => l.startsWith('2 '))
  if (!line1 || !line2) throw new Error('TLE must contain a line starting with "1 " and a line starting with "2 ".')
  const name = lines.find((l) => !l.startsWith('1 ') && !l.startsWith('2 ')) ?? null
  const { satrec, track } = propagateGroundTrack(line1, line2)
  const subpoint = track[0]
  if (!subpoint) throw new Error('SGP4 produced no positions; the TLE may be malformed.')
  return {
    kind: 'orbit_view',
    source: 'tle',
    object: { name, noradId: Number(satrec.satnum) },
    elements: classicalElements(satrec),
    groundTrack: track,
    subpoint,
    propagation: 'sgp4',
  }
}

/** Parse an OMM (CCSDS XML or KVN), rebuild the TLE, and propagate with SGP4. */
export function parseOmm(omm: string): OrbitView {
  const fields = parseOmmFields(omm)
  const [line1, line2] = ommToTle(fields)
  const { satrec, track } = propagateGroundTrack(line1, line2)
  const subpoint = track[0]
  if (!subpoint) throw new Error('SGP4 produced no positions from the OMM mean elements.')
  return {
    kind: 'orbit_view',
    source: 'omm',
    object: { name: fields['OBJECT_NAME'] ?? fields['OBJECT_ID'] ?? null, noradId: Number(satrec.satnum) },
    elements: classicalElements(satrec),
    groundTrack: track,
    subpoint,
    propagation: 'sgp4',
  }
}

/** Parse SP3/SP3c/SP3d precise ephemeris into per-satellite ECEF (km) tracks. */
export function parseSp3(sp3: string): Sp3View {
  const epochs: string[] = []
  const sats = new Map<string, Sp3SatelliteTrack['points']>()
  let current: string | null = null
  for (const line of sp3.split(/\r?\n/)) {
    if (line.startsWith('*')) {
      const [y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0] = line.slice(1).trim().split(/\s+/).map(Number)
      current = new Date(Date.UTC(y, mo - 1, d, h, mi, Math.floor(s))).toISOString()
      epochs.push(current)
    } else if (line.startsWith('P') && current) {
      const id = line.slice(1, 4).trim()
      const [x = Number.NaN, yy = Number.NaN, z = Number.NaN, clk] = line.slice(4).trim().split(/\s+/).map(Number)
      const points = sats.get(id) ?? []
      points.push({
        t: current,
        xKm: x,
        yKm: yy,
        zKm: z,
        clockUs: clk !== undefined && Number.isFinite(clk) && clk < 999_999 ? clk : null,
      })
      sats.set(id, points)
    }
  }
  if (epochs.length === 0) throw new Error('No epoch (*) records found in SP3 input.')
  const satelliteIds = [...sats.keys()].sort()
  if (satelliteIds.length === 0) throw new Error('No position (P) records found in SP3 input.')
  return {
    kind: 'sp3_view',
    header: { epochCount: epochs.length, satelliteCount: satelliteIds.length, satelliteIds },
    satellites: satelliteIds.map((id) => ({ id, points: sats.get(id) ?? [] })),
  }
}

function nmeaCoord(value: string, hemi: string): number {
  if (!value) return Number.NaN
  const dot = value.indexOf('.')
  const degLen = dot > 4 ? 3 : 2 // longitude has a 3-digit degree field
  let dec = Number.parseFloat(value.slice(0, degLen)) + Number.parseFloat(value.slice(degLen)) / 60
  if (hemi === 'S' || hemi === 'W') dec = -dec
  return dec
}

/** Parse NMEA 0183 sentences (GGA/RMC positions, GSV satellites in view). */
export function parseNmea(nmea: string): NmeaView {
  const track: NmeaView['track'] = []
  const time: string[] = []
  const altitudeM: Array<number | null> = []
  const speedKmh: number[] = []
  const sats = new Map<string, NmeaSatellite>()
  for (const raw of nmea.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('$')) continue
    const star = line.indexOf('*')
    const body = star >= 0 ? line.slice(1, star) : line.slice(1)
    const f = body.split(',')
    const type = (f[0] ?? '').slice(2) // strip talker id (GP, GN, GL, ...)
    if (type === 'GGA') {
      const lat = nmeaCoord(f[2] ?? '', f[3] ?? '')
      const lon = nmeaCoord(f[4] ?? '', f[5] ?? '')
      const alt = Number.parseFloat(f[9] ?? '')
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        track.push({ lat, lon })
        time.push(f[1] ?? '')
        altitudeM.push(Number.isFinite(alt) ? alt : null)
      }
    } else if (type === 'RMC') {
      const lat = nmeaCoord(f[3] ?? '', f[4] ?? '')
      const lon = nmeaCoord(f[5] ?? '', f[6] ?? '')
      const spd = Number.parseFloat(f[7] ?? '')
      if (Number.isFinite(lat) && Number.isFinite(lon)) track.push({ lat, lon })
      if (Number.isFinite(spd)) speedKmh.push(spd * 1.852)
    } else if (type === 'GSV') {
      for (let i = 4; i + 3 < f.length; i += 4) {
        const prn = f[i]
        if (!prn) continue
        const elev = Number.parseFloat(f[i + 1] ?? '')
        const az = Number.parseFloat(f[i + 2] ?? '')
        const snr = Number.parseFloat(f[i + 3] ?? '')
        sats.set(prn, {
          prn,
          elevationDeg: Number.isFinite(elev) ? elev : null,
          azimuthDeg: Number.isFinite(az) ? az : null,
          snrDbHz: Number.isFinite(snr) ? snr : 0,
        })
      }
    }
  }
  const satellites = [...sats.values()]
  if (track.length === 0 && satellites.length === 0) {
    throw new Error('No GGA/RMC/GSV sentences could be parsed from the input.')
  }
  return { kind: 'nmea_view', track, satellites, series: { time, altitudeM, speedKmh }, fixCount: track.length, satCount: satellites.length }
}

/** Parse the SOLUTION/ESTIMATE block of a SINEX file into geodetic station coordinates. */
export function parseSinex(sinex: string): SinexView {
  let inEstimate = false
  const acc = new Map<string, { code: string; x?: number; y?: number; z?: number; xs?: number; ys?: number; zs?: number }>()
  for (const line of sinex.split(/\r?\n/)) {
    if (/^\+SOLUTION\/ESTIMATE/.test(line)) { inEstimate = true; continue }
    if (/^-SOLUTION\/ESTIMATE/.test(line)) { inEstimate = false; continue }
    if (!inEstimate || line.startsWith('*') || !line.trim()) continue
    const p = line.trim().split(/\s+/)
    const type = p[1] ?? ''
    const code = p[2] ?? ''
    if (p.length < 10 || !/^STA[XYZ]$/.test(type) || !code) continue
    const axis = type.charAt(3).toLowerCase()
    const value = num(p[8] ?? '')
    const sigma = num(p[9] ?? '')
    const entry = acc.get(code) ?? { code }
    if (axis === 'x') { entry.x = value; entry.xs = sigma }
    else if (axis === 'y') { entry.y = value; entry.ys = sigma }
    else if (axis === 'z') { entry.z = value; entry.zs = sigma }
    acc.set(code, entry)
  }
  const stations: SinexStation[] = []
  for (const s of acc.values()) {
    if (s.x === undefined || s.y === undefined || s.z === undefined) continue
    const geo = ecefToGeodetic(s.x, s.y, s.z)
    stations.push({
      code: s.code,
      x: s.x,
      y: s.y,
      z: s.z,
      latDeg: geo.latDeg,
      lonDeg: geo.lonDeg,
      heightM: geo.heightM,
      sigma3dMm: Math.sqrt((s.xs ?? 0) ** 2 + (s.ys ?? 0) ** 2 + (s.zs ?? 0) ** 2) * 1000,
    })
  }
  if (stations.length === 0) throw new Error('No STAX/STAY/STAZ estimates found in the SOLUTION/ESTIMATE block.')
  return { kind: 'sinex_view', stations }
}
