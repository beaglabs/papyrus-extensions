# papyrus-gnss

GNSS / satellite-orbit extension for the Papyrus agent runtime. Read-only parsers for common orbit and geodetic interchange formats, plus dependency-free SVG viewer cards.

## Formats

| Tool | Format | View `kind` |
| --- | --- | --- |
| `parseTle` | Two-Line Element set | `orbit_view` |
| `parseOmm` | Orbit Mean-Elements Message (KVN/XML) | `orbit_view` |
| `parseSp3` | SP3 precise ephemeris | `sp3_view` |
| `parseNmea` | NMEA 0183 (GGA/RMC/GSV/GSA) | `nmea_view` |
| `parseSinex` | SINEX solution | `sinex_view` |

TLE and OMM ground tracks are propagated with exact SGP4 via `satellite.js`.

## Entry points

- `papyrus-gnss` — shared view types and the `GNSS_KINDS` union (type-only, no runtime deps).
- `papyrus-gnss/tools` — `gnssToolProvider`, the server-side `ExtensionToolProvider` consumed by the core through `collectExtensionTools`.
- `papyrus-gnss/ui` — `gnssUiProvider`, the React card provider consumed by the core through `buildCardRegistry`. Requires `react` (peer).

## Design notes

- Parsers are pure and side-effect free; no network access. They return `kind`-tagged view objects that the cards render.
- Cards are dependency-free inline SVG (equirectangular maps with a graticule), styled with the host's shadcn/Tailwind theme tokens for automatic light/dark. No Plotly, no external map tiles — safe for air-gapped deployments.
- `satellite.js` is the only runtime dependency and is flagged for hardened-image / supply-chain review.

## Out of scope (v0.1)

- SP3 velocity and clock records
- Multi-constellation NMEA talker-id nuances
- Full SINEX covariance blocks
