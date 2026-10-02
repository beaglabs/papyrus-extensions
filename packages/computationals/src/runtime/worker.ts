import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { ComputeLimits, OperatorPayload, WorkerAdapter } from './types.js'
import { bytes, canonical } from './canonical.js'

/** One disposable OCI container per job. The image must be built/reviewed by the host. */
export class DockerWorkerAdapter implements WorkerAdapter {
  readonly isolated = true as const
  readonly identity: string
  constructor(private readonly image: string) {
    if (!/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Worker image must be pinned by sha256 digest')
    this.identity = image
  }
  async run(request: {protocol:1;operator:string;input:unknown;parameters:unknown;seed?:number}, limits: ComputeLimits, signal?: AbortSignal): Promise<OperatorPayload> {
    signal?.throwIfAborted()
    if(bytes(request)>limits.maxInputBytes)throw new Error('Worker input byte limit exceeded')
    const name=`computationals-${randomUUID()}`
    return new Promise((resolve,reject)=>{
      const child=spawn('docker',['run','--rm','--pull=never','--name',name,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=64',`--memory=${limits.memoryMb}m`,`--memory-swap=${limits.memoryMb}m`,'--cpus=1','--user=65534:65534','--tmpfs=/tmp:rw,noexec,nosuid,size=128m','--env=HOME=/tmp','--env=OPENBLAS_NUM_THREADS=1','--env=OMP_NUM_THREADS=1','--env=PYTHONHASHSEED=0','-i',this.image],{stdio:['pipe','pipe','pipe']})
      const chunks:Buffer[]=[], errors:Buffer[]=[];let count=0,errorCount=0,settled=false
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
      const stop=(cause:unknown)=>{
        if(settled)return;settled=true;cleanup()
        // Killing the CLI alone can leave the container running. Force-remove it by its generated name.
        const removal=spawn('docker',['rm','--force',name],{stdio:'ignore'});removal.on('error',()=>{});removal.unref()
        child.kill('SIGKILL');reject(cause)
      }
      const abort=()=>stop(signal?.reason ?? new Error('Worker aborted'))
      const timer=setTimeout(()=>stop(new Error('Worker deadline exceeded')),limits.timeoutMs)
      signal?.addEventListener('abort',abort,{once:true})
      child.on('error',stop);child.stdin.on('error',stop)
      child.stdout.on('data',(chunk:Buffer)=>{count+=chunk.length;if(count>limits.maxOutputBytes)stop(new Error('Worker output byte limit exceeded'));else chunks.push(chunk)})
      child.stderr.on('data',(chunk:Buffer)=>{errorCount+=chunk.length;if(errorCount<=8192)errors.push(chunk)})
      child.on('close',code=>{
        if(settled)return;settled=true;cleanup()
        if(code!==0){reject(new Error(`Isolated worker exited ${code}: ${Buffer.concat(errors).toString('utf8')}`));return}
        try {
          const response=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {protocol?:number;result?:OperatorPayload;error?:string}
          if(response.protocol!==1 || !response.result || response.error)throw new Error(response.error ?? 'Invalid worker protocol response')
          canonical(response.result);resolve(response.result)
        }catch(cause){reject(cause)}
      })
      child.stdin.end(canonical(request))
    })
  }
}
