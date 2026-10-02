import { z } from 'zod'
import { finite, expression, evaluate, inline } from './common.js'
const inputSchema=z.object({tracks:z.array(z.object({id:z.string(),position:z.tuple([expression,expression,expression]),radius:finite.positive().default(0.1)}).strict()).min(1).max(32)}).strict()
const parameters=z.object({start:finite.default(0),end:finite.default(10),samples:z.number().int().min(2).max(2000).default(301)}).strict().refine(p=>p.end>p.start,'end must exceed start')
const output=z.object({times:z.array(finite),tracks:z.array(z.object({id:z.string(),positions:z.array(z.tuple([finite,finite,finite])),radius:finite}))})
export const animation=inline({id:'animation.parametric',title:'Parametric animation',description:'Sample a safe expression AST over time into shared scene tracks. No generated code execution.',inputSchema,parameterSchema:parameters,outputSchema:output,
 execute:(raw,p)=>{const input=inputSchema.parse(raw),params=parameters.parse(p);const times=Array.from({length:params.samples},(_,i)=>params.start+(params.end-params.start)*i/(params.samples-1));const data={times,tracks:input.tracks.map(track=>({id:track.id,radius:track.radius,positions:times.map(t=>track.position.map(e=>evaluate(e,{t})) as [number,number,number])}))};return{data,views:[{id:'animation',kind:'animation',title:'Parametric motion',...data}]}}})
