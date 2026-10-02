import { z } from 'zod'
import { vector3Schema } from 'papyrus-rendering'
import { finite, inline } from './common.js'
const inputSchema=z.object({bodies:z.array(z.object({id:z.string(),position:vector3Schema,velocity:vector3Schema.default([0,0,0]),radius:finite.positive(),mass:finite.positive().default(1),fixed:z.boolean().default(false),restitution:finite.min(0).max(1).default(0.2)}).strict()).min(1).max(64)}).strict()
const params=z.object({steps:z.number().int().min(1).max(2000).default(300),dt:finite.positive().max(0.05).default(1/60),gravity:vector3Schema.default([0,-9.81,0]),ground:z.boolean().default(true)}).strict()
export const dynamics={...inline({id:'dynamics.simulate',title:'Rigid-body simulation',description:'Rapier fixed-step sphere bodies, ground collision and explicit trajectories. This v1 preset does not support arbitrary mechanisms.',inputSchema,parameterSchema:params,outputSchema:z.object({times:z.array(finite),tracks:z.array(z.object({id:z.string(),positions:z.array(vector3Schema),radius:finite}))}),
 execute:async(raw,p,ctx)=>{
  const input=inputSchema.parse(raw),parameters=params.parse(p)
  if(new Set(input.bodies.map(b=>b.id)).size!==input.bodies.length)throw new Error('Duplicate body id')
  const {default:RAPIER}=await import('@dimforge/rapier3d-compat');await RAPIER.init()
  const [gx,gy,gz]=parameters.gravity,world=new RAPIER.World({x:gx,y:gy,z:gz});world.timestep=parameters.dt
  try{
   if(parameters.ground)world.createCollider(RAPIER.ColliderDesc.cuboid(10_000,0.1,10_000).setTranslation(0,-0.1,0))
   const bodies=input.bodies.map(b=>{
    const desc=(b.fixed?RAPIER.RigidBodyDesc.fixed():RAPIER.RigidBodyDesc.dynamic()).setTranslation(...b.position).setLinvel(...b.velocity).setCcdEnabled(true)
    const body=world.createRigidBody(desc);world.createCollider(RAPIER.ColliderDesc.ball(b.radius).setMass(b.mass).setRestitution(b.restitution),body);return body
   })
   const times:number[]=[],tracks=input.bodies.map(b=>({id:b.id,positions:[] as [number,number,number][],radius:b.radius}))
   for(let step=0;step<=parameters.steps;step++){
    ctx.signal.throwIfAborted();times.push(step*parameters.dt);bodies.forEach((b,i)=>{const {x,y,z}=b.translation();tracks[i]!.positions.push([x,y,z])});if(step<parameters.steps)world.step()
   }
   const data={times,tracks};return{data,views:[{id:'motion',kind:'animation' as const,title:'Rigid-body trajectories',...data}],validation:{passed:true,metrics:{steps:parameters.steps,timestep:parameters.dt},warnings:['Replay renders sampled solver states; visual interpolation is not a new physics simulation.']}}
  }finally{world.free()}
 }}),backend:'wasm' as const,backendVersion:'rapier3d-compat/0.19.3',determinism:'numerical' as const}
