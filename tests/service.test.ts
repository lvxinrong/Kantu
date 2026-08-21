import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import type { ArchScopeStatusResult, IndexManifest, ProjectRegistry, SystemEvidenceBundle, SystemHistoryIndex, SystemScanResult, SystemScanRunState, SystemValidationReport } from '../src/contracts/system-scan.js'
import type { ProtocolLock } from '../src/protocol/catalog.js'
import { ArchScopeService } from '../src/service.js'
import type { SystemAnalyzer } from '../src/system/analyzer.js'
import { createStatusTool } from '../src/tools/status.js'
import { createSystemScanTool } from '../src/tools/system-scan.js'
import {
  renderEntryOverviewDiagram,
  renderInternalRelationsDiagram,
  renderSystemContextDiagram,
  renderSystemFactBase,
  validateSystemArtifacts,
} from '../src/system/artifacts.js'

const temporaryRoots: string[] = []

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'archscope-service-'))
  temporaryRoots.push(root)
  await mkdir(path.join(root, '.git'), { recursive: true })
  await writeFile(path.join(root, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n')
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '1.0.0' } }))
  return root
}

function completeAnalyzer(): SystemAnalyzer {
  return {
    async index(projects, options) {
      return {
        protocolVersion: 'archscope/system-scan/v1',
        generatedAt: options.generatedAt,
        records: projects.map(project => ({
          projectKey: project.projectKey,
          projectDir: project.projectDir,
          provider: 'codebase-memory-mcp',
          status: 'FRESH',
          reason: 'test index',
          mcpProject: 'fixture-project',
        })),
      }
    },
    async collectEvidence(projects, _indexes, options) {
      return {
        protocolVersion: 'archscope/system-scan/v1',
        generatedAt: options.generatedAt,
        records: projects.map(project => ({
          projectKey: project.projectKey,
          projectDir: project.projectDir,
          mcpProject: 'fixture-project',
          status: 'COLLECTED',
          projectTypeCandidates: ['web-frontend'],
          entries: ['Web entry — src/main.tsx'],
          outboundDependencies: [],
          dataAssets: [],
          infrastructure: ['Node build — package.json'],
          aliases: [],
          capabilityCandidates: ['Web interface — src/App.tsx'],
          evidencePaths: ['package.json', 'src/main.tsx'],
          conflicts: [],
          scopeStatus: 'CLEAN',
          scopeViolations: [],
        })),
      }
    },
  }
}

async function commitFixtureSynthesis(service: ArchScopeService, workspaceRoot: string, runId: string) {
  await service.getSystemSynthesisContext(runId)
  const runSystemRoot = path.join(workspaceRoot, 'archscope_docs', 'runs', runId, 'system')
  const registry = JSON.parse(await readFile(path.join(runSystemRoot, 'project-registry.json'), 'utf8')) as ProjectRegistry
  const indexes = JSON.parse(await readFile(path.join(runSystemRoot, 'index-manifest.json'), 'utf8')) as IndexManifest
  const evidence = JSON.parse(await readFile(path.join(runSystemRoot, 'evidence', 'index.json'), 'utf8')) as SystemEvidenceBundle
  const validation = validateSystemArtifacts(registry, indexes, registry.generatedAt, evidence)
  return service.commitSystemSynthesis({
    runId,
    writer: { kind: 'dsh-main-agent', sessionId: 'test-session', provider: 'test', model: 'test-model' },
    draft: {
      factBase: renderSystemFactBase(registry, indexes, evidence, validation),
      diagrams: {
        systemContext: renderSystemContextDiagram(registry.projects, evidence),
        internalRelations: renderInternalRelationsDiagram(registry.projects, evidence),
        entryOverview: renderEntryOverviewDiagram(registry.projects, evidence),
      },
    },
  })
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('ArchScopeService system scan', () => {
  it('opens the project gate after fresh indexes and isolated evidence collection complete', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const analyzer = completeAnalyzer()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    }, analyzer)

    const pending = await service.scanSystem()
    const context = await service.getSystemSynthesisContext(pending.runId)
    const pendingRegistry = JSON.parse(await readFile(path.join(workspaceRoot, `archscope_docs/runs/${pending.runId}/system/project-registry.json`), 'utf8')) as ProjectRegistry
    const projectKey = pendingRegistry.projects[0]?.projectKey as string
    const projectEvidence = await service.getSystemProjectEvidence(pending.runId, { projectKeys: [projectKey] })
    const result = await commitFixtureSynthesis(service, workspaceRoot, pending.runId)
    const evidence = await readFile(path.join(workspaceRoot, 'archscope_docs/system/evidence/index.json'), 'utf8')
    const factBase = await readFile(path.join(workspaceRoot, 'archscope_docs/system/00-system-fact-base.md'), 'utf8')
    const synthesis = JSON.parse(await readFile(path.join(workspaceRoot, 'archscope_docs/system/synthesis.json'), 'utf8')) as { writer: { kind: string, sessionId: string }, inputDigest: string, outputDigest: string }

    expect(result).toMatchObject({
      documentRevision: 'S0001',
      status: 'COMPLETED',
      gate: 'READY',
      validation: 'PASSED',
      projectCount: 1,
      indexedProjectCount: 1,
      evidenceProjectCount: 1,
      scopeViolationCount: 0,
    })
    expect(evidence).toContain('Web entry')
    expect(context.prompt).toContain('当前 DeepSeek Harness 会话的系统级主写者')
    expect(context.prompt).toContain('Web entry')
    expect(context.prompt).toContain('archscope_get_system_project_evidence')
    expect(projectEvidence.evidenceJson).toContain('Web entry')
    expect(projectEvidence.projectKeys).toEqual([projectKey])
    expect(factBase).toContain('| 文档状态 | 完整 |')
    expect(factBase).toContain('| 事实版本 | S0001 |')
    expect(factBase).toContain('| 下层门禁 | READY |')
    expect(synthesis.writer).toEqual(expect.objectContaining({ kind: 'dsh-main-agent', sessionId: 'test-session' }))
    expect(synthesis.inputDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(synthesis.outputDigest).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('allows the main agent one deterministic repair after an invalid synthesis', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    }, completeAnalyzer())

    const pending = await service.scanSystem()
    await service.getSystemSynthesisContext(pending.runId)
    const invalid = await service.commitSystemSynthesis({
      runId: pending.runId,
      writer: { kind: 'dsh-main-agent', sessionId: 'test-session' },
      draft: {
        factBase: '# invalid',
        diagrams: { systemContext: 'invalid', internalRelations: 'invalid', entryOverview: 'invalid' },
      },
    })
    const repaired = await commitFixtureSynthesis(service, workspaceRoot, pending.runId)
    const firstAttempt = JSON.parse(await readFile(path.join(workspaceRoot, `archscope_docs/runs/${pending.runId}/synthesis/attempt-1/attempt.json`), 'utf8')) as { attempt: number, validation: SystemValidationReport }
    const secondAttempt = JSON.parse(await readFile(path.join(workspaceRoot, `archscope_docs/runs/${pending.runId}/synthesis/attempt-2/attempt.json`), 'utf8')) as { attempt: number, validation: SystemValidationReport }
    const firstDraft = await readFile(path.join(workspaceRoot, `archscope_docs/runs/${pending.runId}/synthesis/attempt-1/00-system-fact-base.md`), 'utf8')

    expect(invalid).toMatchObject({ status: 'SYNTHESIZING', validation: 'FAILED', synthesisAttempt: 1, retryAllowed: true })
    expect(invalid.issues.some(issue => issue.code === 'SYSTEM_HEADINGS_INVALID')).toBe(true)
    expect(repaired).toMatchObject({ status: 'COMPLETED', validation: 'PASSED', synthesisAttempt: 2, retryAllowed: false })
    expect(firstAttempt).toMatchObject({ attempt: 1, validation: { status: 'FAILED' } })
    expect(secondAttempt).toMatchObject({ attempt: 2, validation: { status: 'PASSED' } })
    expect(firstDraft).toContain('# invalid')
  })

  it('keeps immutable system revisions and promotes only a validated terminal run', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    }, completeAnalyzer())

    const firstPending = await service.scanSystem()
    const first = await commitFixtureSynthesis(service, workspaceRoot, firstPending.runId)
    const currentPath = path.join(workspaceRoot, 'archscope_docs/system/00-system-fact-base.md')
    const firstSnapshotPath = path.join(workspaceRoot, `archscope_docs/runs/${first.runId}/system/00-system-fact-base.md`)
    const firstCurrent = await readFile(currentPath, 'utf8')
    const firstSnapshot = await readFile(firstSnapshotPath, 'utf8')

    const secondPending = await service.scanSystem({ refresh: true })
    const currentWhilePending = await readFile(currentPath, 'utf8')
    const stagedRegistry = JSON.parse(await readFile(path.join(workspaceRoot, `archscope_docs/runs/${secondPending.runId}/system/project-registry.json`), 'utf8')) as ProjectRegistry
    const second = await commitFixtureSynthesis(service, workspaceRoot, secondPending.runId)
    const secondCurrent = await readFile(currentPath, 'utf8')
    const preservedFirstSnapshot = await readFile(firstSnapshotPath, 'utf8')
    const history = JSON.parse(await readFile(path.join(workspaceRoot, 'archscope_docs/system/history.json'), 'utf8')) as SystemHistoryIndex

    expect(first.documentRevision).toBe('S0001')
    expect(second.documentRevision).toBe('S0002')
    expect(firstCurrent).toBe(firstSnapshot)
    expect(currentWhilePending).toBe(firstCurrent)
    expect(stagedRegistry.projectCount).toBe(1)
    expect(secondCurrent).toContain('| 事实版本 | S0002 |')
    expect(preservedFirstSnapshot).toBe(firstSnapshot)
    expect(history).toMatchObject({ latestRevision: 'S0002', currentRevision: 'S0002' })
    expect(history.revisions).toEqual([
      expect.objectContaining({ revision: 'S0001', runId: first.runId, publishedAsCurrent: true }),
      expect.objectContaining({ revision: 'S0002', previousRevision: 'S0001', runId: second.runId, publishedAsCurrent: true }),
    ])
  })

  it('archives a terminal failed revision without replacing the current fact base', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    }, completeAnalyzer())

    const firstPending = await service.scanSystem()
    const first = await commitFixtureSynthesis(service, workspaceRoot, firstPending.runId)
    const currentPath = path.join(workspaceRoot, 'archscope_docs/system/00-system-fact-base.md')
    const published = await readFile(currentPath, 'utf8')
    const failedPending = await service.scanSystem({ refresh: true })
    await service.getSystemSynthesisContext(failedPending.runId)
    const invalidDraft = {
      factBase: '# invalid',
      diagrams: { systemContext: 'invalid', internalRelations: 'invalid', entryOverview: 'invalid' },
    }
    const repairRequested = await service.commitSystemSynthesis({
      runId: failedPending.runId,
      writer: { kind: 'dsh-main-agent', sessionId: 'test-session' },
      draft: invalidDraft,
    })
    const failed = await service.commitSystemSynthesis({
      runId: failedPending.runId,
      writer: { kind: 'dsh-main-agent', sessionId: 'test-session' },
      draft: invalidDraft,
    })
    const currentAfterFailure = await readFile(currentPath, 'utf8')
    const failedSnapshot = await readFile(path.join(workspaceRoot, `archscope_docs/runs/${failed.runId}/system/00-system-fact-base.md`), 'utf8')
    const history = JSON.parse(await readFile(path.join(workspaceRoot, 'archscope_docs/system/history.json'), 'utf8')) as SystemHistoryIndex

    expect(first.documentRevision).toBe('S0001')
    expect(repairRequested).toMatchObject({ documentRevision: 'PENDING', retryAllowed: true, validation: 'FAILED' })
    expect(failed).toMatchObject({ documentRevision: 'S0002', status: 'BLOCKED', retryAllowed: false, validation: 'FAILED' })
    expect(currentAfterFailure).toBe(published)
    expect(failedSnapshot).toContain('# invalid')
    expect(history).toMatchObject({ latestRevision: 'S0002', currentRevision: 'S0001' })
    expect(history.revisions.at(-1)).toEqual(expect.objectContaining({ revision: 'S0002', publishedAsCurrent: false }))
  })

  it('bounds targeted synthesis evidence retrieval to known persisted projects', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    }, completeAnalyzer())
    const pending = await service.scanSystem()
    const registry = JSON.parse(await readFile(path.join(workspaceRoot, `archscope_docs/runs/${pending.runId}/system/project-registry.json`), 'utf8')) as ProjectRegistry
    const projectKey = registry.projects[0]?.projectKey as string

    const evidence = await service.getSystemProjectEvidence(pending.runId, { projectKeys: [projectKey, 'missing'] })

    expect(evidence.projectKeys).toEqual([projectKey])
    expect(evidence.missingProjectKeys).toEqual(['missing'])
    expect(JSON.parse(evidence.evidenceJson)).toHaveLength(1)
    await expect(service.getSystemProjectEvidence(pending.runId, { projectKeys: [] })).rejects.toThrow('between 1 and 8')
  })

  it('persists a truthful draft, run state, and deterministic validation', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: true,
      registerSystemScanTool: true,
      registerStatusTool: true,
    })

    const pending = await service.scanSystem()
    const first = await commitFixtureSynthesis(service, workspaceRoot, pending.runId)
    const second = await service.scanSystem()
    const status = await service.status(first.runId)
    const registry = JSON.parse(await readFile(path.join(workspaceRoot, 'archscope_docs/system/project-registry.json'), 'utf8')) as ProjectRegistry
    const validation = JSON.parse(await readFile(path.join(workspaceRoot, 'archscope_docs/system/validation.json'), 'utf8')) as SystemValidationReport
    const protocolLock = JSON.parse(await readFile(path.join(workspaceRoot, 'archscope_docs/system/protocol-lock.json'), 'utf8')) as ProtocolLock
    const runState = JSON.parse(await readFile(path.join(workspaceRoot, `archscope_docs/runs/${first.runId}/state.json`), 'utf8')) as SystemScanRunState
    const factBase = await readFile(path.join(workspaceRoot, 'archscope_docs/system/00-system-fact-base.md'), 'utf8')

    expect(pending).toMatchObject({
      status: 'AWAITING_SYNTHESIS',
      gate: 'BLOCKED',
      validation: 'NOT_RUN',
    })
    expect(first).toMatchObject({
      status: 'BLOCKED',
      gate: 'BLOCKED',
      validation: 'PASSED',
      projectCount: 1,
      indexedProjectCount: 0,
      evidenceProjectCount: 0,
      scopeViolationCount: 0,
      reused: false,
    })
    expect(second).toMatchObject({ reused: false })
    expect(second.runId).not.toBe(first.runId)
    expect(status).toMatchObject({ found: true, runId: first.runId, gate: 'BLOCKED' })
    expect(registry.projects[0]).toMatchObject({ projectDir: '.', projectType: 'web-frontend', productionStatus: 'UNCONFIRMED' })
    expect(validation.issues.map(issue => issue.code)).toContain('RUNTIME_EVIDENCE_MISSING')
    expect(validation.protocol?.digest).toBe(protocolLock.packDigest)
    expect(runState.protocol.digest).toBe(protocolLock.packDigest)
    expect(factBase).toContain('系统级定世界观，项目级定工程画像，模块级定内部边界，代码级定具体链路')
    expect(factBase).toContain('源码存在不代表生产启用')
  })

  it('creates a new run only when refresh is requested', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    }, completeAnalyzer())

    const first = await service.scanSystem()
    const reused = await service.scanSystem()
    const refreshed = await service.scanSystem({ refresh: true })

    expect(reused).toMatchObject({ runId: first.runId, reused: true })
    expect(refreshed.runId).not.toBe(first.runId)
    expect(refreshed.reused).toBe(false)
  })

  it('runs the model-facing scan and status tool bodies without a model API', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: true,
      registerStatusTool: true,
    })
    const execution = { signal: new AbortController().signal } as never

    const scan = await createSystemScanTool(service).execute({ refresh: false }, execution) as SystemScanResult
    const status = await createStatusTool(service).execute({ runId: scan.runId }, execution) as ArchScopeStatusResult

    expect(scan).toMatchObject({ status: 'AWAITING_SYNTHESIS', gate: 'BLOCKED', projectCount: 1 })
    expect(status).toMatchObject({ found: true, runId: scan.runId, validation: 'NOT_RUN' })
  })

  it('uses the invoking DeepSeek Harness session workspace when no override is configured', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new ArchScopeService(new Context(), {
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: true,
      registerStatusTool: true,
    })
    const execution = {
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: workspaceRoot } } },
    } as never

    const scan = await createSystemScanTool(service).execute({ refresh: false }, execution) as SystemScanResult
    const registry = JSON.parse(await readFile(path.join(workspaceRoot, `archscope_docs/runs/${scan.runId}/system/project-registry.json`), 'utf8')) as ProjectRegistry
    const status = await createStatusTool(service).execute({ runId: scan.runId }, execution) as ArchScopeStatusResult

    expect(scan.projectCount).toBe(1)
    expect(registry.projects[0]?.projectDir).toBe('.')
    expect(status).toMatchObject({ found: true, runId: scan.runId })
  })

  it('fails closed without a session workspace or an absolute headless override', async () => {
    const service = new ArchScopeService(new Context(), {
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })

    await expect(service.scanSystem()).rejects.toThrow('DeepSeek Harness session workspace')
  })

  it('rejects output paths outside the workspace', async () => {
    const workspaceRoot = await fixtureWorkspace()

    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: '../outside',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })

    await expect(service.scanSystem()).rejects.toThrow('inside workspaceRoot')
  })

  it('rejects absolute output paths even when they point into the workspace', async () => {
    const workspaceRoot = await fixtureWorkspace()

    const service = new ArchScopeService(new Context(), {
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, 'archscope_docs'),
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })

    await expect(service.scanSystem()).rejects.toThrow('relative to workspaceRoot')
  })
})
