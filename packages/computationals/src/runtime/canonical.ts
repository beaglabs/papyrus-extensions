import { createHash } from 'node:crypto'
/** Reject non-JSON values and prototype keys before hashing/binding/exporting. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Unsafe JSON key: ${key}`)
      return `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
    }).join(',')}}`
  }
  throw new Error('Computational payloads must be finite JSON values')
}
export const hash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex')
export const bytes = (value: unknown): number => Buffer.byteLength(canonical(value))
export function pointer(value: unknown, path = ''): unknown {
  if (!path) return structuredClone(value)
  if (!path.startsWith('/')) throw new Error('Binding pointer must be a JSON Pointer')
  let result = value
  for (const raw of path.slice(1).split('/')) {
    if (/~(?![01])/u.test(raw)) throw new Error('Invalid JSON Pointer escape')
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !result || typeof result !== 'object' || !Object.hasOwn(result, key)) throw new Error(`Missing or unsafe pointer ${path}`)
    result = (result as Record<string, unknown>)[key]
  }
  return structuredClone(result)
}
