import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type ProtocolResourceKind = 'contract' | 'policy' | 'prompt'

export interface ProtocolResourceDescriptor {
  id: string
  version: string
  kind: ProtocolResourceKind
  path: string
}

export interface ProtocolManifest {
  manifestVersion: '1'
  packId: string
  version: string
  layer: 'system'
  resources: ProtocolResourceDescriptor[]
}

export interface LoadedProtocolResource extends ProtocolResourceDescriptor {
  content: string
  digest: string
}

export interface ProtocolLockResource {
  id: string
  version: string
  kind: ProtocolResourceKind
  path: string
  digest: string
}

export interface ProtocolLock {
  packId: string
  version: string
  manifestDigest: string
  packDigest: string
  resources: ProtocolLockResource[]
}

export interface LoadedProtocolPack {
  root: string
  manifest: ProtocolManifest
  resources: LoadedProtocolResource[]
  lock: ProtocolLock
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseManifest(content: string): ProtocolManifest {
  const raw: unknown = JSON.parse(content)
  if (!isRecord(raw) || raw.manifestVersion !== '1' || raw.layer !== 'system'
    || typeof raw.packId !== 'string' || typeof raw.version !== 'string' || !Array.isArray(raw.resources)) {
    throw new Error('Invalid ArchScope protocol manifest.')
  }
  const resources = raw.resources.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.version !== 'string'
      || (item.kind !== 'contract' && item.kind !== 'policy' && item.kind !== 'prompt') || typeof item.path !== 'string') {
      throw new Error(`Invalid ArchScope protocol resource at index ${index}.`)
    }
    if (path.isAbsolute(item.path) || item.path.split('/').includes('..')) {
      throw new Error(`Unsafe ArchScope protocol resource path: ${item.path}`)
    }
    return item as unknown as ProtocolResourceDescriptor
  })
  if (new Set(resources.map(item => item.id)).size !== resources.length) {
    throw new Error('ArchScope protocol resource ids must be unique.')
  }
  return { manifestVersion: '1', packId: raw.packId, version: raw.version, layer: 'system', resources }
}

async function resolveProtocolRoot(explicitRoot?: string): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const candidates = explicitRoot === undefined
    ? [path.resolve(moduleDirectory, '../../protocol'), path.resolve(moduleDirectory, '../protocol')]
    : [path.resolve(explicitRoot)]
  for (const candidate of candidates) {
    try {
      await readFile(path.join(candidate, 'manifest.json'), 'utf8')
      return candidate
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  throw new Error('ArchScope system protocol pack is missing from the plugin package.')
}

export async function loadProtocolPack(explicitRoot?: string): Promise<LoadedProtocolPack> {
  const root = await resolveProtocolRoot(explicitRoot)
  const manifestContent = await readFile(path.join(root, 'manifest.json'), 'utf8')
  const manifest = parseManifest(manifestContent)
  const resources = await Promise.all(manifest.resources.map(async descriptor => {
    const content = await readFile(path.join(root, descriptor.path), 'utf8')
    if (content.trim() === '') throw new Error(`ArchScope protocol resource is empty: ${descriptor.id}`)
    if (descriptor.kind === 'contract') {
      const contract: unknown = JSON.parse(content)
      if (!isRecord(contract) || contract.contractId !== descriptor.id || contract.version !== descriptor.version) {
        throw new Error(`ArchScope protocol contract identity does not match the manifest: ${descriptor.id}`)
      }
    }
    return { ...descriptor, content, digest: sha256(content) }
  }))
  const lockResources = resources.map(({ content: _content, ...resource }) => resource)
  const manifestDigest = sha256(manifestContent)
  const packDigest = sha256(JSON.stringify({ manifestDigest, resources: lockResources }))
  return {
    root,
    manifest,
    resources,
    lock: { packId: manifest.packId, version: manifest.version, manifestDigest, packDigest, resources: lockResources },
  }
}

export function protocolResource(pack: LoadedProtocolPack, id: string): LoadedProtocolResource {
  const resource = pack.resources.find(item => item.id === id)
  if (resource === undefined) throw new Error(`ArchScope protocol resource is missing: ${id}`)
  return resource
}

export function parseProtocolContract<T>(pack: LoadedProtocolPack, id: string): T {
  const resource = protocolResource(pack, id)
  if (resource.kind !== 'contract') throw new Error(`ArchScope protocol resource is not a contract: ${id}`)
  return JSON.parse(resource.content) as T
}
