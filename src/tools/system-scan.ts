import { defineTool } from '@deepseek-ai/dsh-tools'

import type { SystemScanResult } from '../contracts/system-scan.js'
import type { KantuService } from '../service.js'

export function createSystemScanMessage(result: SystemScanResult): string {
  const action = result.reused ? 'Reused' : 'Created'
  return [
    `${action} Kantu system scan ${result.runId}.`,
    `Status: ${result.status}.`,
    `Projects: ${result.projectCount}.`,
    `Validation: ${result.validation}.`,
    `Gate: ${result.gate}.`,
    `Artifacts: ${result.outputDirectory}.`,
  ].join(' ')
}

export function createSystemScanTool(service: KantuService) {
  return defineTool({
    name: 'kantu_scan_system',
    description: 'Discover Git projects in the workspace and build a source-evidence system scan draft. This never claims runtime or production facts without evidence.',
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
          outputDirectory: { type: 'string', required: true },
          reused: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: createSystemScanMessage(value as unknown as SystemScanResult) }],
    },
    async execute(args, exec) {
      return service.scanSystem({ refresh: args.refresh ?? false, signal: exec.signal })
    },
  })
}
