# papyrus-extensions

Extension SDK and domain packages for the [Papyrus](https://github.com/beaglabs/papyrus) agent runtime.

Papyrus extensions are versioned NPM packages that add **read-only agent tools** and their **UI renderers** to the core runtime **without modifying the hardened core**. This keeps the security-critical control plane small and lets stakeholders iterate on domain packs behind a stable, authority-limited contract.

## Packages

| Package | Purpose |
| --- | --- |
| [`papyrus-extension-sdk`](./packages/extension-sdk) | Framework-free contract between core and extensions. No runtime deps; does not import React or Mastra. |
| [`papyrus-gnss`](./packages/gnss) | First domain pack: GNSS / satellite-orbit parsers (TLE, OMM, SP3, NMEA, SINEX) and SVG viewer cards. |
| [`papyrus-viewer-3d`](./packages/viewer-3d) | Shared 3D viewer primitive: a renderer-agnostic scene contract and the `viewer_3d` card. Domain packs emit typed scenes; the WebGL engine is vendored here once, after review, so no pack bundles its own. |

## The contract

An extension exposes two optional providers:

- **Tool provider** (server): an `ExtensionToolProvider` — a named, versioned set of `ExtensionTool` descriptors `{ id, description, inputSchema, execute }`. Tools are read-only and side-effect free.
- **UI provider** (web): an `ExtensionUiProvider<Component>` — a set of cards mapping an output `kind` to a component that renders it.

The core wires them in with two helpers:

```ts
// apps/server (Mastra) — register tools through the core's own createTool + safety gate
import { collectExtensionTools } from 'papyrus-extension-sdk'
import { gnssToolProvider } from 'papyrus-gnss/tools'

for (const tool of collectExtensionTools([gnssToolProvider], { assertSafe: assertAgentSafeTool })) {
  registered[tool.id] = createTool({ ...tool, execute: (input) => tool.execute(input) })
}
```

```ts
// apps/web (React) — build a kind -> card registry for MessagePart
import { buildCardRegistry } from 'papyrus-extension-sdk'
import { gnssUiProvider } from 'papyrus-gnss/ui'

const EXTENSION_CARDS = buildCardRegistry([gnssUiProvider])
// MessagePart: const Card = EXTENSION_CARDS[output.kind]; if (Card) return <Card output={output} />
```

## Security model

- Extensions may only contribute **read-only** tools. `collectExtensionTools` rejects any tool that declares non-read-only authority and runs every tool id through the core's `assertAgentSafeTool` gate, so an extension can never register a forbidden, authority-bearing tool.
- Tool ids and card kinds are de-duplicated at load; collisions throw rather than silently shadow.
- Each package is vendored and supply-chain reviewed per release, the same as any core dependency.

## Adding an extension

1. Create `packages/<name>` with a `package.json`, `tsconfig.json`, and `src/`.
2. Export an `ExtensionToolProvider` from `./tools` and/or an `ExtensionUiProvider` from `./ui`.
3. Return `kind`-tagged objects from tools and register a card for each `kind`.
4. Add the package to core `papyrus` and include its provider(s) in the arrays above.

## Development

```bash
pnpm install
pnpm -r run build
pnpm -r run typecheck
pnpm -r run test
```
