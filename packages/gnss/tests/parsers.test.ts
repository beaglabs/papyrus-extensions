import { describe, expect, it } from 'vitest'
import { parseNmea, parseOmm, parseSinex, parseSp3, parseTle } from '../src/parsers.js'

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537`

const ISS_OMM = `<omm id="CCSDS_OMM_VERS" version="2.0"><body><segment><metadata>
  <OBJECT_NAME>ISS (ZARYA)</OBJECT_NAME><OBJECT_ID>1998-067A</OBJECT_ID>
</metadata><data><meanElements>
  <EPOCH>2008-09-20T12:25:40.104192</EPOCH>
  <MEAN_MOTION>15.72125391</MEAN_MOTION>
  <ECCENTRICITY>0.0006703</ECCENTRICITY>
  <INCLINATION>51.6416</INCLINATION>
  <RA_OF_ASC_NODE>247.4627</RA_OF_ASC_NODE>
  <ARG_OF_PERICENTER>130.5360</ARG_OF_PERICENTER>
  <MEAN_ANOMALY>325.0288</MEAN_ANOMALY>
</meanElements><tleParameters>
  <NORAD_CAT_ID>25544</NORAD_CAT_ID><ELEMENT_SET_NO>292</ELEMENT_SET_NO>
  <REV_AT_EPOCH>56353</REV_AT_EPOCH><BSTAR>-0.11606E-4</BSTAR>
  <MEAN_MOTION_DOT>-0.00002182</MEAN_MOTION_DOT><MEAN_MOTION_DDOT>0.0</MEAN_MOTION_DDOT>
</tleParameters></data></segment></body></omm>`

const SP3 = `#dP2024  9 30  0  0  0.00000000       9 d+D   IGS20 BHN ORBVW
*  2024  9 30  0  0  0.00000000
PG01  15600.123456 -20100.654321  -8100.111111    12.345678
PG02  -9800.222222  16200.333333  19900.444444   -45.678901
*  2024  9 30  0 15  0.00000000
PG01  16200.223456 -18900.554321  -9500.211111    12.355678
PG02 -11200.322222  15100.433333  20400.544444   -45.688901`

const NMEA = `$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A
$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
$GPGSV,3,1,11,03,03,111,00,04,15,270,32,06,01,010,12,13,06,292,28*74
$GPGSV,3,2,11,14,25,170,41,16,57,208,45,18,67,296,44,19,40,246,38*72`

const SINEX = `+SOLUTION/ESTIMATE
*INDEX TYPE__ CODE PT SOLN _REF_EPOCH__ UNIT S __ESTIMATED_VALUE____ __STD_DEV__
     1 STAX   ALGO  A    1 24:001:00000 m    2  0.918129423000000E+06 0.00042
     2 STAY   ALGO  A    1 24:001:00000 m    2 -0.434608809000000E+07 0.00051
     3 STAZ   ALGO  A    1 24:001:00000 m    2  0.465851677000000E+07 0.00048
     4 STAX   WTZR  A    1 24:001:00000 m    2  0.405669830000000E+07 0.00038
     5 STAY   WTZR  A    1 24:001:00000 m    2  0.931982770000000E+06 0.00040
     6 STAZ   WTZR  A    1 24:001:00000 m    2  0.480409330000000E+07 0.00045
-SOLUTION/ESTIMATE`

describe('parseTle', () => {
  it('returns an orbit_view with classical elements and a ground track', () => {
    const view = parseTle(ISS_TLE)
    expect(view.kind).toBe('orbit_view')
    expect(view.source).toBe('tle')
    expect(view.object.noradId).toBe(25544)
    expect(view.elements.inclinationDeg).toBeCloseTo(51.6416, 3)
    expect(view.elements.eccentricity).toBeCloseTo(0.0006703, 6)
    expect(view.groundTrack.length).toBeGreaterThan(100)
    expect(view.subpoint.altKm).toBeGreaterThan(300)
    expect(view.subpoint.altKm).toBeLessThan(500)
  })

  it('throws on input without both TLE lines', () => {
    expect(() => parseTle('not a tle')).toThrow()
  })
})

describe('parseOmm', () => {
  it('rebuilds the orbit and matches the native TLE ground track', () => {
    const omm = parseOmm(ISS_OMM)
    const tle = parseTle(ISS_TLE)
    expect(omm.kind).toBe('orbit_view')
    expect(omm.source).toBe('omm')
    expect(omm.object.noradId).toBe(25544)
    expect(omm.elements.inclinationDeg).toBeCloseTo(tle.elements.inclinationDeg, 4)
    // Compare a few sub-points (both propagate from "now", so index-aligned).
    const n = Math.min(omm.groundTrack.length, tle.groundTrack.length)
    let maxDelta = 0
    for (let i = 0; i < n; i += 20) {
      const a = tle.groundTrack[i]!
      const b = omm.groundTrack[i]!
      maxDelta = Math.max(maxDelta, Math.hypot(a.lat - b.lat, a.lon - b.lon))
    }
    expect(maxDelta).toBeLessThan(0.05)
  })

  it('throws when a required mean element is missing', () => {
    expect(() => parseOmm('<omm><INCLINATION>51.6</INCLINATION></omm>')).toThrow(/missing required field/)
  })
})

describe('parseSp3', () => {
  it('parses epochs and per-satellite ECEF tracks', () => {
    const view = parseSp3(SP3)
    expect(view.kind).toBe('sp3_view')
    expect(view.header.epochCount).toBe(2)
    expect(view.header.satelliteIds).toEqual(['G01', 'G02'])
    const g01 = view.satellites.find((s) => s.id === 'G01')
    expect(g01?.points).toHaveLength(2)
    expect(g01?.points[0]?.xKm).toBeCloseTo(15600.123456, 6)
    expect(g01?.points[0]?.yKm).toBeCloseTo(-20100.654321, 6)
  })
})

describe('parseNmea', () => {
  it('parses a track and satellites in view', () => {
    const view = parseNmea(NMEA)
    expect(view.kind).toBe('nmea_view')
    expect(view.fixCount).toBeGreaterThanOrEqual(2)
    expect(view.track[0]?.lat).toBeCloseTo(48.1173, 3)
    expect(view.track[0]?.lon).toBeCloseTo(11.5167, 3)
    expect(view.satCount).toBe(8)
    const prn16 = view.satellites.find((s) => s.prn === '16')
    expect(prn16).toEqual({ prn: '16', elevationDeg: 57, azimuthDeg: 208, snrDbHz: 45 })
  })
})

describe('parseSinex', () => {
  it('parses stations and converts ECEF to geodetic', () => {
    const view = parseSinex(SINEX)
    expect(view.kind).toBe('sinex_view')
    expect(view.stations.map((s) => s.code)).toEqual(['ALGO', 'WTZR'])
    const wtzr = view.stations.find((s) => s.code === 'WTZR')
    // Wettzell, Germany is ~49.1 N, 12.9 E.
    expect(wtzr?.latDeg).toBeGreaterThan(48)
    expect(wtzr?.latDeg).toBeLessThan(50.5)
    expect(wtzr?.sigma3dMm).toBeGreaterThan(0)
  })
})
