import type { CommandDefinition, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'

import type { KantuStatusResult, SystemScanProgress, SystemScanResult } from '../contracts/system-scan.js'
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
  scanSystem(options: { refresh?: boolean, signal?: AbortSignal, workspaceRoot?: string, agent?: ToolExecutionInput['agent'], onProgress?: (progress: SystemScanProgress) => void }): Promise<SystemScanResult>
  status(runId?: string, options?: { workspaceRoot?: string }): Promise<KantuStatusResult>
}

function createSystemScanStartedMessage(refresh: boolean) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: `Reply to the user in Chinese with one short sentence confirming that Kantu has started the full system-level scan in the current DSH workspace${refresh ? ' with index refresh enabled' : ''}. Mention that it will discover projects, prepare indexes, collect evidence, and report progress automatically. Do not call any tools.`,
    }],
    source: {
      kind: 'plugin',
      plugin: 'kantu',
      form: 'notice',
      summary: 'Kantu 系统级扫描已开始 · 正在发现工程',
    },
  })
}

function createSystemScanCompletedMessage(result: SystemScanResult) {
  const sourceAnalysisComplete = result.projectCount > 0
    && result.indexedProjectCount === result.projectCount
    && result.evidenceProjectCount === result.projectCount
    && result.scopeViolationCount === 0
  const systemAnalysis = sourceAnalysisComplete
    ? 'source-level analysis completed; runtime/production evidence remains unconfirmed'
    : 'source-level analysis is incomplete; inspect index, evidence, and scope counts'
  const projectAnalysis = result.gate === 'READY' ? 'available' : 'not yet available'

  return createUserMessage({
    content: [{
      type: 'text',
      text: `Kantu's deterministic system-level scan has finished. Report these exact user-facing facts in concise Chinese and do not call any tools:
- scan execution: ${result.reused ? 'reused from a compatible completed run' : 'completed now'}
- discovered projects: ${result.projectCount}
- fresh indexes: ${result.indexedProjectCount}/${result.projectCount}
- collected project evidence: ${result.evidenceProjectCount}/${result.projectCount}
- actual evidence scope violations: ${result.scopeViolationCount}
- system-level analysis: ${systemAnalysis}
- system artifact validation (structure, evidence, scope, gate, and redaction): ${result.validation}
- project-level analysis: ${projectAnalysis}
- artifact: ${result.outputDirectory}/system/00-system-fact-base.md

Put these raw fields under a final "技术详情" line instead of leading with them:
- run: ${result.runId}
- machine status: ${result.status}
- project-scan gate: ${result.gate}

Do not describe the aggregate validation field as structure-only validation. Clearly distinguish source-level completion from missing runtime evidence and from the project-level gate.`,
    }],
    source: {
      kind: 'plugin',
      plugin: 'kantu',
      form: 'notice',
      summary: `Kantu 系统级扫描结束 · ${result.evidenceProjectCount}/${result.projectCount} 个工程已取证 · ${result.gate}`,
    },
  })
}

function createSystemScanFailedMessage(error: unknown) {
  const reason = error instanceof Error ? error.message : String(error)
  return createUserMessage({
    content: [{
      type: 'text',
      text: `Kantu's deterministic system scan failed. Tell the user concisely in Chinese that the scan failed with this reason and do not call any tools: ${reason}`,
    }],
    source: {
      kind: 'plugin',
      plugin: 'kantu',
      form: 'notice',
      summary: 'Kantu 系统级扫描失败',
    },
  })
}

function createSystemScanProgressMessage(progress: SystemScanProgress) {
  return createUserMessage({
    content: [{
      type: 'text',
      text: `Reply to the user in Chinese with this one-line Kantu progress update and do not call any tools: ${progress.message}`,
    }],
    source: {
      kind: 'plugin',
      plugin: 'kantu',
      form: 'notice',
      summary: `Kantu · ${progress.message}`,
    },
  })
}

export async function executeKantuIntent(
  intent: KantuIntent,
  runtime: KantuCommandRuntime,
  signal?: AbortSignal,
  workspaceRoot?: string,
): Promise<CommandResult> {
  switch (intent.kind) {
    case 'help':
      return { kind: 'success', text: KANTU_COMMAND_HELP }
    case 'run.status':
      return { kind: 'success', text: createStatusMessage(await runtime.status(intent.runId, { workspaceRoot })) }
    case 'system.scan': {
      const result = await runtime.scanSystem({ refresh: intent.refresh, signal, workspaceRoot })
      return { kind: 'success', text: createSystemScanMessage(result) }
    }
    case 'project.scan':
      return {
        kind: 'error',
        text: 'Project-level scanning is not implemented yet. The system-level workflow is available, but no project scan was started.',
      }
    case 'run.resume':
      return {
        kind: 'error',
        text: 'Kantu persists system runs, but resumable task execution is not implemented yet. No action was taken.',
      }
  }
}

export function createKantuCommand(runtime: KantuCommandRuntime): CommandDefinition {
  return {
    name: 'kantu',
    description: 'run and inspect evidence-driven Kantu architecture scans',
    input: { hint: 'system | project <project-key> | status | resume | help' },
    handler: async ({ rawInput, signal, agent }) => {
      const parsed = parseKantuCommand(rawInput)
      if (!parsed.ok) return { kind: 'error', text: parsed.error }

      if (parsed.intent.kind === 'system.scan') {
        agent.followup(createSystemScanStartedMessage(parsed.intent.refresh))
        try {
          const result = await runtime.scanSystem({
            refresh: parsed.intent.refresh,
            signal,
            workspaceRoot: agent.session.header.cwd,
            agent,
            onProgress(progress) {
              agent.followup(createSystemScanProgressMessage(progress))
            },
          })
          agent.followup(createSystemScanCompletedMessage(result))
          return { kind: 'success', text: createSystemScanMessage(result) }
        } catch (error: unknown) {
          agent.followup(createSystemScanFailedMessage(error))
          throw error
        }
      }

      return executeKantuIntent(parsed.intent, runtime, signal, agent.session.header.cwd)
    },
  }
}
