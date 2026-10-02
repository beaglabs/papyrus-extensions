import type { z } from 'zod'
import type { Artifact, ScientificView, WorkbenchOutput } from 'papyrus-rendering'
export type OperatorPayload = {
  data: unknown
  views?: ScientificView[]
  artifacts?: Omit<Artifact, 'sha256' | 'byteLength'>[]
  validation?: WorkbenchOutput['validation']
}
export type ComputeLimits = { timeoutMs: number; memoryMb: number; maxInputBytes: number; maxOutputBytes: number }
export interface WorkerAdapter {
  /** Pinned image digest / solver environment identity, included in every cache key. */
  readonly identity: string
  readonly isolated: true
  run(request: { protocol: 1; operator: string; input: unknown; parameters: unknown; seed?: number }, limits: ComputeLimits, signal?: AbortSignal): Promise<OperatorPayload>
}
export interface OperatorContext { signal: AbortSignal; seed?: number; worker?: WorkerAdapter }
export interface ComputationalOperator {
  id: string
  version: string
  title: string
  description: string
  backend: 'typescript' | 'wasm' | 'sandboxed_worker'
  backendVersion: string
  determinism: 'deterministic' | 'numerical' | 'stochastic'
  limits: ComputeLimits
  inputSchema: z.ZodType
  parameterSchema: z.ZodType
  outputSchema: z.ZodType
  execute(input: unknown, parameters: unknown, context: OperatorContext): Promise<OperatorPayload> | OperatorPayload
}
export type RunRequest = { operator: string; input: unknown; parameters?: unknown; seed?: number }
export type PipelineBinding = { node: string; pointer?: string }
export type PipelineNode = { id: string; operator: string; input?: unknown; parameters?: unknown; bindings?: Record<string, PipelineBinding>; seed?: number }
export type ComputationalResult = WorkbenchOutput & { kind: 'computational_result' }
export type PipelineResult = WorkbenchOutput & { kind: 'computational_pipeline'; nodes: Record<string, ComputationalResult>; order: string[] }
