import { describe, expect, it } from 'vitest'

import {
  createArchScopeCommand,
  executeArchScopeIntent,
  ARCHSCOPE_COMMAND_HELP,
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
    ['resume run-1', { kind: 'run.resume', runId: 'run-1' }],
    ['继续', { kind: 'run.resume' }],
  ])('parses %j into a stable intent', (input, intent) => {
    expect(parseArchScopeCommand(input)).toEqual({ ok: true, intent })
  })

  it.each([
    'system now',
    'project',
    'project --refresh',
    'status',
    'resume --refresh',
    'unknown',
  ])('rejects invalid input %j without guessing', (input) => {
    const result = parseArchScopeCommand(input)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('/archscope help')
  })

})

describe('executeArchScopeIntent', () => {
  const runtime: ArchScopeCommandRuntime = {
    async scanSystem() {
      return {
        runId: 'system-1',
        documentRevision: 'PENDING',
        status: 'AWAITING_SYNTHESIS',
        gate: 'BLOCKED',
        validation: 'NOT_RUN',
        projectCount: 2,
        indexedProjectCount: 2,
        evidenceProjectCount: 1,
        scopeViolationCount: 0,
        outputDirectory: 'archscope_docs',
        reused: false,
      }
    },
  }

  it('renders deterministic help', async () => {
    await expect(executeArchScopeIntent({ kind: 'help' }, runtime)).resolves.toEqual({
      kind: 'success',
      text: ARCHSCOPE_COMMAND_HELP,
    })
    expect(ARCHSCOPE_COMMAND_HELP).toContain('系统级定世界观')
    expect(ARCHSCOPE_COMMAND_HELP).toContain('/archscope system --refresh')
    expect(ARCHSCOPE_COMMAND_HELP).toContain('空白新会话')
    expect(ARCHSCOPE_COMMAND_HELP).not.toContain('/archscope project')
    expect(ARCHSCOPE_COMMAND_HELP).not.toContain('/archscope resume')
    expect(ARCHSCOPE_COMMAND_HELP).not.toContain('/archscope status')
  })

  it('executes the system scan and hands evidence to the current main agent', async () => {
    await expect(executeArchScopeIntent({ kind: 'system.scan', refresh: false }, runtime)).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('awaiting current main-agent system synthesis'),
    })
  })

  it('forwards the receiving session workspace to command operations', async () => {
    let scanWorkspace: string | undefined
    const scopedRuntime: ArchScopeCommandRuntime = {
      async scanSystem(options) {
        scanWorkspace = options.workspaceRoot
        return runtime.scanSystem(options)
      },
    }

    await executeArchScopeIntent({ kind: 'system.scan', refresh: false }, scopedRuntime, undefined, '/workspace/current')

    expect(scanWorkspace).toBe('/workspace/current')
  })

  it('runs evidence collection while publishing visible start and main-agent handoff messages', async () => {
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
      text: expect.stringContaining('awaiting current main-agent system synthesis'),
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
        summary: 'ArchScope 主 Agent 综合 · 1/2 个工程证据已就绪',
      },
      content: [{
        type: 'text',
        text: expect.stringContaining('archscope_get_system_synthesis_context'),
      }],
    })
  })

  it('publishes help as a normal conversational follow-up instead of command-card text', async () => {
    const queued: unknown[] = []
    const command = createArchScopeCommand(runtime)

    const result = await command.handler({
      commandId: 'cmd-archscope-help-1',
      rawInput: ' help',
      signal: new AbortController().signal,
      agent: {
        followup(message: unknown) {
          queued.push(message)
        },
        session: { header: { cwd: '/workspace/current' } },
      },
    } as never)

    expect(result).toEqual({ kind: 'success' })
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({
      role: 'user',
      source: {
        kind: 'plugin',
        plugin: 'archscope',
        form: 'notice',
        summary: 'ArchScope 使用指南',
      },
      content: [{
        type: 'text',
        text: expect.stringContaining('normal conversational answer'),
      }],
    })
  })
})
