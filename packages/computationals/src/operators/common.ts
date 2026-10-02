import { z } from 'zod'
import type { ComputationalOperator } from '../runtime/types.js'
export const limits = {timeoutMs:30_000,memoryMb:1024,maxInputBytes:8_000_000,maxOutputBytes:16_000_000}
export const finite = z.number().finite()
export const empty = z.object({}).strict()
export const array = z.array(finite).min(1).max(20_000)
export const expression: z.ZodType = z.lazy(()=>z.union([finite,z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/),z.object({op:z.enum(['add','sub','mul','div','pow','sin','cos','exp','log','sqrt','neg']),args:z.array(expression).min(1).max(2)}).strict()]))
export function evaluate(expr: unknown, variables:Record<string,number>, depth=0): number {
  if(depth>32)throw new Error('Expression depth limit exceeded')
  if(typeof expr==='number')return expr
  if(typeof expr==='string'){if(!Object.hasOwn(variables,expr))throw new Error(`Unknown variable ${expr}`);return variables[expr]!}
  const {op,args} = expr as {op:string;args:unknown[]}
  const a=evaluate(args[0],variables,depth+1), b=args.length>1?evaluate(args[1],variables,depth+1):0
  if(['add','sub','mul','div','pow'].includes(op) && args.length!==2)throw new Error('Binary expression requires two arguments')
  if(!['add','sub','mul','div','pow'].includes(op) && args.length!==1)throw new Error('Unary expression requires one argument')
  const result = op==='add'?a+b:op==='sub'?a-b:op==='mul'?a*b:op==='div'?a/b:op==='pow'?a**b:op==='sin'?Math.sin(a):op==='cos'?Math.cos(a):op==='exp'?Math.exp(a):op==='log'?Math.log(a):op==='sqrt'?Math.sqrt(a):op==='neg'?-a:NaN
  if(!Number.isFinite(result))throw new Error('Expression produced a nonfinite value')
  return result
}
export function inline(def:Omit<ComputationalOperator,'version'|'backend'|'backendVersion'|'determinism'|'limits'>):ComputationalOperator {
  return {version:'0.1.0',backend:'typescript',backendVersion:'computationals-ts/0.1.0',determinism:'deterministic',limits,...def}
}
export function worker(def:Omit<ComputationalOperator,'version'|'backend'|'backendVersion'|'determinism'|'limits'|'execute'>):ComputationalOperator {
  return {version:'0.1.0',backend:'sandboxed_worker',backendVersion:'computationals-worker/0.1.0',determinism:'numerical',limits:{...limits,timeoutMs:60_000,memoryMb:2048},...def,
    execute:(input,parameters,ctx)=>ctx.worker!.run({protocol:1,operator:def.id,input,parameters,...(ctx.seed===undefined?{}:{seed:ctx.seed})},{...limits,timeoutMs:60_000,memoryMb:2048},ctx.signal)}
}
