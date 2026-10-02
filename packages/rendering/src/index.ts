import { z } from 'zod'

export const vector3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export type Vector3 = z.infer<typeof vector3Schema>
export const meshSchema = z.object({
  type: z.literal('mesh'), units: z.enum(['mm', 'm', 'km', 'normalized']),
  vertices: z.array(vector3Schema).min(1).max(100_000),
  triangles: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(), z.number().int().nonnegative()])).max(200_000),
}).superRefine((mesh, ctx) => {
  if (mesh.triangles.some(face => face.some(i => i >= mesh.vertices.length))) ctx.addIssue({code:'custom', message:'Triangle references a missing vertex'})
})
export type TriangleMesh = z.infer<typeof meshSchema>
export type Series = { name: string; x: number[]; y: number[]; entityIds?: string[] }
export type Artifact = { id: string; name: string; mediaType: string; encoding: 'utf8' | 'base64'; content: string; sha256: string; byteLength: number }
export type Selection = { entityId?: string; time?: number }
export type ScientificView =
  | { id: string; kind: 'chart'; title: string; mark: 'line' | 'bar' | 'point'; x: string; y: string; rows: Record<string, number | string>[]; group?: string }
  | { id: string; kind: 'scientific_plot'; title: string; series: Series[]; xLabel: string; yLabel: string }
  | { id: string; kind: 'surface'; title: string; x: number[]; y: number[]; z: number[][] }
  | { id: string; kind: 'scene_3d'; title: string; mesh?: TriangleMesh; points?: Vector3[]; field?: { name: string; units: string; values: number[] }; entityIds?: string[] }
  | { id: string; kind: 'polygon'; title: string; rings: number[][][]; width?: number; height?: number; raster?: {width:number;height:number;values:number[]} }
  | { id: string; kind: 'map'; title: string; geojson: Record<string, unknown> }
  | { id: string; kind: 'circuit'; title: string; components: CircuitComponent[]; nets: { id: string; ports: string[] }[] }
  | { id: string; kind: 'equation'; title: string; latex: string }
  | { id: string; kind: 'table'; title: string; columns: string[]; rows: (number | string | boolean | null)[][] }
  | { id: string; kind: 'animation'; title: string; times: number[]; tracks: { id: string; positions: Vector3[]; radius: number }[] }
export type CircuitComponent = { id: string; type: 'resistor' | 'capacitor' | 'voltage'; value: number; ports: [string, string] }
export interface WorkbenchOutput {
  kind: 'computational_result' | 'computational_pipeline'
  title: string
  views: ScientificView[]
  artifacts: Artifact[]
  provenance: { operator: string; version: string; backend: string; backendVersion: string; inputHash: string; outputHash: string; durationMs: number; cached: boolean; parameters: Record<string, unknown> }[]
  validation: { passed: boolean; metrics: Record<string, number | string | boolean>; warnings: string[] }
  data: unknown
}
