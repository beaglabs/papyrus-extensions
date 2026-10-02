import { useEffect, useRef, useState, type CSSProperties, type FC } from 'react'
import type { ExtensionUiProvider } from 'papyrus-extension-sdk'
import type { Viewer3DObject, Viewer3DVector, Viewer3DView } from './index.js'

/**
 * Shared Papyrus WebGL renderer.
 *
 * This intentionally uses the browser WebGL API directly instead of pulling in
 * a second rendering runtime. That keeps the viewer deterministic, air-gap
 * friendly, and small enough to review as part of the hardened image. Extension
 * packs only emit the scene contract; they never execute renderer code.
 */

const shell: CSSProperties = {
  overflow: 'hidden',
  border: '2px solid #111',
  borderRadius: 10,
  margin: '8px 0',
  background: 'hsl(var(--card))',
  color: 'hsl(var(--card-foreground))',
  boxShadow: '4px 4px 0 #111',
}
const header: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 14px 10px',
  borderBottom: '2px solid #111',
}
const eyebrow: CSSProperties = {
  fontSize: 10,
  fontWeight: 850,
  letterSpacing: '0.1em',
  color: 'hsl(var(--muted-foreground))',
}
const toolbar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  padding: '8px 12px',
  borderTop: '2px solid #111',
  background: 'hsl(var(--muted))',
  fontSize: 10,
  fontWeight: 750,
}

interface DrawItem {
  mode: number
  position: WebGLBuffer
  normal?: WebGLBuffer
  count: number
  color: [number, number, number, number]
  pointSize: number
  lit: boolean
  roundPoint: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function subtract(a: Viewer3DVector, b: Viewer3DVector): Viewer3DVector {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}
function dot(a: Viewer3DVector, b: Viewer3DVector): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
function cross(a: Viewer3DVector, b: Viewer3DVector): Viewer3DVector {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function normalize(v: Viewer3DVector): Viewer3DVector {
  const length = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

function perspective(fovRadians: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovRadians / 2)
  const range = 1 / (near - far)
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * range, -1,
    0, 0, 2 * far * near * range, 0,
  ])
}

function lookAt(eye: Viewer3DVector, target: Viewer3DVector, up: Viewer3DVector): Float32Array {
  const z = normalize(subtract(eye, target))
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  return new Float32Array([
    x.x, y.x, z.x, 0,
    x.y, y.y, z.y, 0,
    x.z, y.z, z.z, 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ])
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3]
    }
  }
  return out
}

function color(value?: string, alpha = 1): [number, number, number, number] {
  const named: Record<string, string> = {
    blue: '#2f7dd1', cyan: '#5fd7ff', green: '#58c87a', orange: '#ff7a18', red: '#ff5a5f', white: '#ffffff', yellow: '#ffd166',
  }
  const source = (value ? named[value.toLowerCase()] ?? value : '#ffffff').trim()
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(source)
  if (!match?.[1]) return [1, 1, 1, alpha]
  const raw = match[1].length === 3 ? [...match[1]].map((ch) => ch + ch).join('') : match[1]
  return [Number.parseInt(raw.slice(0, 2), 16) / 255, Number.parseInt(raw.slice(2, 4), 16) / 255, Number.parseInt(raw.slice(4, 6), 16) / 255, alpha]
}

function shader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type)
  if (!result) throw new Error('Unable to allocate WebGL shader')
  gl.shaderSource(result, source)
  gl.compileShader(result)
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(result) || 'Unknown shader compilation failure'
    gl.deleteShader(result)
    throw new Error(message)
  }
  return result
}

function program(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLProgram {
  const vertex = shader(gl, gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat4 uMvp;
    uniform float uPointSize;
    uniform float uLit;
    varying float vLight;
    void main() {
      gl_Position = uMvp * vec4(aPosition, 1.0);
      gl_PointSize = uPointSize;
      vec3 n = normalize(aNormal);
      float diffuse = max(dot(n, normalize(vec3(0.45, 0.65, 1.0))), 0.0);
      vLight = mix(1.0, 0.30 + 0.70 * diffuse, uLit);
    }
  `)
  const fragment = shader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    uniform vec4 uColor;
    uniform float uRoundPoint;
    varying float vLight;
    void main() {
      if (uRoundPoint > 0.5 && distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
      gl_FragColor = vec4(uColor.rgb * vLight, uColor.a);
    }
  `)
  const result = gl.createProgram()
  if (!result) throw new Error('Unable to allocate WebGL program')
  gl.attachShader(result, vertex)
  gl.attachShader(result, fragment)
  gl.linkProgram(result)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(result) || 'Unknown WebGL program link failure'
    gl.deleteProgram(result)
    throw new Error(message)
  }
  return result
}

function flatten(points: Viewer3DVector[]): Float32Array {
  const values = new Float32Array(points.length * 3)
  points.forEach((point, index) => {
    values[index * 3] = point.x
    values[index * 3 + 1] = point.y
    values[index * 3 + 2] = point.z
  })
  return values
}

function sphereMesh(center: Viewer3DVector, radius: number, latSegments = 24, lonSegments = 48): { positions: Float32Array; normals: Float32Array } {
  const positions: number[] = []
  const normals: number[] = []
  const point = (lat: number, lon: number): [Viewer3DVector, Viewer3DVector] => {
    const cosLat = Math.cos(lat)
    const normal = { x: cosLat * Math.cos(lon), y: cosLat * Math.sin(lon), z: Math.sin(lat) }
    return [{ x: center.x + normal.x * radius, y: center.y + normal.y * radius, z: center.z + normal.z * radius }, normal]
  }
  const push = ([position, normal]: [Viewer3DVector, Viewer3DVector]) => {
    positions.push(position.x, position.y, position.z)
    normals.push(normal.x, normal.y, normal.z)
  }
  for (let latIndex = 0; latIndex < latSegments; latIndex += 1) {
    const lat0 = -Math.PI / 2 + (latIndex / latSegments) * Math.PI
    const lat1 = -Math.PI / 2 + ((latIndex + 1) / latSegments) * Math.PI
    for (let lonIndex = 0; lonIndex < lonSegments; lonIndex += 1) {
      const lon0 = (lonIndex / lonSegments) * Math.PI * 2
      const lon1 = ((lonIndex + 1) / lonSegments) * Math.PI * 2
      const a = point(lat0, lon0)
      const b = point(lat1, lon0)
      const c = point(lat1, lon1)
      const d = point(lat0, lon1)
      push(a); push(b); push(c)
      push(a); push(c); push(d)
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) }
}

function graticule(center: Viewer3DVector, radius: number): Viewer3DVector[][] {
  const lines: Viewer3DVector[][] = []
  const r = radius * 1.0025
  for (const latDeg of [-60, -30, 0, 30, 60]) {
    const lat = latDeg * Math.PI / 180
    const cosLat = Math.cos(lat)
    const points: Viewer3DVector[] = []
    for (let lonDeg = 0; lonDeg <= 360; lonDeg += 5) {
      const lon = lonDeg * Math.PI / 180
      points.push({ x: center.x + r * cosLat * Math.cos(lon), y: center.y + r * cosLat * Math.sin(lon), z: center.z + r * Math.sin(lat) })
    }
    lines.push(points)
  }
  for (let lonDeg = 0; lonDeg < 360; lonDeg += 30) {
    const lon = lonDeg * Math.PI / 180
    const points: Viewer3DVector[] = []
    for (let latDeg = -90; latDeg <= 90; latDeg += 5) {
      const lat = latDeg * Math.PI / 180
      const cosLat = Math.cos(lat)
      points.push({ x: center.x + r * cosLat * Math.cos(lon), y: center.y + r * cosLat * Math.sin(lon), z: center.z + r * Math.sin(lat) })
    }
    lines.push(points)
  }
  return lines
}

function sceneExtent(objects: Viewer3DObject[]): number {
  let extent = 1
  for (const object of objects) {
    if (object.type === 'sphere') {
      extent = Math.max(extent, Math.hypot(object.center.x, object.center.y, object.center.z) + object.radiusKm)
    } else {
      for (const point of object.points) extent = Math.max(extent, Math.hypot(point.x, point.y, point.z))
    }
  }
  return extent
}

const WebGLScene: FC<{ output: Viewer3DView }> = ({ output }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failure, setFailure] = useState<string>()
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false }) ?? canvas.getContext('webgl', { antialias: true, alpha: false })
    if (!gl) {
      setFailure('WebGL is unavailable in this browser or security context.')
      return
    }

    let disposed = false
    let activePointer: number | undefined
    let lastX = 0
    let lastY = 0
    const objects = output.scene?.objects ?? []
    const extent = sceneExtent(objects)
    const target = output.scene?.camera?.target ?? { x: 0, y: 0, z: 0 }
    const suggested = output.scene?.camera?.distanceKm
    const state = {
      yaw: -0.75,
      pitch: 0.32,
      distance: clamp(suggested && suggested > 0 ? suggested : extent * 2.8, extent * 1.25, extent * 12),
    }

    let webglProgram: WebGLProgram
    try {
      webglProgram = program(gl)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Unable to initialize WebGL renderer')
      return
    }

    const positionLocation = gl.getAttribLocation(webglProgram, 'aPosition')
    const normalLocation = gl.getAttribLocation(webglProgram, 'aNormal')
    const mvpLocation = gl.getUniformLocation(webglProgram, 'uMvp')
    const colorLocation = gl.getUniformLocation(webglProgram, 'uColor')
    const pointSizeLocation = gl.getUniformLocation(webglProgram, 'uPointSize')
    const litLocation = gl.getUniformLocation(webglProgram, 'uLit')
    const roundPointLocation = gl.getUniformLocation(webglProgram, 'uRoundPoint')
    const buffers: WebGLBuffer[] = []
    const items: DrawItem[] = []

    const makeBuffer = (data: Float32Array): WebGLBuffer => {
      const result = gl.createBuffer()
      if (!result) throw new Error('Unable to allocate WebGL buffer')
      buffers.push(result)
      gl.bindBuffer(gl.ARRAY_BUFFER, result)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      return result
    }

    const addLine = (points: Viewer3DVector[], lineColor: [number, number, number, number]) => {
      if (points.length < 2) return
      items.push({ mode: gl.LINE_STRIP, position: makeBuffer(flatten(points)), count: points.length, color: lineColor, pointSize: 1, lit: false, roundPoint: false })
    }

    try {
      for (const object of objects) {
        if (object.type === 'sphere') {
          const mesh = sphereMesh(object.center, object.radiusKm)
          items.push({
            mode: gl.TRIANGLES,
            position: makeBuffer(mesh.positions),
            normal: makeBuffer(mesh.normals),
            count: mesh.positions.length / 3,
            color: color(object.color ?? '#1769aa'),
            pointSize: 1,
            lit: true,
            roundPoint: false,
          })
          for (const line of graticule(object.center, object.radiusKm)) addLine(line, [0.45, 0.76, 1, 0.55])
        } else if (object.type === 'path') {
          addLine(object.points, color(object.color ?? '#ff7a18'))
        } else if (object.type === 'points' && object.points.length) {
          items.push({
            mode: gl.POINTS,
            position: makeBuffer(flatten(object.points)),
            count: object.points.length,
            color: color(object.color ?? '#ffffff'),
            pointSize: 10,
            lit: false,
            roundPoint: true,
          })
        }
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Unable to prepare 3D scene')
      buffers.forEach((buffer) => gl.deleteBuffer(buffer))
      gl.deleteProgram(webglProgram)
      return
    }

    gl.useProgram(webglProgram)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0.035, 0.047, 0.065, 1)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(rect.width * ratio))
      const height = Math.max(1, Math.round(rect.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
    }

    const draw = () => {
      if (disposed) return
      resize()
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      const cosPitch = Math.cos(state.pitch)
      const eye = {
        x: target.x + state.distance * cosPitch * Math.sin(state.yaw),
        y: target.y + state.distance * cosPitch * Math.cos(state.yaw),
        z: target.z + state.distance * Math.sin(state.pitch),
      }
      const near = Math.max(0.1, state.distance - extent * 1.4)
      const far = Math.max(near + 10, state.distance + extent * 4)
      const projection = perspective(Math.PI / 4, canvas.width / canvas.height, near, far)
      const view = lookAt(eye, target, { x: 0, y: 0, z: 1 })
      const mvp = multiply(projection, view)
      gl.uniformMatrix4fv(mvpLocation, false, mvp)

      for (const item of items) {
        gl.bindBuffer(gl.ARRAY_BUFFER, item.position)
        gl.enableVertexAttribArray(positionLocation)
        gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0)
        if (item.normal) {
          gl.bindBuffer(gl.ARRAY_BUFFER, item.normal)
          gl.enableVertexAttribArray(normalLocation)
          gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0)
        } else {
          gl.disableVertexAttribArray(normalLocation)
          gl.vertexAttrib3f(normalLocation, 0, 0, 1)
        }
        gl.uniform4fv(colorLocation, item.color)
        gl.uniform1f(pointSizeLocation, item.pointSize)
        gl.uniform1f(litLocation, item.lit ? 1 : 0)
        gl.uniform1f(roundPointLocation, item.roundPoint ? 1 : 0)
        gl.drawArrays(item.mode, 0, item.count)
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      activePointer = event.pointerId
      lastX = event.clientX
      lastY = event.clientY
      canvas.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (activePointer !== event.pointerId) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      state.yaw -= dx * 0.008
      state.pitch = clamp(state.pitch + dy * 0.008, -1.45, 1.45)
      draw()
    }
    const onPointerUp = (event: PointerEvent) => {
      if (activePointer !== event.pointerId) return
      activePointer = undefined
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      state.distance = clamp(state.distance * Math.exp(event.deltaY * 0.001), extent * 1.25, extent * 12)
      draw()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    draw()
    setFailure(undefined)

    return () => {
      disposed = true
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      buffers.forEach((buffer) => gl.deleteBuffer(buffer))
      gl.deleteProgram(webglProgram)
    }
  }, [output, resetKey])

  return <>
    <div style={{ position: 'relative', minHeight: 360, background: '#091019' }}>
      <canvas
        ref={canvasRef}
        aria-label={`Interactive 3D scene: ${output.title}`}
        style={{ width: '100%', height: 'min(52vh, 470px)', minHeight: 360, display: 'block', touchAction: 'none', cursor: 'grab' }}
      />
      {failure && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 24, color: '#fff', textAlign: 'center', background: '#10151c' }}>{failure}</div>}
      <div style={{ position: 'absolute', left: 10, bottom: 10, padding: '5px 8px', border: '1px solid rgba(255,255,255,.35)', borderRadius: 6, background: 'rgba(0,0,0,.52)', color: '#fff', font: '700 9px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '.08em' }}>
        DRAG TO ORBIT · SCROLL TO ZOOM
      </div>
    </div>
    <div style={toolbar}>
      <button type="button" onClick={() => setResetKey((value) => value + 1)} style={{ border: '2px solid #111', borderRadius: 6, background: 'hsl(var(--card))', padding: '5px 8px', fontWeight: 800, cursor: 'pointer' }}>Reset view</button>
      <span>{output.scene.frame ?? 'SCENE'} · {output.scene.units}</span>
      <span style={{ marginLeft: 'auto' }}>LOCAL WEBGL · NO NETWORK ASSETS</span>
    </div>
  </>
}

const Viewer3DCard: FC<{ output: Viewer3DView }> = ({ output }) => {
  const objects = output.scene?.objects ?? []
  const counts = objects.reduce<Record<string, number>>((acc, object) => {
    acc[object.type] = (acc[object.type] ?? 0) + 1
    return acc
  }, {})
  const summary = Object.entries(counts).map(([type, count]) => `${count} ${type}`).join(' · ') || 'empty scene'
  return <section style={shell}>
    <header style={header}>
      <div>
        <div style={eyebrow}>3D VIEWER · {output.renderer.toUpperCase()}</div>
        <h3 style={{ margin: '4px 0 0', fontSize: 18 }}>{output.title}</h3>
      </div>
      <span style={{ padding: '4px 7px', border: '1px solid #111', borderRadius: 5, font: '800 9px ui-monospace, SFMono-Regular, Menlo, monospace' }}>WEBGL</span>
    </header>
    <WebGLScene output={output} />
    <footer style={{ padding: '8px 12px 10px', color: 'hsl(var(--muted-foreground))', fontSize: 10 }}>
      {summary}{output.source?.extension ? ` · ${output.source.extension}${output.source.tool ? `/${output.source.tool}` : ''}` : ''}
    </footer>
  </section>
}

export const viewer3dUiProvider: ExtensionUiProvider<FC<{ output: Viewer3DView }>> = {
  name: 'papyrus-viewer-3d',
  version: '0.1.0',
  cards: [{ kind: 'viewer_3d', component: Viewer3DCard }],
}
