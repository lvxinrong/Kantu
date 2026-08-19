import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'

import type { KantuStatusResult, ProjectRegistry, SystemScanResult, SystemValidationReport } from '../src/contracts/system-scan.js'
import { KantuService } from '../src/service.js'
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('KantuService system scan', () => {
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
    const factBase = await readFile(path.join(workspaceRoot, 'kantu_docs/system/00-system-fact-base.md'), 'utf8')

    expect(first).toMatchObject({ status: 'BLOCKED', gate: 'BLOCKED', validation: 'PASSED', projectCount: 1, reused: false })
    expect(second).toMatchObject({ runId: first.runId, reused: true })
    expect(status).toMatchObject({ found: true, runId: first.runId, gate: 'BLOCKED' })
    expect(registry.projects[0]).toMatchObject({ projectDir: '.', projectType: 'web-frontend', productionStatus: 'UNCONFIRMED' })
    expect(validation.issues.map(issue => issue.code)).toContain('RUNTIME_EVIDENCE_MISSING')
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
    })

    const first = await service.scanSystem()
    const refreshed = await service.scanSystem({ refresh: true })

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

  it('rejects output paths outside the workspace', async () => {
    const workspaceRoot = await fixtureWorkspace()

    expect(() => new KantuService(new Context(), {
      workspaceRoot,
      outputDirectory: '../outside',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })).toThrow('inside workspaceRoot')
  })

  it('rejects absolute output paths even when they point into the workspace', async () => {
    const workspaceRoot = await fixtureWorkspace()

    expect(() => new KantuService(new Context(), {
      workspaceRoot,
      outputDirectory: path.join(workspaceRoot, 'kantu_docs'),
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })).toThrow('relative to workspaceRoot')
  })
})
