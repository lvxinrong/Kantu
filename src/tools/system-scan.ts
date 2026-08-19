import { defineTool } from '@deepseek-ai/dsh-tools'

import type { SystemScanResult } from '../contracts/system-scan.js'
import type { KantuService } from '../service.js'

export function createSystemScanMessage(result: SystemScanResult): string {
  const scanOutcome = result.status === 'FAILED' ? 'failed' : result.reused ? 'results reused' : 'completed'
  const sourceAnalysisComplete = result.projectCount > 0
    && result.indexedProjectCount === result.projectCount
    && result.evidenceProjectCount === result.projectCount
    && result.scopeViolationCount === 0
  const analysisOutcome = sourceAnalysisComplete
    ? 'completed at source level; runtime evidence pending'
    : 'awaiting source evidence'
  return [
    `Kantu system scan ${scanOutcome} · ${result.projectCount} projects · system analysis ${analysisOutcome}.`,
    `Fresh indexes ${result.indexedProjectCount}/${result.projectCount} · collected evidence ${result.evidenceProjectCount}/${result.projectCount} · scope violations ${result.scopeViolationCount}.`,
    `System artifact validation ${result.validation} · project-scan gate ${result.gate}.`,
    `Artifacts: ${result.outputDirectory}/system/00-system-fact-base.md`,
    `Run: ${result.runId} · machine status ${result.status}.`,
  ].join('\n')
}

export function createSystemScanTool(service: KantuService) {
  return defineTool({
    name: 'kantu_scan_system',
    description: 'Run the full source-level system scan: discover Git projects, prepare independent code indexes, collect isolated evidence, synthesize the system fact base, and validate the downstream gate. This never claims runtime or production facts without evidence.',
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
