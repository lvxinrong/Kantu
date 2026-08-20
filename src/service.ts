import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'

import type { Config } from './config.js'
import {
  SYSTEM_SCAN_PROTOCOL,
  type ArchScopeStatusResult,
  type ProjectRegistry,
  type SystemScanResult,
  type SystemScanRunState,
  type SystemScanProgress,
  type SystemScanStatus,
} from './contracts/system-scan.js'
import { loadProtocolPack } from './protocol/catalog.js'
import { atomicWriteJson, prepareSystemArtifacts, writeSystemArtifacts } from './system/artifacts.js'
import { DshSystemAnalyzer, type SystemAnalyzer } from './system/analyzer.js'
import { discoverProjects } from './system/discovery.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    archscope: ArchScopeService
    /** @deprecated Use ctx.archscope. */
    kantu?: ArchScopeService
  }
}

function reusable(status: SystemScanStatus): boolean {
  return status === 'COMPLETED'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function safeOutputRoot(workspaceRoot: string, outputDirectory: string): string {
  if (path.isAbsolute(outputDirectory)) {
    throw new Error('ArchScope outputDirectory must be relative to workspaceRoot.')
  }
  const outputRoot = path.resolve(workspaceRoot, outputDirectory)
  const relative = path.relative(workspaceRoot, outputRoot)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('ArchScope outputDirectory must be a non-empty path inside workspaceRoot.')
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
  workspaceRoot?: string
  agent?: ToolExecutionInput['agent']
  onProgress?: (progress: SystemScanProgress) => void
}

export interface StatusOptions {
  workspaceRoot?: string
}

interface ResolvedWorkspace {
  root: string
  outputRoot: string
  outputDirectory: string
}

export class ArchScopeService extends Service {
  private readonly activeScans = new Map<string, Promise<SystemScanResult>>()
  private readonly analyzer: SystemAnalyzer

  constructor(ctx: Context, private readonly config: Config, analyzer?: SystemAnalyzer) {
    super(ctx, 'archscope')
    if (config.registerLegacyAliases !== false) ctx.reflect.provide('kantu', this)
    this.analyzer = analyzer ?? new DshSystemAnalyzer(ctx, config)
  }

  async scanSystem(options: ScanSystemOptions = {}): Promise<SystemScanResult> {
    const workspace = this.resolveWorkspace(options.workspaceRoot)
    const active = this.activeScans.get(workspace.root)
    if (active !== undefined) return active
    const scan = this.performSystemScan(options, workspace)
    this.activeScans.set(workspace.root, scan)
    try {
      return await scan
    } finally {
      if (this.activeScans.get(workspace.root) === scan) this.activeScans.delete(workspace.root)
    }
  }

  async status(runId?: string, options: StatusOptions = {}): Promise<ArchScopeStatusResult> {
    const workspace = this.resolveWorkspace(options.workspaceRoot)
    const state = await this.readRunState(workspace.outputRoot, runId)
    if (state === undefined) {
      return {
        found: false,
        runId: '',
        status: 'NOT_FOUND',
        gate: 'BLOCKED',
        validation: 'NOT_RUN',
        projectCount: 0,
        indexedProjectCount: 0,
        evidenceProjectCount: 0,
        scopeViolationCount: 0,
        outputDirectory: workspace.outputDirectory,
      }
    }
    return {
      found: true,
      runId: state.runId,
      status: state.status,
      gate: state.gate,
      validation: state.validation,
      projectCount: state.projectCount,
      indexedProjectCount: state.indexedProjectCount ?? 0,
      evidenceProjectCount: state.evidenceProjectCount ?? 0,
      scopeViolationCount: state.scopeViolationCount ?? 0,
      outputDirectory: state.outputDirectory,
    }
  }

  private resolveWorkspace(invocationWorkspace?: string): ResolvedWorkspace {
    const sessionWorkspace = invocationWorkspace?.trim()
    if (sessionWorkspace !== undefined && sessionWorkspace !== '' && !path.isAbsolute(sessionWorkspace)) {
      throw new Error('DeepSeek Harness session workspace must be an absolute path.')
    }
    const configured = this.config.workspaceRoot?.trim()
    if ((sessionWorkspace === undefined || sessionWorkspace === '') && (configured === undefined || configured === '' || !path.isAbsolute(configured))) {
      throw new Error('ArchScope requires the current DeepSeek Harness session workspace. Set an absolute workspaceRoot only for headless or embedded use.')
    }
    const root = configured === undefined || configured === ''
      ? path.resolve(sessionWorkspace as string)
      : path.isAbsolute(configured)
        ? path.resolve(configured)
        : path.resolve(sessionWorkspace as string, configured)
    const outputRoot = safeOutputRoot(root, this.config.outputDirectory)
    return {
      root,
      outputRoot,
      outputDirectory: path.relative(root, outputRoot).split(path.sep).join('/'),
    }
  }

  private async performSystemScan(options: ScanSystemOptions, workspace: ResolvedWorkspace): Promise<SystemScanResult> {
    await mkdir(path.join(workspace.outputRoot, 'runs'), { recursive: true })
    const protocolPack = await loadProtocolPack()
    if (!options.refresh) {
      const existing = await this.readRunState(workspace.outputRoot)
      if (existing !== undefined && reusable(existing.status) && existing.protocol?.digest === protocolPack.lock.packDigest) {
        return this.toResult(existing, true)
      }
    }

    const now = new Date()
    const runId = createRunId(now)
    let state: SystemScanRunState = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      protocol: {
        packId: protocolPack.lock.packId,
        version: protocolPack.lock.version,
        digest: protocolPack.lock.packDigest,
      },
      runId,
      status: 'DISCOVERING',
      gate: 'BLOCKED',
      validation: 'NOT_RUN',
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      workspaceRoot: '.',
      outputDirectory: workspace.outputDirectory,
      refresh: options.refresh ?? false,
      projectCount: 0,
      indexedProjectCount: 0,
      evidenceProjectCount: 0,
      scopeViolationCount: 0,
      transitions: [{ status: 'DISCOVERING', at: now.toISOString() }],
    }
    await this.writeRunState(workspace.outputRoot, state)

    try {
      const discovery = await discoverProjects({
        root: workspace.root,
        maxDepth: this.config.discoveryMaxDepth,
        outputDirectory: workspace.outputDirectory,
        signal: options.signal,
      })
      state = await this.transition(workspace.outputRoot, state, 'INDEXING', { projectCount: discovery.projects.length })
      options.onProgress?.({
        stage: 'INDEXING',
        message: `发现 ${discovery.projects.length} 个 Git 工程，开始建立或复用独立代码智能索引`,
        completed: 0,
        total: discovery.projects.length,
      })
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
      const analyzerOptions = {
        workspaceRoot: workspace.root,
        generatedAt,
        refresh: options.refresh ?? false,
        signal: options.signal,
        agent: options.agent,
        onProgress: options.onProgress,
      }
      const indexes = await this.analyzer.index(discovery.projects, analyzerOptions)
      state = await this.transition(workspace.outputRoot, state, 'COLLECTING_EVIDENCE', {
        indexedProjectCount: indexes.records.filter(record => record.status === 'FRESH').length,
      })
      options.onProgress?.({
        stage: 'COLLECTING_EVIDENCE',
        message: '代码智能索引阶段结束，开始按工程并行采集系统级粗粒度证据',
        completed: 0,
        total: discovery.projects.length,
      })
      const evidence = await this.analyzer.collectEvidence(discovery.projects, indexes, analyzerOptions)
      state = await this.transition(workspace.outputRoot, state, 'BUILDING_FACT_BASE', {
        evidenceProjectCount: evidence.records.filter(record => record.status === 'COLLECTED').length,
        scopeViolationCount: evidence.records.reduce((total, record) => total + Math.max(
          record.scopeViolations.length,
          record.scopeStatus === 'VIOLATION' ? 1 : 0,
        ), 0),
      })
      options.onProgress?.({ stage: 'BUILDING_FACT_BASE', message: '证据采集阶段结束，系统单写者开始综合事实底座' })
      const prepared = prepareSystemArtifacts(registry, indexes, evidence, generatedAt, protocolPack)
      const validation = prepared.validation
      await writeSystemArtifacts({ outputRoot: workspace.outputRoot, registry, indexes, evidence, ...prepared })
      state = await this.transition(workspace.outputRoot, state, 'VALIDATING', { validation: validation.status, gate: validation.gate })
      state = await this.transition(workspace.outputRoot, state, validation.gate === 'READY' ? 'COMPLETED' : 'BLOCKED', {
        finishedAt: new Date().toISOString(),
      })
      return this.toResult(state, false)
    } catch (error) {
      state = await this.transition(workspace.outputRoot, state, 'FAILED', {
        validation: 'FAILED',
        gate: 'BLOCKED',
        finishedAt: new Date().toISOString(),
        error: errorMessage(error),
      })
      throw error
    }
  }

  private async transition(
    outputRoot: string,
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
    await this.writeRunState(outputRoot, next)
    return next
  }

  private async writeRunState(outputRoot: string, state: SystemScanRunState): Promise<void> {
    await atomicWriteJson(path.join(outputRoot, 'runs', state.runId, 'state.json'), state)
    await atomicWriteJson(path.join(outputRoot, 'runs', 'latest.json'), { runId: state.runId })
  }

  private async readRunState(outputRoot: string, runId?: string): Promise<SystemScanRunState | undefined> {
    try {
      let resolvedRunId = runId
      if (resolvedRunId === undefined) {
        const latest = JSON.parse(await readFile(path.join(outputRoot, 'runs', 'latest.json'), 'utf8')) as { runId?: unknown }
        if (typeof latest.runId !== 'string') return undefined
        resolvedRunId = latest.runId
      }
      if (!/^[a-z0-9][a-z0-9-]*$/u.test(resolvedRunId)) throw new Error('Invalid ArchScope run id.')
      return JSON.parse(await readFile(path.join(outputRoot, 'runs', resolvedRunId, 'state.json'), 'utf8')) as SystemScanRunState
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
      indexedProjectCount: state.indexedProjectCount ?? 0,
      evidenceProjectCount: state.evidenceProjectCount ?? 0,
      scopeViolationCount: state.scopeViolationCount ?? 0,
      outputDirectory: state.outputDirectory,
      reused,
    }
  }
}

/** @deprecated Use ArchScopeService. */
export { ArchScopeService as KantuService }
