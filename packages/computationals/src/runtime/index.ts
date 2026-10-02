import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { WorkbenchOutput } from 'papyrus-rendering'
import { bytes, canonical, hash, pointer } from './canonical.js'
import type { ComputationalResult, PipelineNode, PipelineResult, RunRequest, ComputationalOperator, WorkerAdapter } from './types.js'
export type * from './types.js'

const bindingSchema = z.object({node:z.string().min(1), pointer:z.string().optional()}).strict()
const requestSchema = z.object({operator:z.string().min(1), input:z.unknown(), parameters:z.unknown().optional(), seed:z.number().int().nonnegative().max(0xffffffff).optional()}).strict()
const nodeSchema = z.object({id:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),operator:z.string(),input:z.unknown().optional(),parameters:z.unknown().optional(),bindings:z.record(z.string(),bindingSchema).optional(),seed:z.number().int().nonnegative().max(0xffffffff).optional()}).strict()

/** Bounded, per-runtime cache. Never shared across tenants unless the host explicitly shares a runtime. */
export class ComputationalsRuntime {
  private readonly operators = new Map<string, ComputationalOperator>()
  private readonly cache = new Map<string, {value: ComputationalResult; size:number}>()
  private cacheBytes = 0
  constructor(private readonly options: {worker?: WorkerAdapter; maxCacheBytes?: number; maxPipelineNodes?: number; maxPipelineBytes?: number} = {}) {}
  register(operator: ComputationalOperator): this {
    if (this.operators.has(operator.id)) throw new Error(`Duplicate operator ${operator.id}`)
    if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(operator.id)) throw new Error('Invalid operator id')
    for (const value of Object.values(operator.limits)) if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid operator limits')
    this.operators.set(operator.id, operator)
    return this
  }
  describe(id?: string): unknown {
    const operators = id ? [this.lookup(id)] : [...this.operators.values()]
    return {kind:'computational_catalog', operators:operators.map(op=>({id:op.id,version:op.version,title:op.title,description:op.description,backend:op.backend,backendVersion:op.backendVersion,determinism:op.determinism,limits:op.limits,available:op.backend !== 'sandboxed_worker' || Boolean(this.options.worker),inputSchema:z.toJSONSchema(op.inputSchema),parameterSchema:z.toJSONSchema(op.parameterSchema),outputSchema:z.toJSONSchema(op.outputSchema)}))}
  }
  clearCache(): void {this.cache.clear(); this.cacheBytes = 0}
  private lookup(id: string): ComputationalOperator { const op = this.operators.get(id); if (!op) throw new Error(`Unknown operator ${id}`); return op }
  async run(raw: RunRequest, signal?: AbortSignal): Promise<ComputationalResult> {
    canonical(raw)
    const request = requestSchema.parse(raw)
    const op = this.lookup(request.operator)
    if (bytes(request) > op.limits.maxInputBytes) throw new Error('Operator input byte limit exceeded')
    const input = op.inputSchema.parse(request.input)
    const parameters = op.parameterSchema.parse(request.parameters ?? {})
    if (op.determinism === 'stochastic' && request.seed === undefined) throw new Error('Stochastic operators require an explicit seed')
    if (op.backend === 'sandboxed_worker' && (!this.options.worker || this.options.worker.isolated !== true)) throw new Error(`${op.id} requires a host-provided isolated worker`)
    signal?.throwIfAborted()
    const backendVersion = op.backend === 'sandboxed_worker' ? this.options.worker!.identity : op.backendVersion
    const inputHash = hash({input,parameters,seed:request.seed ?? null})
    const key = hash({operator:op.id,version:op.version,backendVersion,inputHash})
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached)
      const result = structuredClone(cached.value)
      result.provenance = result.provenance.map(p=>({...p,cached:true,durationMs:0}))
      return result
    }
    const controller = new AbortController()
    const onAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort',onAbort,{once:true})
    const started = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    let onExecutionAbort: (()=>void) | undefined
    try {
      const aborted = new Promise<never>((_,reject)=>{
        onExecutionAbort = () => reject(controller.signal.reason ?? new Error('Aborted'))
        controller.signal.addEventListener('abort',onExecutionAbort,{once:true})
        timer = setTimeout(()=>controller.abort(new Error(`Operator timeout: ${op.id}`)),op.limits.timeoutMs)
      })
      const payload = await Promise.race([Promise.resolve().then(()=>op.execute(input,parameters,{signal:controller.signal,...(request.seed === undefined ? {} : {seed:request.seed}),...(this.options.worker ? {worker:this.options.worker} : {})})),aborted])
      controller.signal.throwIfAborted()
      if (bytes(payload) > op.limits.maxOutputBytes) throw new Error('Operator output byte limit exceeded')
      const data = op.outputSchema.parse(payload.data)
      const artifacts = (payload.artifacts ?? []).map(artifact=>{
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(artifact.name) || !['utf8','base64'].includes(artifact.encoding)) throw new Error('Unsafe artifact name or encoding')
        const content = Buffer.from(artifact.content,artifact.encoding === 'utf8' ? 'utf8' : 'base64')
        return {...artifact,sha256:createHash('sha256').update(content).digest('hex'),byteLength:content.length}
      })
      const validation = payload.validation ?? {passed:true,metrics:{},warnings:[]}
      const views = payload.views ?? []
      const result: ComputationalResult = {kind:'computational_result',title:op.title,data,views,artifacts,validation,provenance:[{operator:op.id,version:op.version,backend:op.backend,backendVersion,inputHash,outputHash:hash({data,views,artifacts,validation}),parameters:parameters as Record<string,unknown>,durationMs:performance.now()-started,cached:false}]}
      const size = bytes(result), max = this.options.maxCacheBytes ?? 16_000_000
      if (validation.passed && size <= max) {
        while(this.cache.size && this.cacheBytes + size > max) {const oldest=this.cache.keys().next().value!;this.cacheBytes -= this.cache.get(oldest)!.size;this.cache.delete(oldest)}
        this.cache.set(key,{value:structuredClone(result),size}); this.cacheBytes += size
      }
      return result
    } finally {if(timer)clearTimeout(timer); if(onExecutionAbort)controller.signal.removeEventListener('abort',onExecutionAbort);signal?.removeEventListener('abort',onAbort)}
  }
  async pipeline(rawNodes: PipelineNode[], signal?: AbortSignal): Promise<PipelineResult> {
    canonical(rawNodes)
    if (bytes(rawNodes) > (this.options.maxPipelineBytes ?? 32_000_000)) throw new Error('Pipeline input byte limit exceeded')
    const nodes = z.array(nodeSchema).min(1).max(this.options.maxPipelineNodes ?? 64).parse(rawNodes)
    const byId = new Map(nodes.map(node=>[node.id,node]))
    if (byId.size !== nodes.length) throw new Error('Duplicate pipeline node id')
    const order:string[] = [], active = new Set<string>(), visited = new Set<string>()
    const visit = (id:string) => {
      if (active.has(id)) throw new Error('Pipeline contains a cycle')
      if (visited.has(id)) return
      const node = byId.get(id); if(!node)throw new Error(`Unknown dependency ${id}`)
      this.lookup(node.operator)
      active.add(id)
      for (const [key,binding] of Object.entries(node.bindings ?? {})) {
        if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe binding key')
        visit(binding.node)
      }
      active.delete(id);visited.add(id);order.push(id)
    }
    nodes.forEach(node=>visit(node.id))
    const results:Record<string,ComputationalResult> = {}, views:WorkbenchOutput['views'] = [], artifacts:WorkbenchOutput['artifacts'] = [], provenance:WorkbenchOutput['provenance'] = []
    let size = 0
    for(const id of order) {
      signal?.throwIfAborted()
      const node = byId.get(id)!
      let input:unknown = node.input ?? {}
      if(node.bindings && Object.keys(node.bindings).length) {
        if(typeof input !== 'object' || input === null || Array.isArray(input))throw new Error('Bindings require an object input')
        input = {...input}
        for(const [key,binding] of Object.entries(node.bindings)) (input as Record<string,unknown>)[key] = pointer(results[binding.node]!.data,binding.pointer)
      }
      const result = await this.run({operator:node.operator,input,...(node.parameters === undefined?{}:{parameters:node.parameters}),...(node.seed === undefined?{}:{seed:node.seed})},signal)
      size += bytes(result)
      if(size > (this.options.maxPipelineBytes ?? 32_000_000))throw new Error('Pipeline output byte limit exceeded')
      if(!result.validation.passed)throw new Error(`Validation failed at node ${id}; downstream nodes were not executed`)
      results[id]=result
      views.push(...result.views.map(v=>({...v,id:`${id}:${v.id}`})))
      artifacts.push(...result.artifacts.map(a=>({...a,id:`${id}:${a.id}`})))
      provenance.push(...result.provenance)
    }
    return {kind:'computational_pipeline',title:'Computationals computation graph',nodes:results,order,data:Object.fromEntries(order.map(id=>[id,results[id]!.data])),views,artifacts,provenance,validation:{passed:true,metrics:{nodes:order.length},warnings:order.flatMap(id=>results[id]!.validation.warnings)}}
  }
}
