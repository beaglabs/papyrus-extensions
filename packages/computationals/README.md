# Computationals

`papyrus-computationals` is the Papyrus scientific computation extension. It provides a typed operator catalog, bounded execution DAGs, validated results, hashed artifacts and execution provenance.

```ts
import { ComputationalsRuntime, createComputationalRuntime } from 'papyrus-computationals'

const runtime = createComputationalRuntime()
const result = await runtime.run({
  operator: 'plot.chart',
  input: { rows: [{ time: 0, value: 2 }, { time: 1, value: 3 }] },
  parameters: { x: 'time', y: 'value' },
})
```

Implemented inline operators cover charts, scientific series, surfaces, parametric animation and passive circuit templates. A Rapier WASM preset simulates sphere-body trajectories. The shared `papyrus-rendering` package defines result/view contracts.

Python/native scientific operators are currently schemas and adapter contracts. Math, vectorization, mesh, CAD, sensor, geospatial, FEA and SPICE execution requires a host-provided isolated worker implementing the documented request/response types. No solver image or browser workbench is shipped in this checkpoint.

`DockerWorkerAdapter` from `papyrus-computationals/worker` accepts a host-reviewed image pinned by digest. The adapter disables container networking, mounts an ephemeral scratch area, limits resources and exchanges JSON on stdin/stdout. This declaration does not grant application authority; the host must enforce `ExtensionExecutionPolicy` when collecting tools.

The provider exports `computationals.describe`, `computationals.run` and `computationals.pipeline`. Register through `collectExtensionTools` with both the core tool-safety check and an `assertExecutionPolicy` callback. Heavy native operators remain unavailable when the adapter is absent.

This is a development checkpoint of the preserved science work. Backend support is reported by the operator catalog; the UI renderer and native worker implementations remain unfinished.
