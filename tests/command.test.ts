import { describe, expect, it } from 'vitest'

import { executeKantuIntent, KANTU_COMMAND_HELP, parseKantuCommand, type KantuCommandRuntime } from '../src/commands/kantu.js'

describe('parseKantuCommand', () => {
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
    expect(parseKantuCommand(input)).toEqual({ ok: true, intent })
  })

  it.each([
    'system now',
    'project',
    'project --refresh',
    'status one two',
    'resume --refresh',
    'unknown',
  ])('rejects invalid input %j without guessing', (input) => {
    const result = parseKantuCommand(input)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('/kantu help')
  })
})

describe('executeKantuIntent', () => {
  const runtime: KantuCommandRuntime = {
    async scanSystem() {
      return {
        runId: 'system-1',
        status: 'BLOCKED',
        gate: 'BLOCKED',
        validation: 'PASSED',
        projectCount: 2,
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
        outputDirectory: 'kantu_docs',
      }
    },
  }

  it('renders deterministic help', async () => {
    await expect(executeKantuIntent({ kind: 'help' }, runtime)).resolves.toEqual({
      kind: 'success',
      text: KANTU_COMMAND_HELP,
    })
  })

  it('reports the latest persisted run', async () => {
    await expect(executeKantuIntent({ kind: 'run.status' }, runtime)).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('system-1'),
    })
  })

  it('executes the system scan and reports its blocked evidence gate', async () => {
    await expect(executeKantuIntent({ kind: 'system.scan', refresh: false }, runtime)).resolves.toEqual({
      kind: 'success',
      text: expect.stringContaining('Gate: BLOCKED'),
    })
  })
})
