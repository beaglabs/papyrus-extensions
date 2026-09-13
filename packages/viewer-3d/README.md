# papyrus-viewer-3d

A shared 3D viewer primitive for Papyrus extensions.

It provides:

- a renderer-agnostic, deterministic **scene contract** (`Viewer3DScene`, `Viewer3DObject`, `Viewer3DView`), and
- the **`viewer_3d` UI card** (`viewer3dUiProvider`) that the Papyrus core card registry renders.

Domain packs (e.g. [`papyrus-gnss`](../gnss)) compute a `Viewer3DView` from read-only data and return it from a tool; the core routes it to this card by `kind`. The actual WebGL engine (three.js / Cesium / deck.gl) is added **here**, once, after supply-chain review -- so packs never bundle their own engine and the hardened core never renders 3D itself.

## Web

```ts
import { buildCardRegistry } from 'papyrus-extension-sdk'
import { viewer3dUiProvider } from 'papyrus-viewer-3d/ui'

const registry = buildCardRegistry([viewer3dUiProvider])
// registry['viewer_3d'] -> the card component
```

## Status

Placeholder renderer only: it summarizes the scene (object counts, frame, units). The interactive engine lands in a follow-up behind the same card, after supply-chain review.
