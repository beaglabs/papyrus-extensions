/** Canonical scientific payloads. Values never imply measurements without evidence. */
export type { TriangleMesh, Vector3, ScientificView, Artifact, Series } from 'papyrus-rendering'
export type Measurement = { value: number; units: string; source: 'measured' | 'inferred' | 'assumed' | 'simulated'; uncertainty?: { type: 'interval'; lower: number; upper: number }; evidence?: string[] }
export type Polygon = { type: 'polygon'; units: string; rings: number[][][]; frame: 'image' | 'cartesian'; crs?: string }
export type PointCloud = { type: 'point_cloud'; units: 'm' | 'mm'; points: [number, number, number][]; source: 'measured' | 'reconstructed' | 'simulated' }
export type Expression = { op: 'add' | 'sub' | 'mul' | 'div' | 'pow' | 'sin' | 'cos' | 'exp' | 'log' | 'sqrt' | 'neg'; args: (Expression | number | string)[] }
export type TimeSeries = { type: 'timeseries'; time: number[]; variables: string[]; values: number[][]; units: string[] }
export type Material = { id: string; youngModulusPa: number; poissonRatio: number; densityKgM3?: number }
export type Field = { type: 'field'; association: 'vertex' | 'cell'; meshId: string; name: string; units: string; values: number[] }
export type Circuit = { type: 'circuit'; components: import('papyrus-rendering').CircuitComponent[]; nets: {id:string;ports:string[]}[]; ground: string }
export type CadSolid = { type: 'solid'; units: 'mm'; features: { id: string; operation: string; parameters: Record<string, unknown>; evidence: string[] }[]; measurements: Record<string, Measurement>; mesh: import('papyrus-rendering').TriangleMesh }
