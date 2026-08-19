import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'

import type { KantuStatusResult, SystemScanResult } from '../contracts/system-scan.js'
import type { KantuIntent, KantuIntentParseResult } from '../intents.js'
import { createStatusMessage } from '../tools/status.js'
import { createSystemScanMessage } from '../tools/system-scan.js'

const SUBCOMMAND_ALIASES = new Map<string, string>([
  ['system', 'system'],
  ['系统级扫描', 'system'],
  ['project', 'project'],
  ['项目级扫描', 'project'],
  ['status', 'status'],
  ['状态', 'status'],
  ['resume', 'resume'],
  ['继续', 'resume'],
  ['help', 'help'],
  ['帮助', 'help'],
])

export const KANTU_COMMAND_HELP = `Kantu commands:
  /kantu system [--refresh]
  /kantu project <project-key> [--refresh]
  /kantu status [run-id]
  /kantu resume [run-id]
  /kantu help

Chinese aliases: 系统级扫描, 项目级扫描, 状态, 继续, 帮助`

function failure(message: string): KantuIntentParseResult {
  return { ok: false, error: `${message}\n\n${KANTU_COMMAND_HELP}` }
}

function parseRefreshArguments(args: string[], usage: string): KantuIntentParseResult | boolean {
  if (args.length === 0) return false
  if (args.length === 1 && args[0] === '--refresh') return true
  return failure(`Invalid arguments. Usage: ${usage}`)
}

function parseOptionalRunId(args: string[], kind: 'run.status' | 'run.resume', usage: string): KantuIntentParseResult {
  if (args.length > 1 || args[0]?.startsWith('-')) {
    return failure(`Invalid arguments. Usage: ${usage}`)
  }
  return {
    ok: true,
    intent: args[0] === undefined ? { kind } : { kind, runId: args[0] },
  }
}

export function parseKantuCommand(rawInput: string): KantuIntentParseResult {
  const tokens = rawInput.trim().split(/\s+/u).filter(Boolean)
  if (tokens.length === 0) return { ok: true, intent: { kind: 'help' } }

  const [rawSubcommand, ...args] = tokens
  const subcommand = rawSubcommand === undefined ? undefined : SUBCOMMAND_ALIASES.get(rawSubcommand)

  switch (subcommand) {
    case 'help':
      return args.length === 0
        ? { ok: true, intent: { kind: 'help' } }
        : failure('Invalid arguments. Usage: /kantu help')
    case 'system': {
      const refresh = parseRefreshArguments(args, '/kantu system [--refresh]')
      return typeof refresh === 'boolean'
        ? { ok: true, intent: { kind: 'system.scan', refresh } }
        : refresh
    }
    case 'project': {
      const [projectKey, ...rest] = args
      if (projectKey === undefined || projectKey.startsWith('-')) {
        return failure('Missing project-key. Usage: /kantu project <project-key> [--refresh]')
      }
      const refresh = parseRefreshArguments(rest, '/kantu project <project-key> [--refresh]')
      return typeof refresh === 'boolean'
        ? { ok: true, intent: { kind: 'project.scan', projectKey, refresh } }
        : refresh
    }
    case 'status':
      return parseOptionalRunId(args, 'run.status', '/kantu status [run-id]')
    case 'resume':
      return parseOptionalRunId(args, 'run.resume', '/kantu resume [run-id]')
    default:
      return failure(`Unknown Kantu subcommand: ${rawSubcommand ?? ''}`)
  }
}

export interface KantuCommandRuntime {
  scanSystem(options: { refresh?: boolean, signal?: AbortSignal }): Promise<SystemScanResult>
  status(runId?: string): Promise<KantuStatusResult>
}

export async function executeKantuIntent(
  intent: KantuIntent,
  runtime: KantuCommandRuntime,
  signal?: AbortSignal,
): Promise<CommandResult> {
  switch (intent.kind) {
    case 'help':
      return { kind: 'success', text: KANTU_COMMAND_HELP }
    case 'run.status':
      return { kind: 'success', text: createStatusMessage(await runtime.status(intent.runId)) }
    case 'system.scan': {
      const result = await runtime.scanSystem({ refresh: intent.refresh, signal })
      return { kind: 'success', text: createSystemScanMessage(result) }
    }
    case 'project.scan':
      return {
        kind: 'error',
        text: 'Project scanning is not available until the system-level workflow exists. No scan was started.',
      }
    case 'run.resume':
      return {
        kind: 'error',
        text: 'Kantu does not have persistent runs to resume yet. No action was taken.',
      }
  }
}

export function createKantuCommand(runtime: KantuCommandRuntime): CommandDefinition {
  return {
    name: 'kantu',
    description: 'run and inspect evidence-driven Kantu architecture scans',
    input: { hint: 'system | project <project-key> | status | resume | help' },
    handler: ({ rawInput, signal }) => {
      const parsed = parseKantuCommand(rawInput)
      return parsed.ok
        ? executeKantuIntent(parsed.intent, runtime, signal)
        : { kind: 'error', text: parsed.error }
    },
  }
}
