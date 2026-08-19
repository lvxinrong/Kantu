import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import type { KantuStatusResult, ProjectRegistry, SystemScanResult, SystemScanRunState, SystemValidationReport } from '../src/contracts/system-scan.js'
import type { ProtocolLock } from '../src/protocol/catalog.js'
import { KantuService } from '../src/service.js'
import type { SystemAnalyzer } from '../src/system/analyzer.js'
import { createStatusTool } from '../src/tools/status.js'
import { createSystemScanTool } from '../src/tools/system-scan.js'

const temporaryRoots: string[] = []

async function fixtureWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'kantu-service-'))
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
        protocolVersion: 'kantu/system-scan/v1',
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
        protocolVersion: 'kantu/system-scan/v1',
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('KantuService system scan', () => {
  it('opens the project gate after fresh indexes and isolated evidence collection complete', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const analyzer = completeAnalyzer()
    const service = new KantuService(new Context(), {
      workspaceRoot,
      outputDirectory: 'kantu_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    }, analyzer)

    const result = await service.scanSystem()
    const evidence = await readFile(path.join(workspaceRoot, 'kantu_docs/system/evidence/index.json'), 'utf8')
    const factBase = await readFile(path.join(workspaceRoot, 'kantu_docs/system/00-system-fact-base.md'), 'utf8')

    expect(result).toMatchObject({
      status: 'COMPLETED',
      gate: 'READY',
      validation: 'PASSED',
      projectCount: 1,
      indexedProjectCount: 1,
      evidenceProjectCount: 1,
      scopeViolationCount: 0,
    })
    expect(evidence).toContain('Web entry')
    expect(factBase).toContain('| 文档状态 | 完整 |')
    expect(factBase).toContain('| 下层门禁 | READY |')
  })

  it('persists a truthful draft, run state, and deterministic validation', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new KantuService(new Context(), {
      workspaceRoot,
      outputDirectory: 'kantu_docs',
      discoveryMaxDepth: 3,
      registerCommand: true,
      registerSystemScanTool: true,
      registerStatusTool: true,
    })

    const first = await service.scanSystem()
    const second = await service.scanSystem()
    const status = await service.status(first.runId)
    const registry = JSON.parse(await readFile(path.join(workspaceRoot, 'kantu_docs/system/project-registry.json'), 'utf8')) as ProjectRegistry
    const validation = JSON.parse(await readFile(path.join(workspaceRoot, 'kantu_docs/system/validation.json'), 'utf8')) as SystemValidationReport
    const protocolLock = JSON.parse(await readFile(path.join(workspaceRoot, 'kantu_docs/system/protocol-lock.json'), 'utf8')) as ProtocolLock
    const runState = JSON.parse(await readFile(path.join(workspaceRoot, `kantu_docs/runs/${first.runId}/state.json`), 'utf8')) as SystemScanRunState
    const factBase = await readFile(path.join(workspaceRoot, 'kantu_docs/system/00-system-fact-base.md'), 'utf8')

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
    expect(factBase).toContain('系统级定世界观，项目级定工程画像，模块级定职责边界，代码级定执行链路')
    expect(factBase).toContain('源码存在不代表生产启用')
  })

  it('creates a new run only when refresh is requested', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new KantuService(new Context(), {
      workspaceRoot,
      outputDirectory: 'kantu_docs',
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
    const service = new KantuService(new Context(), {
      workspaceRoot,
      outputDirectory: 'kantu_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: true,
      registerStatusTool: true,
    })
    const execution = { signal: new AbortController().signal } as never

    const scan = await createSystemScanTool(service).execute({ refresh: false }, execution) as SystemScanResult
    const status = await createStatusTool(service).execute({ runId: scan.runId }, execution) as KantuStatusResult

    expect(scan).toMatchObject({ status: 'BLOCKED', gate: 'BLOCKED', projectCount: 1 })
    expect(status).toMatchObject({ found: true, runId: scan.runId, validation: 'PASSED' })
  })

  it('uses the invoking DeepSeek Harness session workspace when no override is configured', async () => {
    const workspaceRoot = await fixtureWorkspace()
    const service = new KantuService(new Context(), {
      outputDirectory: 'kantu_docs',
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
    const registry = JSON.parse(await readFile(path.join(workspaceRoot, 'kantu_docs/system/project-registry.json'), 'utf8')) as ProjectRegistry
    const status = await createStatusTool(service).execute({ runId: scan.runId }, execution) as KantuStatusResult

    expect(scan.projectCount).toBe(1)
    expect(registry.projects[0]?.projectDir).toBe('.')
    expect(status).toMatchObject({ found: true, runId: scan.runId })
  })

  it('fails closed without a session workspace or an absolute headless override', async () => {
    const service = new KantuService(new Context(), {
      outputDirectory: 'kantu_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })

    await expect(service.scanSystem()).rejects.toThrow('DeepSeek Harness session workspace')
  })

  it('rejects output paths outside the workspace', async () => {
    const workspaceRoot = await fixtureWorkspace()

    const service = new KantuService(new Context(), {
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

    const service = new KantuService(new Context(), {
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, 'kantu_docs'),
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })

    await expect(service.scanSystem()).rejects.toThrow('relative to workspaceRoot')
  })
})
