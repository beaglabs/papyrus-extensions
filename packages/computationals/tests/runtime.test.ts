import { describe, expect, it } from 'vitest'
import { collectExtensionTools } from 'papyrus-extension-sdk'
import { ComputationalsRuntime, createComputationalRuntime, createComputationalsToolProvider } from '../src/index.js'

describe('Computationals runtime', () => {
  it('exports the renamed runtime and describes available backends', () => {
    const runtime = createComputationalRuntime()
    expect(runtime).toBeInstanceOf(ComputationalsRuntime)
    const catalog = runtime.describe() as {operators: {id:string;available:boolean}[]}
    expect(catalog.operators.find(o=>o.id==='plot.chart')?.available).toBe(true)
    expect(catalog.operators.find(o=>o.id==='math.solve')?.available).toBe(false)
    expect(JSON.stringify(catalog)).not.toMatch(/starlings/i)
  })

  it('runs chart operators and hashes independent artifacts', async () => {
    const runtime = createComputationalRuntime()
    const request = {operator:'plot.chart',input:{rows:[{t:0,value:2},{t:1,value:3}]},parameters:{x:'t',y:'value'}}
    const result = await runtime.run(request)
    expect(result.views[0]?.kind).toBe('chart')
    expect(result.artifacts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.provenance[0]?.backendVersion).toBe('computationals-ts/0.1.0')
    const cached = await runtime.run(request)
    expect(cached.provenance[0]?.cached).toBe(true)
    expect(cached.data).toEqual(result.data)
    await expect(runtime.run({...request,input:{rows:[{t:0,value:'not a number'}]}})).rejects.toThrow()
  })

  it('binds pipeline outputs and rejects cycles before execution', async () => {
    const runtime = createComputationalRuntime()
    const result = await runtime.pipeline([
      {id:'a',operator:'plot.chart',input:{rows:[{x:0,y:1}]},parameters:{x:'x',y:'y'}},
      {id:'b',operator:'plot.chart',parameters:{x:'x',y:'y'},bindings:{rows:{node:'a',pointer:'/rows'}}},
    ])
    expect(result.title).toBe('Computationals computation graph')
    expect(result.order).toEqual(['a','b'])
    expect(result.nodes.b?.data).toEqual(result.nodes.a?.data)
    await expect(runtime.pipeline([
      {id:'a',operator:'plot.chart',bindings:{rows:{node:'b',pointer:'/rows'}}},
      {id:'b',operator:'plot.chart',bindings:{rows:{node:'a',pointer:'/rows'}}},
    ])).rejects.toThrow('cycle')
  })

  it('requires host policy enforcement when registering computational tools', () => {
    const provider = createComputationalsToolProvider()
    expect(()=>collectExtensionTools([provider])).toThrow('Host must enforce')
    const enforced:string[] = []
    const tools = collectExtensionTools([provider], {assertExecutionPolicy: (_policy,id)=>enforced.push(id)})
    expect(tools.map(t=>t.id)).toEqual(['computationals.describe','computationals.run','computationals.pipeline'])
    expect(enforced).toEqual(['computationals.run','computationals.pipeline'])
  })

  it('does not execute a solver without the isolated worker adapter', async () => {
    await expect(createComputationalRuntime().run({operator:'math.solve',input:{mode:'linear',matrix:[[1]],rhs:[2]}})).rejects.toThrow('isolated worker')
  })
})
