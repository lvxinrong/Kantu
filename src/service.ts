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
  type IndexManifest,
  type SystemEvidenceBundle,
  type SystemHistoryIndex,
  type SystemHistoryRevision,
  type SystemRelationCatalog,
  type SystemScanResult,
  type SystemScanRunState,
  type SystemScanProgress,
  type SystemScanStatus,
  type SystemSynthesisCommitResult,
  type SystemSynthesisContext,
  type SystemProjectEvidenceContext,
  type SystemSynthesisDraft,
  type SystemSynthesisWriter,
} from './contracts/system-scan.js'
import { loadProtocolPack } from './protocol/catalog.js'
import {
  atomicWriteJson,
  prepareSynthesizedSystemArtifacts,
  writeSystemEvidenceArtifacts,
  writeSynthesizedSystemArtifacts,
} from './system/artifacts.js'
import { DshSystemAnalyzer, type SystemAnalyzer } from './system/analyzer.js'
import { discoverProjects } from './system/discovery.js'
import { buildSystemRelationCatalog } from './system/relations.js'
import {
  buildSystemSynthesisContext,
  systemSynthesisInputDigest,
  systemSynthesisOutputDigest,
} from './system/synthesis.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    archscope: ArchScopeService
  }
}

function reusable(status: SystemScanStatus): boolean {
  return status === 'COMPLETED' || status === 'AWAITING_SYNTHESIS' || status === 'SYNTHESIZING'
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

function nextSystemRevision(history: SystemHistoryIndex): string {
  const highest = history.revisions.reduce((maximum, record) => {
    const match = /^S(\d+)$/u.exec(record.revision)
    return match === null ? maximum : Math.max(maximum, Number(match[1]))
  }, 0)
  return `S${String(highest + 1).padStart(4, '0')}`
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

export interface SynthesisOptions {
  workspaceRoot?: string
}

export interface SystemProjectEvidenceOptions extends SynthesisOptions {
  projectKeys: string[]
}

export interface CommitSystemSynthesisOptions extends SynthesisOptions {
  runId: string
  draft: SystemSynthesisDraft
  writer: SystemSynthesisWriter
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
        documentRevision: 'NONE',
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
      documentRevision: state.documentRevision ?? 'LEGACY',
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

  async getSystemSynthesisContext(runId: string, options: SynthesisOptions = {}): Promise<SystemSynthesisContext> {
    const workspace = this.resolveWorkspace(options.workspaceRoot)
    const state = await this.readRunState(workspace.outputRoot, runId)
    if (state === undefined) throw new Error(`ArchScope run was not found: ${runId}`)
    if (state.status !== 'AWAITING_SYNTHESIS' && state.status !== 'SYNTHESIZING') {
      throw new Error(`ArchScope run ${runId} is ${state.status}; synthesis context is available only for a pending system writer.`)
    }
    const pack = await loadProtocolPack()
    if (state.protocol.digest !== pack.lock.packDigest) {
      throw new Error('ArchScope protocol changed after evidence collection; start a refreshed system scan.')
    }
    const { registry, indexes, evidence, relations } = await this.readSystemInputs(workspace.outputRoot, runId)
    const inputDigest = systemSynthesisInputDigest(registry, indexes, evidence, relations)
    if (state.synthesisInputDigest === undefined || state.synthesisInputDigest !== inputDigest) {
      throw new Error('ArchScope evidence no longer matches this run; start or resume the latest system scan.')
    }
    if (state.status === 'AWAITING_SYNTHESIS') {
      await this.transition(workspace.outputRoot, state, 'SYNTHESIZING')
    }
    return buildSystemSynthesisContext(runId, pack, registry, indexes, evidence, relations, this.config)
  }

  async getSystemProjectEvidence(runId: string, options: SystemProjectEvidenceOptions): Promise<SystemProjectEvidenceContext> {
    const workspace = this.resolveWorkspace(options.workspaceRoot)
    const state = await this.readRunState(workspace.outputRoot, runId)
    if (state === undefined) throw new Error(`ArchScope run was not found: ${runId}`)
    if (state.status !== 'AWAITING_SYNTHESIS' && state.status !== 'SYNTHESIZING') {
      throw new Error(`ArchScope run ${runId} is ${state.status}; project evidence is available only during pending synthesis.`)
    }
    const projectKeys = [...new Set(options.projectKeys.map(key => key.trim()).filter(Boolean))]
    if (projectKeys.length === 0 || projectKeys.length > 8) {
      throw new Error('ArchScope project evidence retrieval requires between 1 and 8 unique project keys.')
    }
    const pack = await loadProtocolPack()
    if (state.protocol.digest !== pack.lock.packDigest) {
      throw new Error('ArchScope protocol changed after evidence collection; start a refreshed system scan.')
    }
    const { registry, indexes, evidence, relations } = await this.readSystemInputs(workspace.outputRoot, runId)
    const inputDigest = systemSynthesisInputDigest(registry, indexes, evidence, relations)
    if (state.synthesisInputDigest === undefined || state.synthesisInputDigest !== inputDigest) {
      throw new Error('ArchScope evidence no longer matches this run; start or resume the latest system scan.')
    }
    const byKey = new Map(evidence.records.map(record => [record.projectKey, record]))
    const records = projectKeys.flatMap(key => {
      const record = byKey.get(key)
      return record === undefined ? [] : [record]
    })
    return {
      runId,
      protocolDigest: pack.lock.packDigest,
      projectKeys: records.map(record => record.projectKey),
      missingProjectKeys: projectKeys.filter(key => !byKey.has(key)),
      evidenceJson: JSON.stringify(records),
    }
  }

  async commitSystemSynthesis(options: CommitSystemSynthesisOptions): Promise<SystemSynthesisCommitResult> {
    const workspace = this.resolveWorkspace(options.workspaceRoot)
    const state = await this.readRunState(workspace.outputRoot, options.runId)
    if (state === undefined) throw new Error(`ArchScope run was not found: ${options.runId}`)
    if (state.status !== 'AWAITING_SYNTHESIS' && state.status !== 'SYNTHESIZING') {
      throw new Error(`ArchScope run ${options.runId} is ${state.status}; it does not accept a system synthesis.`)
    }
    const pack = await loadProtocolPack()
    if (state.protocol.digest !== pack.lock.packDigest) {
      throw new Error('ArchScope protocol changed after evidence collection; start a refreshed system scan.')
    }
    const { registry, indexes, evidence, relations } = await this.readSystemInputs(workspace.outputRoot, options.runId)
    const inputDigest = systemSynthesisInputDigest(registry, indexes, evidence, relations)
    if (state.synthesisInputDigest === undefined || state.synthesisInputDigest !== inputDigest) {
      throw new Error('ArchScope evidence no longer matches this run; start or resume the latest system scan.')
    }
    const attempt = (state.synthesisAttempts ?? 0) + 1
    const generatedAt = new Date().toISOString()
    let prepared = prepareSynthesizedSystemArtifacts(registry, indexes, evidence, relations, generatedAt, pack, options.draft)
    const retryAllowed = prepared.validation.status === 'FAILED' && attempt < 2
    const history = retryAllowed ? undefined : await this.readSystemHistory(workspace.outputRoot)
    const documentRevision = history === undefined ? 'PENDING' : nextSystemRevision(history)
    if (history !== undefined) {
      prepared = prepareSynthesizedSystemArtifacts(registry, indexes, evidence, relations, generatedAt, pack, options.draft, documentRevision)
    }
    const nextStatus: SystemScanStatus = retryAllowed
      ? 'SYNTHESIZING'
      : prepared.validation.status === 'FAILED' || prepared.validation.gate === 'BLOCKED'
        ? 'BLOCKED'
        : 'COMPLETED'
    const publishCurrent = !retryAllowed && prepared.validation.status === 'PASSED'
    const synthesis = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      runId: options.runId,
      documentRevision,
      ...history?.latestRevision === undefined ? {} : { previousRevision: history.latestRevision },
      generatedAt,
      writer: options.writer,
      attempt,
      protocolDigest: pack.lock.packDigest,
      inputDigest,
      outputDigest: systemSynthesisOutputDigest(options.draft),
    } as const
    await writeSynthesizedSystemArtifacts({
      outputRoot: workspace.outputRoot,
      registry,
      indexes,
      evidence,
      relations,
      synthesis,
      finalizeRevision: !retryAllowed,
      publishCurrent,
      ...prepared,
    })
    if (history !== undefined) {
      const revision: SystemHistoryRevision = {
        revision: documentRevision,
        ...history.latestRevision === undefined ? {} : { previousRevision: history.latestRevision },
        runId: options.runId,
        generatedAt,
        status: nextStatus,
        gate: prepared.validation.gate,
        validation: prepared.validation.status,
        protocol: state.protocol,
        synthesisAttempt: attempt,
        outputDigest: synthesis.outputDigest,
        publishedAsCurrent: publishCurrent,
        artifactRoot: `runs/${options.runId}/system`,
      }
      await this.writeSystemHistory(workspace.outputRoot, {
        protocolVersion: SYSTEM_SCAN_PROTOCOL,
        updatedAt: generatedAt,
        latestRevision: documentRevision,
        ...publishCurrent ? { currentRevision: documentRevision } : history.currentRevision === undefined ? {} : { currentRevision: history.currentRevision },
        revisions: [...history.revisions, revision],
      })
    }
    const next = await this.transition(workspace.outputRoot, state, nextStatus, {
      documentRevision,
      synthesisAttempts: attempt,
      validation: prepared.validation.status,
      gate: prepared.validation.gate,
      ...retryAllowed ? {} : { finishedAt: generatedAt },
    })
    return {
      ...this.toResult(next, false),
      synthesisAttempt: attempt,
      retryAllowed,
      issues: prepared.validation.issues,
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
      documentRevision: 'PENDING',
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
      const relations = buildSystemRelationCatalog(registry, evidence)
      await writeSystemEvidenceArtifacts({
        outputRoot: path.join(workspace.outputRoot, 'runs', runId),
        registry,
        indexes,
        evidence,
        relations,
        protocolLock: protocolPack.lock,
      })
      state = await this.transition(workspace.outputRoot, state, 'AWAITING_SYNTHESIS', {
        evidenceProjectCount: evidence.records.filter(record => record.status === 'COLLECTED').length,
        scopeViolationCount: evidence.records.reduce((total, record) => total + Math.max(
          record.scopeViolations.length,
          record.scopeStatus === 'VIOLATION' ? 1 : 0,
        ), 0),
        synthesisInputDigest: systemSynthesisInputDigest(registry, indexes, evidence, relations),
      })
      options.onProgress?.({ stage: 'AWAITING_SYNTHESIS', message: '单工程证据已持久化，等待当前主 Agent 综合系统世界观' })
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

  private async readSystemInputs(outputRoot: string, runId: string): Promise<{
    registry: ProjectRegistry
    indexes: IndexManifest
    evidence: SystemEvidenceBundle
    relations: SystemRelationCatalog
  }> {
    const systemRoot = path.join(outputRoot, 'runs', runId, 'system')
    const [registry, indexes, evidence, relations] = await Promise.all([
      readFile(path.join(systemRoot, 'project-registry.json'), 'utf8'),
      readFile(path.join(systemRoot, 'index-manifest.json'), 'utf8'),
      readFile(path.join(systemRoot, 'evidence', 'index.json'), 'utf8'),
      readFile(path.join(systemRoot, 'relations.json'), 'utf8'),
    ])
    return {
      registry: JSON.parse(registry) as ProjectRegistry,
      indexes: JSON.parse(indexes) as IndexManifest,
      evidence: JSON.parse(evidence) as SystemEvidenceBundle,
      relations: JSON.parse(relations) as SystemRelationCatalog,
    }
  }

  private async readSystemHistory(outputRoot: string): Promise<SystemHistoryIndex> {
    try {
      const parsed = JSON.parse(await readFile(path.join(outputRoot, 'system', 'history.json'), 'utf8')) as Partial<SystemHistoryIndex>
      if (parsed.protocolVersion !== SYSTEM_SCAN_PROTOCOL || !Array.isArray(parsed.revisions)) {
        throw new Error('ArchScope system history is malformed or uses an unsupported protocol.')
      }
      const revisions = parsed.revisions
      if (new Set(revisions.map(record => record.revision)).size !== revisions.length) {
        throw new Error('ArchScope system history contains duplicate revisions.')
      }
      return {
        protocolVersion: SYSTEM_SCAN_PROTOCOL,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        ...typeof parsed.latestRevision === 'string' ? { latestRevision: parsed.latestRevision } : {},
        ...typeof parsed.currentRevision === 'string' ? { currentRevision: parsed.currentRevision } : {},
        revisions,
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { protocolVersion: SYSTEM_SCAN_PROTOCOL, updatedAt: new Date(0).toISOString(), revisions: [] }
      }
      throw error
    }
  }

  private async writeSystemHistory(outputRoot: string, history: SystemHistoryIndex): Promise<void> {
    await atomicWriteJson(path.join(outputRoot, 'system', 'history.json'), history)
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
      documentRevision: state.documentRevision ?? 'LEGACY',
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
