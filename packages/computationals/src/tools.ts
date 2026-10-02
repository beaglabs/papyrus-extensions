import type { ExtensionExecutionPolicy, ExtensionToolProvider } from 'papyrus-extension-sdk'
import { z } from 'zod'
import { ComputationalsRuntime } from './runtime/index.js'
import type { PipelineNode, WorkerAdapter } from './runtime/types.js'
import { chart, scientific, surface } from './operators/plots.js'
import { animation } from './operators/animation.js'
import { dynamics } from './operators/dynamics.js'
import { circuit } from './operators/circuits.js'
import { workerOperators } from './operators/worker-operators.js'
export function createComputationalRuntime(options: {worker?:WorkerAdapter;maxCacheBytes?:number} = {}):ComputationalsRuntime {
 const runtime=new ComputationalsRuntime(options)
 for(const operator of [chart,scientific,surface,animation,dynamics,circuit,...workerOperators])runtime.register(operator)
 return runtime
}
export const computationalExecutionPolicy:ExtensionExecutionPolicy={authority:'read_only',compute:{backend:'sandboxed_worker',network:false,filesystem:'ephemeral',maxMemoryMb:2048,maxCpuSeconds:60,artifactOutput:true}}
export function createComputationalsToolProvider(runtime=createComputationalRuntime()):ExtensionToolProvider {
 return{name:'papyrus-computationals',version:'0.1.0',tools:[
  {id:'computationals.describe',description:'Discover Computationals operators, exact schemas, backend availability and bounded supported modes.',authority:'read_only',inputSchema:{type:'object',properties:{operator:{type:'string'}},additionalProperties:false},execute:raw=>{const input=z.object({operator:z.string().optional()}).strict().parse(raw);return runtime.describe(input.operator)}},
  {id:'computationals.run',description:'Execute a schema-validated scientific operator. Returns data, linked views, exports, validation and reproducible provenance.',authority:'read_only',executionPolicy:computationalExecutionPolicy,inputSchema:{type:'object',required:['operator','input'],properties:{operator:{type:'string'},input:{},parameters:{type:'object'},seed:{type:'integer',minimum:0}},additionalProperties:false},execute:raw=>runtime.run(raw as unknown as Parameters<ComputationalsRuntime['run']>[0])},
  {id:'computationals.pipeline',description:'Run a bounded operator DAG. Bind downstream input fields to upstream data using node ids and JSON Pointers. Failed validation stops downstream execution.',authority:'read_only',executionPolicy:computationalExecutionPolicy,inputSchema:{type:'object',required:['nodes'],properties:{nodes:{type:'array',minItems:1,maxItems:64,items:{type:'object',required:['id','operator'],properties:{id:{type:'string'},operator:{type:'string'},input:{},parameters:{type:'object'},bindings:{type:'object',additionalProperties:{type:'object',required:['node'],properties:{node:{type:'string'},pointer:{type:'string'}},additionalProperties:false}},seed:{type:'integer'}},additionalProperties:false}}},additionalProperties:false},execute:raw=>{const input=z.object({nodes:z.array(z.unknown())}).strict().parse(raw);return runtime.pipeline(input.nodes as PipelineNode[])}},
 ]}
}
