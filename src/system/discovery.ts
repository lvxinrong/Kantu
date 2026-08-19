import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { ProjectRecord, SkippedDirectory } from '../contracts/system-scan.js'
import { classifyProject } from './project-type.js'

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.mvn',
  '.next',
  '.opencode',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
])

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return normalized || 'project'
}

export function createProjectKey(projectDir: string, projectName: string): string {
  if (projectDir === '.' || !projectDir.includes('/')) return slug(projectName)
  const digest = createHash('sha256').update(projectDir).digest('hex').slice(0, 8)
  return `${slug(projectName)}-${digest}`
}

async function isGitRoot(directory: string): Promise<boolean> {
  try {
    const info = await stat(path.join(directory, '.git'))
    return info.isDirectory() || info.isFile()
  } catch {
    return false
  }
}

async function resolveGitDirectory(projectRoot: string): Promise<string | undefined> {
  const dotGit = path.join(projectRoot, '.git')
  try {
    const info = await stat(dotGit)
    if (info.isDirectory()) return dotGit
    if (!info.isFile()) return undefined
    const content = await readFile(dotGit, 'utf8')
    const match = /^gitdir:\s*(.+?)\s*$/u.exec(content)
    return match?.[1] === undefined ? undefined : path.resolve(projectRoot, match[1])
  } catch {
    return undefined
  }
}

async function readGitHead(projectRoot: string): Promise<string | null> {
  const gitDirectory = await resolveGitDirectory(projectRoot)
  if (gitDirectory === undefined) return null
  try {
    const head = (await readFile(path.join(gitDirectory, 'HEAD'), 'utf8')).trim()
    if (/^[0-9a-f]{40,64}$/iu.test(head)) return head
    const match = /^ref:\s*(.+)$/u.exec(head)
    if (match?.[1] === undefined) return null
    try {
      return (await readFile(path.join(gitDirectory, match[1]), 'utf8')).trim() || null
    } catch {
      const packed = await readFile(path.join(gitDirectory, 'packed-refs'), 'utf8')
      const line = packed.split('\n').find(entry => entry.endsWith(` ${match[1]}`))
      return line?.split(' ')[0] ?? null
    }
  } catch {
    return null
  }
}

export interface DiscoveryOptions {
  root: string
  maxDepth: number
  outputDirectory: string
  signal?: AbortSignal
}

export interface DiscoveryResult {
  projects: ProjectRecord[]
  skippedDirectories: SkippedDirectory[]
}

export async function discoverProjects(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const root = path.resolve(options.root)
  const candidates: string[] = []
  const skippedDirectories: SkippedDirectory[] = []
  const outputRoot = path.resolve(root, options.outputDirectory)

  async function visit(directory: string, depth: number): Promise<void> {
    options.signal?.throwIfAborted()
    const relative = toPosix(path.relative(root, directory)) || '.'

    if (directory !== root && await isGitRoot(directory)) {
      candidates.push(directory)
      return
    }
    if (depth >= options.maxDepth) {
      if (directory !== root) skippedDirectories.push({ path: relative, depth, reason: 'max-depth-reached' })
      return
    }

    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      skippedDirectories.push({ path: relative, depth, reason: 'unreadable' })
      return
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const child = path.join(directory, entry.name)
      if (DEFAULT_IGNORED_DIRECTORIES.has(entry.name) || child === outputRoot) {
        if (depth === 0) {
          skippedDirectories.push({ path: entry.name, depth: 1, reason: 'ignored-directory' })
        }
        continue
      }
      await visit(child, depth + 1)
    }
  }

  await visit(root, 0)
  if (candidates.length === 0 && await isGitRoot(root)) candidates.push(root)

  const projects = await Promise.all(candidates.sort().map(async (projectRoot): Promise<ProjectRecord> => {
    options.signal?.throwIfAborted()
    const projectDir = toPosix(path.relative(root, projectRoot)) || '.'
    const projectName = path.basename(projectRoot)
    const classification = await classifyProject(projectRoot)
    return {
      projectKey: createProjectKey(projectDir, projectName),
      projectName,
      projectDir,
      gitHead: await readGitHead(projectRoot),
      projectType: classification.type,
      classificationEvidence: classification.evidence,
      productionStatus: 'UNCONFIRMED',
    }
  }))

  return { projects, skippedDirectories }
}
