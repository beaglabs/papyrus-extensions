/**
 * papyrus-viewer-3d (package entry, type-only)
 *
 * A renderer-agnostic 3D scene contract shared by Papyrus domain packs, plus the
 * `viewer_3d` UI card kind. Packs (e.g. papyrus-gnss) produce a Viewer3DView from
 * deterministic, read-only data; the card in ./ui renders it. Keeping the scene
 * contract and the single 3D engine here means each pack does not bundle its own
 * WebGL runtime.
 *
 * - Web side: import { viewer3dUiProvider } from 'papyrus-viewer-3d/ui'
 *
 * Type-only: no runtime dependencies (no React, no engine), so it is safe to
 * import anywhere that only needs the contract types.
 */

/** The single `output.kind` this primitive contributes. */
export const VIEWER3D_KIND = 'viewer_3d' as const
export type Viewer3DKind = typeof VIEWER3D_KIND

export interface Viewer3DVector {
  x: number
  y: number
  z: number
}

export type Viewer3DObject =
  | { type: 'points'; id: string; label?: string; color?: string; points: Viewer3DVector[] }
  | { type: 'path'; id: string; label?: string; color?: string; points: Viewer3DVector[] }
  | { type: 'sphere'; id: string; label?: string; color?: string; center: Viewer3DVector; radiusKm: number }

export interface Viewer3DScene {
  /** Unit hint for downstream renderers; scenes are deterministic and read-only. */
  units: 'km' | 'm' | 'normalized'
  /** Optional reference frame label (e.g. 'ECEF', 'ECI'). */
  frame?: string
  objects: Viewer3DObject[]
  /** Optional camera hint; renderers may ignore it. */
  camera?: { target?: Viewer3DVector; distanceKm?: number }
}

/**
 * The kind-tagged tool output rendered by the viewer_3d card. Structurally
 * matches the core Viewer3DCardData contract, so a pack tool can return this
 * and the core card registry will route it by `kind`.
 */
export interface Viewer3DView {
  kind: Viewer3DKind
  renderer: string
  title: string
  scene: Viewer3DScene
  source?: { extension?: string; tool?: string }
}
