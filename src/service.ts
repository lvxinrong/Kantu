import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { Service, type Context } from '@deepseek-ai/cordis'

import type { Config } from './config.js'
import {
  SYSTEM_SCAN_PROTOCOL,
  type KantuStatusResult,
  type ProjectRegistry,
  type SystemScanResult,
  type SystemScanRunState,
  type SystemScanStatus,
} from './contracts/system-scan.js'
import { atomicWriteJson, createIndexManifest, validateSystemArtifacts, writeSystemArtifacts } from './system/artifacts.js'
import { discoverProjects } from './system/discovery.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    kantu: KantuService
  }
}

function reusable(status: SystemScanStatus): boolean {
  return status === 'COMPLETED' || status === 'BLOCKED'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeOutputRoot(workspaceRoot: string, outputDirectory: string): string {
  if (path.isAbsolute(outputDirectory)) {
    throw new Error('Kantu outputDirectory must be relative to workspaceRoot.')
  }
  const outputRoot = path.resolve(workspaceRoot, outputDirectory)
  const relative = path.relative(workspaceRoot, outputRoot)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Kantu outputDirectory must be a non-empty path inside workspaceRoot.')
  }
  return outputRoot
}

function createRunId(now: Date): string {
  const timestamp = now.toISOString().replace(/[-:.TZ]/gu, '').slice(0, 14)
  return `system-${timestamp}-${randomUUID().slice(0, 8)}`
}

export interface ScanSystemOptions {
  refresh?: boolean
  signal?: AbortSignal
}

export class KantuService extends Service {
  private readonly workspaceRoot: string
  private readonly outputRoot: string
  private readonly outputDirectory: string
  private activeScan: Promise<SystemScanResult> | undefined

  constructor(ctx: Context, private readonly config: Config) {
    const workspaceRoot = path.resolve(config.workspaceRoot)
    const outputRoot = safeOutputRoot(workspaceRoot, config.outputDirectory)
    super(ctx, 'kantu')
    this.workspaceRoot = workspaceRoot
    this.outputRoot = outputRoot
    this.outputDirectory = path.relative(this.workspaceRoot, this.outputRoot).split(path.sep).join('/')
  }

  async scanSystem(options: ScanSystemOptions = {}): Promise<SystemScanResult> {
    if (this.activeScan !== undefined) return this.activeScan
    this.activeScan = this.performSystemScan(options).finally(() => {
      this.activeScan = undefined
    })
    return this.activeScan
  }

  async status(runId?: string): Promise<KantuStatusResult> {
    const state = await this.readRunState(runId)
    if (state === undefined) {
      return {
        found: false,
        runId: '',
        status: 'NOT_FOUND',
        gate: 'BLOCKED',
        validation: 'NOT_RUN',
        projectCount: 0,
        outputDirectory: this.outputDirectory,
      }
    }
    return {
      found: true,
      runId: state.runId,
      status: state.status,
      gate: state.gate,
      validation: state.validation,
      projectCount: state.projectCount,
      outputDirectory: state.outputDirectory,
    }
  }

  private async performSystemScan(options: ScanSystemOptions): Promise<SystemScanResult> {
    await mkdir(path.join(this.outputRoot, 'runs'), { recursive: true })
    if (!options.refresh) {
      const existing = await this.readRunState()
      if (existing !== undefined && reusable(existing.status)) return this.toResult(existing, true)
    }

    const now = new Date()
    const runId = createRunId(now)
    let state: SystemScanRunState = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      runId,
      status: 'DISCOVERING',
      gate: 'BLOCKED',
      validation: 'NOT_RUN',
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      workspaceRoot: '.',
      outputDirectory: this.outputDirectory,
      refresh: options.refresh ?? false,
      projectCount: 0,
      transitions: [{ status: 'DISCOVERING', at: now.toISOString() }],
    }
    await this.writeRunState(state)

    try {
      const discovery = await discoverProjects({
        root: this.workspaceRoot,
        maxDepth: this.config.discoveryMaxDepth,
        outputDirectory: this.outputDirectory,
        signal: options.signal,
      })
      state = await this.transition(state, 'INDEXING', { projectCount: discovery.projects.length })
      const generatedAt = new Date().toISOString()
      const registry: ProjectRegistry = {
        protocolVersion: SYSTEM_SCAN_PROTOCOL,
        generatedAt,
        workspaceRoot: '.',
        discoveryMaxDepth: this.config.discoveryMaxDepth,
        projectCount: discovery.projects.length,
        projects: discovery.projects,
        skippedDirectories: discovery.skippedDirectories,
      }
      const indexes = createIndexManifest(discovery.projects, generatedAt)
      state = await this.transition(state, 'COLLECTING_EVIDENCE')
      options.signal?.throwIfAborted()
      state = await this.transition(state, 'BUILDING_FACT_BASE')
      const validation = validateSystemArtifacts(registry, indexes, generatedAt)
      await writeSystemArtifacts({ outputRoot: this.outputRoot, registry, indexes, validation })
      state = await this.transition(state, 'VALIDATING', { validation: validation.status, gate: validation.gate })
      state = await this.transition(state, validation.gate === 'READY' ? 'COMPLETED' : 'BLOCKED', {
        finishedAt: new Date().toISOString(),
      })
      return this.toResult(state, false)
    } catch (error) {
      state = await this.transition(state, 'FAILED', {
        validation: 'FAILED',
        gate: 'BLOCKED',
        finishedAt: new Date().toISOString(),
        error: errorMessage(error),
      })
      throw error
    }
  }

  private async transition(
    state: SystemScanRunState,
    status: SystemScanStatus,
    changes: Partial<SystemScanRunState> = {},
  ): Promise<SystemScanRunState> {
    const at = new Date().toISOString()
    const next: SystemScanRunState = {
      ...state,
      ...changes,
      status,
      updatedAt: at,
      transitions: [...state.transitions, { status, at }],
    }
    await this.writeRunState(next)
    return next
  }

  private async writeRunState(state: SystemScanRunState): Promise<void> {
    await atomicWriteJson(path.join(this.outputRoot, 'runs', state.runId, 'state.json'), state)
    await atomicWriteJson(path.join(this.outputRoot, 'runs', 'latest.json'), { runId: state.runId })
  }

  private async readRunState(runId?: string): Promise<SystemScanRunState | undefined> {
    try {
      let resolvedRunId = runId
      if (resolvedRunId === undefined) {
        const latest = JSON.parse(await readFile(path.join(this.outputRoot, 'runs', 'latest.json'), 'utf8')) as { runId?: unknown }
        if (typeof latest.runId !== 'string') return undefined
        resolvedRunId = latest.runId
      }
      if (!/^[a-z0-9][a-z0-9-]*$/u.test(resolvedRunId)) throw new Error('Invalid Kantu run id.')
      return JSON.parse(await readFile(path.join(this.outputRoot, 'runs', resolvedRunId, 'state.json'), 'utf8')) as SystemScanRunState
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  private toResult(state: SystemScanRunState, reused: boolean): SystemScanResult {
    return {
      runId: state.runId,
      status: state.status,
      gate: state.gate,
      validation: state.validation,
      projectCount: state.projectCount,
      outputDirectory: state.outputDirectory,
      reused,
    }
  }
}
