/**
 * papyrus-gnss (package entry, type-only)
 *
 * The default entry re-exports the shared view types and the `kind` union that
 * both the server tools (./tools) and the web cards (./ui) agree on. It has no
 * runtime dependencies (no satellite.js, no React), so it is safe to import
 * from anywhere that only needs the contract types.
 *
 * - Server side:  import { gnssToolProvider } from 'papyrus-gnss/tools'
 * - Web side:     import { gnssUiProvider }   from 'papyrus-gnss/ui'
 */

export type {
  GroundTrackPoint,
  OrbitalElements,
  OrbitView,
  Sp3SatelliteTrack,
  Sp3View,
  NmeaSatellite,
  NmeaView,
  SinexStation,
  SinexView,
  OrbitalView,
} from './parsers.js'

/** The `output.kind` values this extension contributes. */
export const GNSS_KINDS = ['orbit_view', 'sp3_view', 'nmea_view', 'sinex_view'] as const
export type GnssKind = (typeof GNSS_KINDS)[number]
