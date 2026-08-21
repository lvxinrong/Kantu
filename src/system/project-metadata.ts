import { lstat, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export type ProjectMetadataKind = 'manifest' | 'documentation' | 'deployment' | 'ci' | 'environment' | 'configuration'

export interface SafeProjectMetadataFile {
  path: string
  kind: ProjectMetadataKind
  excerpt: string
}

export interface SafeProjectMetadata {
  files: SafeProjectMetadataFile[]
  omittedFiles: number
  boundary: 'PROJECT_ROOT_ONLY'
}

const MAX_FILES = 24
const MAX_FILE_BYTES = 64 * 1024
const MAX_EXCERPT_LENGTH = 3_000
const MAX_TOTAL_EXCERPT_LENGTH = 18_000

const SAFE_DIRECTORIES = new Set([
  '.circleci',
  '.github',
  'charts',
  'config',
  'deploy',
  'deployment',
  'docker',
  'helm',
  'k8s',
  'kubernetes',
])

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.next',
  '.nuxt',
  '.svn',
  'build',
  'coverage',
  'dist',
  'archscope_docs',
  'node_modules',
  'target',
  'vendor',
])

function metadataKind(relativePath: string): ProjectMetadataKind | undefined {
  const name = path.basename(relativePath)
  const lower = name.toLowerCase()
  const normalized = relativePath.split(path.sep).join('/').toLowerCase()
  if (/^(package\.json|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|go\.mod|cargo\.toml|pyproject\.toml|composer\.json|requirements[^/]*\.txt)$/u.test(lower)) return 'manifest'
  if (/^readme(?:\.[^/]+)?$/u.test(lower)) return 'documentation'
  if (lower.startsWith('.env')) return 'environment'
  if (normalized.startsWith('.github/workflows/') || normalized.startsWith('.circleci/') || /^(\.gitlab-ci\.ya?ml|jenkinsfile|azure-pipelines\.ya?ml)$/u.test(lower)) return 'ci'
  if (/^(dockerfile(?:\..+)?|(?:docker-)?compose[^/]*\.ya?ml|chart\.yaml|values[^/]*\.ya?ml|kustomization\.ya?ml)$/u.test(lower)) return 'deployment'
  if (/\.(?:ya?ml|json|toml|properties|conf|config|xml)$/u.test(lower)) return 'configuration'
  return undefined
}

function rootFileAllowed(name: string): boolean {
  const kind = metadataKind(name)
  return kind !== undefined && kind !== 'configuration'
    || /^(application|bootstrap)[^/]*\.(?:ya?ml|properties)$/iu.test(name)
}

function redactSensitiveText(value: string, kind: ProjectMetadataKind, fileName: string): string {
  if (kind === 'environment') {
    const entries = value
      .split(/\r?\n/gu)
      .map(line => line.trim())
      .filter(line => line !== '' && !line.startsWith('#'))
      .flatMap(line => {
        const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
        if (match?.[1] === undefined) return []
        const secretKey = /(?:api_?key|access_?key|secret|credential|client_?secret|password|passwd|token)/iu.test(match[1])
        return [`${match[1]}=${secretKey ? '<redacted>' : redactSensitiveText(match[2] ?? '', 'configuration', fileName)}`]
      })
    return entries.length === 0 ? `${fileName}: environment file present` : entries.join('\n')
  }
  return value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*/giu, '<redacted-private-key>')
    .replace(/((?:https?|jdbc:[a-z0-9]+):\/\/)[^/\s:@]+:[^@\s/]+@/giu, '$1<redacted-credentials>@')
    .replace(/(["']?(?:api[ _.-]?key|access[ _.-]?key|secret|credential|client[ _.-]?secret|password|passwd|token)["']?\s*[=:]\s*["']?)[^\s,;"'<>]{1,}/giu, '$1<redacted>')
    .replace(/((?:Authorization\s*[:=]\s*|Bearer\s+))[A-Za-z0-9._~+/=-]{8,}/giu, '$1<redacted>')
    .replace(/(<(?:password|passwd|secret|token|accessKey|secretKey)>)[\s\S]*?(<\/[^>]+>)/giu, '$1<redacted>$2')
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function candidatePaths(projectRoot: string): Promise<string[]> {
  const candidates: string[] = []
  const rootEntries = await readdir(projectRoot, { withFileTypes: true })
  for (const entry of rootEntries) {
    if (entry.isFile() && rootFileAllowed(entry.name)) candidates.push(entry.name)
  }

  async function visit(relativeDirectory: string, depth: number): Promise<void> {
    if (depth > 4 || candidates.length >= MAX_FILES * 3) return
    const absoluteDirectory = path.resolve(projectRoot, relativeDirectory)
    if (!inside(projectRoot, absoluteDirectory)) return
    const stat = await lstat(absoluteDirectory).catch(() => undefined)
    if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) return
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (candidates.length >= MAX_FILES * 3) return
      const relative = path.join(relativeDirectory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await visit(relative, depth + 1)
      } else if (entry.isFile() && metadataKind(relative) !== undefined) {
        candidates.push(relative)
      }
    }
  }

  for (const entry of rootEntries) {
    if (entry.isDirectory() && SAFE_DIRECTORIES.has(entry.name)) await visit(entry.name, 1)
  }
  return [...new Set(candidates)].sort()
}

export async function collectSafeProjectMetadata(projectRoot: string): Promise<SafeProjectMetadata> {
  const root = path.resolve(projectRoot)
  const candidates = await candidatePaths(root)
  const files: SafeProjectMetadataFile[] = []
  let totalLength = 0
  for (const relativePath of candidates) {
    if (files.length >= MAX_FILES || totalLength >= MAX_TOTAL_EXCERPT_LENGTH) break
    const absolutePath = path.resolve(root, relativePath)
    if (!inside(root, absolutePath)) continue
    const stat = await lstat(absolutePath).catch(() => undefined)
    if (stat === undefined || !stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue
    const kind = metadataKind(relativePath)
    if (kind === undefined) continue
    const content = await readFile(absolutePath, 'utf8').catch(() => undefined)
    if (content === undefined || content.includes('\u0000')) continue
    const remaining = MAX_TOTAL_EXCERPT_LENGTH - totalLength
    const excerpt = redactSensitiveText(content, kind, relativePath).slice(0, Math.min(MAX_EXCERPT_LENGTH, remaining)).trim()
    if (excerpt === '') continue
    files.push({ path: relativePath.split(path.sep).join('/'), kind, excerpt })
    totalLength += excerpt.length
  }
  return {
    files,
    omittedFiles: Math.max(0, candidates.length - files.length),
    boundary: 'PROJECT_ROOT_ONLY',
  }
}
