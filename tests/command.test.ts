import { describe, expect, it } from 'vitest'

import { executeKantuIntent, KANTU_COMMAND_HELP, parseKantuCommand } from '../src/commands/kantu.js'

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
  const options = { outputDirectory: 'kantu_docs' }

  it('renders deterministic help', () => {
    expect(executeKantuIntent({ kind: 'help' }, options)).toEqual({
      kind: 'success',
      text: KANTU_COMMAND_HELP,
    })
  })

  it('reports the real scaffold status', () => {
    expect(executeKantuIntent({ kind: 'run.status' }, options)).toEqual({
      kind: 'success',
      text: expect.stringContaining('Kantu is loaded.'),
    })
  })

  it('fails closed while the system scan engine is unavailable', () => {
    expect(executeKantuIntent({ kind: 'system.scan', refresh: false }, options)).toEqual({
      kind: 'error',
      text: expect.stringContaining('not implemented'),
    })
  })
})
