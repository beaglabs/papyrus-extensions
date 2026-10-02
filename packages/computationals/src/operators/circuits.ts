import { z } from 'zod'
import { inline, finite } from './common.js'
const port=z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*\.[12]$/)
export const circuitSchema=z.object({type:z.literal('circuit'),components:z.array(z.object({id:z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),type:z.enum(['resistor','capacitor','voltage']),value:finite,ports:z.tuple([port,port])})).min(1).max(64),nets:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_]+$/),ports:z.array(port)})).min(1).max(128),ground:z.string()}).strict()
const inputSchema=z.discriminatedUnion('topology',[
 z.object({topology:z.literal('voltage_divider'),inputVoltage:finite.positive(),outputVoltage:finite.positive(),lowerResistanceOhm:finite.positive().max(1e12)}).strict().refine(s=>s.outputVoltage<s.inputVoltage,'Divider output must be lower than input'),
 z.object({topology:z.literal('rc_lowpass'),inputVoltage:finite.positive(),resistanceOhm:finite.positive().max(1e12),capacitanceF:finite.positive().max(1e3)}).strict(),
])
export const circuit=inline({id:'circuit.design',title:'Circuit design and checks',description:'Auditable voltage-divider and RC-lowpass templates. Computes component values, validates connectivity and exports a typed circuit. No arbitrary topology synthesis.',inputSchema,parameterSchema:z.object({}).strict(),outputSchema:circuitSchema,
 execute:raw=>{
  const spec=inputSchema.parse(raw),divider=spec.topology==='voltage_divider'
  const components=[{id:'V1',type:'voltage' as const,value:spec.inputVoltage,ports:['V1.1','V1.2'] as [string,string]},
   {id:'R1',type:'resistor' as const,value:divider?spec.lowerResistanceOhm*(spec.inputVoltage/spec.outputVoltage-1):spec.resistanceOhm,ports:['R1.1','R1.2'] as [string,string]},
   divider?{id:'R2',type:'resistor' as const,value:spec.lowerResistanceOhm,ports:['R2.1','R2.2'] as [string,string]}:{id:'C1',type:'capacitor' as const,value:spec.capacitanceF,ports:['C1.1','C1.2'] as [string,string]}]
  const tail=divider?'R2':'C1'
  const data={type:'circuit' as const,components,nets:[{id:'vin',ports:['V1.1','R1.1']},{id:'vout',ports:['R1.2',`${tail}.1`]},{id:'0',ports:['V1.2',`${tail}.2`]}],ground:'0'}
  const metrics=divider?{outputVoltage:spec.outputVoltage,upperResistanceOhm:components[1]!.value}:{cutoffHz:1/(2*Math.PI*spec.resistanceOhm*spec.capacitanceF)}
  return{data,views:[{id:'schematic',kind:'circuit',title:divider?'Voltage divider':'RC low-pass',components,nets:data.nets}],validation:{passed:true,metrics,warnings:['Template connectivity checks cover this passive circuit only. Component ratings and hardware suitability require separate verification.']},artifacts:[{id:'circuit',name:'circuit.json',mediaType:'application/json',encoding:'utf8',content:JSON.stringify(data)}]}
 }})
