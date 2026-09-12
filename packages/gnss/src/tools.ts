/**
 * papyrus-gnss/tools
 *
 * Server-side tool provider. Each tool is a read-only parser that returns a
 * `kind`-tagged view object (rendered by the matching card in ./ui). The core
 * runtime consumes this through `collectExtensionTools` + its own createTool, so
 * this module never imports Mastra.
 */
import type { ExtensionToolProvider } from 'papyrus-extension-sdk'
import { parseNmea, parseOmm, parseSinex, parseSp3, parseTle } from './parsers.js'

const asString = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]
  if (typeof value !== 'string') {
    throw new Error(`Expected string input "${key}"`)
  }
  return value
}

export const gnssToolProvider: ExtensionToolProvider = {
  name: 'papyrus-gnss',
  version: '0.1.0',
  tools: [
    {
      id: 'parseTle',
      description:
        'Parse a Two-Line Element set (TLE) and return SGP4 classical orbital elements plus a one-revolution ground track for the orbital viewer. Pass the raw TLE text unchanged.',
      authority: 'read_only',
      inputSchema: {
        type: 'object',
        required: ['tle'],
        additionalProperties: false,
        properties: {
          tle: {
            type: 'string',
            description: 'Raw TLE text: an optional name line, then line 1 ("1 ...") and line 2 ("2 ...").',
          },
        },
      },
      execute: (input) => parseTle(asString(input, 'tle')),
    },
    {
      id: 'parseOmm',
      description:
        'Parse an Orbit Mean-Elements Message (OMM), in KVN or XML form, into the same orbital view as parseTle, including an SGP4 ground track.',
      authority: 'read_only',
      inputSchema: {
        type: 'object',
        required: ['omm'],
        additionalProperties: false,
        properties: {
          omm: { type: 'string', description: 'Raw OMM text (KVN key/value lines or XML).' },
        },
      },
      execute: (input) => parseOmm(asString(input, 'omm')),
    },
    {
      id: 'parseSp3',
      description:
        'Parse an SP3 precise-ephemeris file into per-satellite ECEF position tracks with epochs for the orbital viewer.',
      authority: 'read_only',
      inputSchema: {
        type: 'object',
        required: ['sp3'],
        additionalProperties: false,
        properties: {
          sp3: { type: 'string', description: 'Raw SP3 (a/c/d) file text.' },
        },
      },
      execute: (input) => parseSp3(asString(input, 'sp3')),
    },
    {
      id: 'parseNmea',
      description:
        'Parse NMEA 0183 sentences (GGA/RMC/GSV/GSA) into a fix summary, position, and satellites-in-view for the GNSS viewer.',
      authority: 'read_only',
      inputSchema: {
        type: 'object',
        required: ['nmea'],
        additionalProperties: false,
        properties: {
          nmea: { type: 'string', description: 'Raw NMEA 0183 sentence log (one sentence per line).' },
        },
      },
      execute: (input) => parseNmea(asString(input, 'nmea')),
    },
    {
      id: 'parseSinex',
      description:
        'Parse a SINEX solution file into station coordinates (with geodetic lat/lon) for the geodetic map view.',
      authority: 'read_only',
      inputSchema: {
        type: 'object',
        required: ['sinex'],
        additionalProperties: false,
        properties: {
          sinex: { type: 'string', description: 'Raw SINEX (.snx) file text.' },
        },
      },
      execute: (input) => parseSinex(asString(input, 'sinex')),
    },
  ],
}
