import { defineTool } from '@deepseek-ai/dsh-tools'

import type { SystemScanResult } from '../contracts/system-scan.js'
import type { ArchScopeService } from '../service.js'

export function createSystemScanMessage(result: SystemScanResult): string {
  if (result.status === 'AWAITING_SYNTHESIS' || result.status === 'SYNTHESIZING') {
    return [
      `ArchScope evidence collection ready · ${result.projectCount} projects · awaiting current main-agent system synthesis.`,
      `Fresh indexes ${result.indexedProjectCount}/${result.projectCount} · collected evidence ${result.evidenceProjectCount}/${result.projectCount} · scope violations ${result.scopeViolationCount}.`,
      `Next action for the current DSH main agent: call archscope_get_system_synthesis_context with runId ${result.runId}, follow its protocol, then commit with archscope_commit_system_synthesis.`,
      `Evidence artifacts: ${result.outputDirectory}/system/evidence/index.json`,
    ].join('\n')
  }
  const scanOutcome = result.status === 'FAILED' ? 'failed' : result.reused ? 'results reused' : 'completed'
  const sourceAnalysisComplete = result.projectCount > 0
    && result.indexedProjectCount === result.projectCount
    && result.evidenceProjectCount === result.projectCount
    && result.scopeViolationCount === 0
  const analysisOutcome = sourceAnalysisComplete
    ? 'completed at source level; runtime evidence pending'
    : 'awaiting source evidence'
  return [
    `ArchScope system scan ${scanOutcome} · ${result.projectCount} projects · system analysis ${analysisOutcome}.`,
    `Fresh indexes ${result.indexedProjectCount}/${result.projectCount} · collected evidence ${result.evidenceProjectCount}/${result.projectCount} · scope violations ${result.scopeViolationCount}.`,
    `System artifact validation ${result.validation} · project-scan gate ${result.gate}.`,
    `Artifacts: ${result.outputDirectory}/system/00-system-fact-base.md`,
    `Run: ${result.runId} · machine status ${result.status}.`,
  ].join('\n')
}

export function createSystemScanTool(service: ArchScopeService) {
  return defineTool({
    name: 'archscope_scan_system',
    description: 'Start the ArchScope system workflow: discover Git projects, prepare independent code indexes, and collect isolated evidence. The current DSH main agent must then load the synthesis context, build the system worldview, and commit validated artifacts.',
    parameters: {
      refresh: { type: 'boolean', description: 'Create a fresh run instead of reusing the latest reusable system scan.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          gate: { type: 'string', required: true },
          validation: { type: 'string', required: true },
          projectCount: { type: 'number', required: true },
          indexedProjectCount: { type: 'number', required: true },
          evidenceProjectCount: { type: 'number', required: true },
          scopeViolationCount: { type: 'number', required: true },
          outputDirectory: { type: 'string', required: true },
          reused: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: createSystemScanMessage(value as unknown as SystemScanResult) }],
    },
    async execute(args, exec) {
      return service.scanSystem({
        refresh: args.refresh ?? false,
        signal: exec.signal,
        workspaceRoot: exec.agent?.session.header.cwd,
        agent: exec.agent,
      })
    },
  })
}
