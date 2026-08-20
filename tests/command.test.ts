import { describe, expect, it } from 'vitest'

import {
  createArchScopeCommand,
  executeArchScopeIntent,
  ARCHSCOPE_COMMAND_HELP,
  parseKantuCommand,
  parseArchScopeCommand,
  type ArchScopeCommandRuntime,
} from '../src/commands/archscope.js'

describe('parseArchScopeCommand', () => {
  it.each([
    ['', { kind: 'help' }],
    ['help', { kind: 'help' }],
    ['帮助', { kind: 'help' }],
    ['system', { kind: 'system.scan', refresh: false }],
    ['system --refresh', { kind: 'system.scan', refresh: true }],
    ['系统级扫描', { kind: 'system.scan', refresh: false }],
    ['project sfa-backend', { kind: 'project.scan', projectKey: 'sfa-backend', refresh: false }],
    ['项目级扫描 sfa-backend --refresh', { kind: 'project.scan', projectKey: 'sfa-backend', refresh: true }],
    ['status', { kind: 'run.status' }],
    ['状态 run-1', { kind: 'run.status', runId: 'run-1' }],
    ['resume run-1', { kind: 'run.resume', runId: 'run-1' }],
    ['继续', { kind: 'run.resume' }],
  ])('parses %j into a stable intent', (input, intent) => {
    expect(parseArchScopeCommand(input)).toEqual({ ok: true, intent })
  })

  it.each([
    'system now',
    'project',
    'project --refresh',
    'status one two',
    'resume --refresh',
    'unknown',
  ])('rejects invalid input %j without guessing', (input) => {
    const result = parseArchScopeCommand(input)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('/archscope help')
  })

  it('keeps /kantu parsing as a deprecated compatibility alias', () => {
    expect(parseKantuCommand('system --refresh')).toEqual({
      ok: true,
      intent: { kind: 'system.scan', refresh: true },
    })
  })
})

describe('executeArchScopeIntent', () => {
  const runtime: ArchScopeCommandRuntime = {
    async scanSystem() {
      return {
        runId: 'system-1',
        status: 'BLOCKED',
        gate: 'BLOCKED',
        validation: 'PASSED',
        projectCount: 2,
        indexedProjectCount: 2,
        evidenceProjectCount: 1,
        scopeViolationCount: 0,
        outputDirectory: 'kantu_docs',
        reused: false,
      }
    },
    async status() {
      return {
        found: true,
        runId: 'system-1',
        status: 'BLOCKED',
        gate: 'BLOCKED',
        validation: 'PASSED',
        projectCount: 2,
        indexedProjectCount: 2,
        evidenceProjectCount: 1,
        scopeViolationCount: 0,
        outputDirectory: 'kantu_docs',
      }
    },
  }

  it('renders deterministic help', async () => {
    await expect(executeArchScopeIntent({ kind: 'help' }, runtime)).resolves.toEqual({
      kind: 'success',
      text: ARCHSCOPE_COMMAND_HELP,
    })
  })

  it('reports the latest persisted run', async () => {
    await expect(executeArchScopeIntent({ kind: 'run.status' }, runtime)).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('system-1'),
    })
  })

  it('executes the system scan and reports its blocked evidence gate', async () => {
    await expect(executeArchScopeIntent({ kind: 'system.scan', refresh: false }, runtime)).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('system analysis awaiting source evidence'),
    })
  })

  it('forwards the receiving session workspace to command operations', async () => {
    let scanWorkspace: string | undefined
    let statusWorkspace: string | undefined
    const scopedRuntime: ArchScopeCommandRuntime = {
      async scanSystem(options) {
        scanWorkspace = options.workspaceRoot
        return runtime.scanSystem(options)
      },
      async status(runId, options) {
        statusWorkspace = options?.workspaceRoot
        return runtime.status(runId, options)
      },
    }

    await executeArchScopeIntent({ kind: 'system.scan', refresh: false }, scopedRuntime, undefined, '/workspace/current')
    await executeArchScopeIntent({ kind: 'run.status' }, scopedRuntime, undefined, '/workspace/current')

    expect(scanWorkspace).toBe('/workspace/current')
    expect(statusWorkspace).toBe('/workspace/current')
  })

  it('runs system scans deterministically while publishing visible start and completion messages', async () => {
    const queued: unknown[] = []
    let scanWorkspace: string | undefined
    let refresh: boolean | undefined
    const command = createArchScopeCommand({
      ...runtime,
      async scanSystem(options) {
        scanWorkspace = options.workspaceRoot
        refresh = options.refresh
        return runtime.scanSystem(options)
      },
    })

    const result = await command.handler({
      commandId: 'cmd-archscope-1',
      rawInput: ' 系统级扫描 --refresh',
      signal: new AbortController().signal,
      agent: {
        followup(message: unknown) {
          queued.push(message)
        },
        session: { header: { cwd: '/workspace/current' } },
      },
    } as never)

    expect(result).toMatchObject({
      kind: 'success',
      text: expect.stringContaining('ArchScope system scan completed'),
    })
    expect(scanWorkspace).toBe('/workspace/current')
    expect(refresh).toBe(true)
    expect(queued).toHaveLength(2)
    expect(queued[0]).toMatchObject({
      role: 'user',
      source: {
        kind: 'plugin',
        plugin: 'archscope',
        form: 'notice',
        summary: 'ArchScope 系统级扫描已开始 · 正在发现工程',
      },
      content: [{
        type: 'text',
        text: expect.stringContaining('Do not call any tools'),
      }],
    })
    expect(queued[1]).toMatchObject({
      role: 'user',
      source: {
        kind: 'plugin',
        plugin: 'archscope',
        form: 'notice',
        summary: 'ArchScope 系统级扫描结束 · 1/2 个工程已取证 · BLOCKED',
      },
      content: [{
        type: 'text',
        text: expect.stringContaining('Do not describe the aggregate validation field as structure-only validation'),
      }],
    })
  })
})
