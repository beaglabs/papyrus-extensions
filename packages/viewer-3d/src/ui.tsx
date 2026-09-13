import type { FC } from 'react'
import type { ExtensionUiProvider } from 'papyrus-extension-sdk'
import type { Viewer3DView } from './index.js'

/**
 * papyrus-viewer-3d/ui
 *
 * The `viewer_3d` card. This is intentionally a dependency-free placeholder: it
 * summarizes the deterministic scene and names the expected renderer. A supply-
 * chain reviewed WebGL engine (three.js / Cesium / deck.gl) is added behind this
 * same card in a follow-up, so every domain pack renders 3D through one vetted
 * engine instead of bundling its own. Nothing here reaches outside the browser or
 * mutates state; the scene is read-only, deterministic input.
 *
 * Colors use the shadcn theme tokens so the card follows the host light/dark theme.
 */

const shell: React.CSSProperties = {
  border: '1px solid hsl(var(--border))',
  borderRadius: 10,
  padding: 12,
  margin: '8px 0',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--card-foreground))',
}
const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  color: 'hsl(var(--muted-foreground))',
}
const note: React.CSSProperties = { marginTop: 8, fontSize: 12, color: 'hsl(var(--muted-foreground))' }

const Viewer3DCard: FC<{ output: Viewer3DView }> = ({ output }) => {
  const objects = output.scene?.objects ?? []
  const counts = objects.reduce<Record<string, number>>((acc, o) => {
    acc[o.type] = (acc[o.type] ?? 0) + 1
    return acc
  }, {})
  const summary = Object.entries(counts).map(([type, n]) => `${n} ${type}`).join(' · ') || 'empty scene'
  return (
    <div style={shell}>
      <div style={eyebrow}>3D VIEWER · {output.renderer}</div>
      <h3 style={{ margin: '4px 0 8px' }}>{output.title}</h3>
      <p style={{ margin: 0, fontSize: 13 }}>
        Scene: {summary}
        {output.scene?.frame ? ` · frame ${output.scene.frame}` : ''} · units {output.scene?.units ?? 'unknown'}.
      </p>
      <p style={note}>
        Interactive rendering is provided by the shared, supply-chain-reviewed 3D engine (added in a
        follow-up). Until then this card summarizes the deterministic scene the pack produced.
      </p>
    </div>
  )
}

export const viewer3dUiProvider: ExtensionUiProvider<FC<{ output: Viewer3DView }>> = {
  name: 'papyrus-viewer-3d',
  version: '0.1.0',
  cards: [{ kind: 'viewer_3d', component: Viewer3DCard }],
}
